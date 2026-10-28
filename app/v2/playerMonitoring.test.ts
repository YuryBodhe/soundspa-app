import assert from "node:assert/strict";
import test from "node:test";
import { observeLaneProgress, PlayerMonitoringSidecar, type MonitoringSendResult, type MonitoringSignal, type MonitoringSnapshot } from "./playerMonitoring";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const playing: MonitoringSnapshot = {
  music: { state: "playing", channelId: "music" }, ambient: { state: "playing", channelId: "ambient" },
};
function clock() {
  let next = 0;
  const tasks = new Map<number, { callback: () => void; delay: number }>();
  return {
    tasks,
    schedule(callback: () => void, delay: number) {
      const id = ++next;
      tasks.set(id, { callback, delay });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel(timer: ReturnType<typeof setTimeout>) { tasks.delete(timer as unknown as number); },
    async fire() {
      const [id, task] = tasks.entries().next().value!;
      tasks.delete(id);
      task.callback();
      await tick();
      return task.delay;
    },
  };
}

test("initial failure recovers with bounded backoff and repeated start never creates concurrent sessions", async () => {
  const timer = clock();
  let creates = 0;
  let available = false;
  const sent: MonitoringSignal[] = [];
  const sidecar = new PlayerMonitoringSidecar(() => playing, {
    ...timer, random: () => 0,
    createSession: async () => { creates++; if (!available) throw new Error("offline"); return { sessionId: "s", generation: 1 }; },
    sendSignal: async signal => { sent.push(signal); return "accepted"; },
  });
  const firstStart = sidecar.start();
  assert.equal(sidecar.start(), firstStart);
  await firstStart;
  await tick();
  assert.equal(creates, 1);
  assert.equal(sidecar.connectionState, "retrying");
  for (const delay of [2_000, 4_000, 8_000, 16_000, 30_000, 60_000, 120_000, 120_000]) {
    assert.equal(timer.tasks.size, 1);
    assert.equal(await timer.fire(), delay);
  }
  available = true;
  await timer.fire();
  assert.equal(sidecar.connectionState, "connected");
  assert.deepEqual(sent[0]?.music.state, "playing");
  assert.deepEqual(sent[0]?.ambient.state, "playing");
  sidecar.dispose();
  assert.equal(timer.tasks.size, 0);
});

test("network interruption preserves both audio lanes, coalesces state, and recovers without a new session", async () => {
  const timer = clock();
  let available = true;
  let creates = 0;
  let audioTime = 0;
  const musicTracker = { key: null, position: null, sampledAt: null, progressedAt: -Infinity };
  const ambientTracker = { ...musicTracker };
  const read = (): MonitoringSnapshot => ({
    music: observeLaneProgress({ status: "playing", channelId: "music", key: "track-m", currentTime: audioTime, paused: false, seeking: false }, musicTracker, audioTime * 1000),
    ambient: observeLaneProgress({ status: "playing", channelId: "ambient", key: "track-a", currentTime: audioTime, paused: false, seeking: false }, ambientTracker, audioTime * 1000),
  });
  const sent: MonitoringSignal[] = [];
  const sidecar = new PlayerMonitoringSidecar(read, {
    ...timer, random: () => 0,
    createSession: async () => { creates++; return { sessionId: "s", generation: 1 }; },
    sendSignal: async signal => { if (!available) throw new Error("offline"); sent.push(signal); return "accepted"; },
  });
  await sidecar.start(); await tick();
  audioTime++; sidecar.update(read()); await tick();
  available = false;
  await timer.fire();
  const requestsBeforeUpdates = sent.length;
  for (let i = 0; i < 10; i++) { audioTime++; sidecar.update(read()); }
  assert.equal(sent.length, requestsBeforeUpdates);
  assert.deepEqual(read(), playing, "media time continues progressing for both lanes during the telemetry outage");
  available = true;
  await timer.fire();
  assert.equal(creates, 1);
  assert.equal(sidecar.connectionState, "connected");
  assert.equal(sent.at(-1)?.music.state, "playing");
  assert.equal(sent.at(-1)?.ambient.state, "playing");
  sidecar.dispose();
});

test("two player tabs use newest-session ownership without a takeover retry loop", async () => {
  let generation = 0;
  let creates = 0;
  const aClock = clock(); const bClock = clock();
  const make = (timer: ReturnType<typeof clock>) => new PlayerMonitoringSidecar(() => playing, {
    ...timer, random: () => 0,
    createSession: async () => { creates++; return { sessionId: `s${++generation}`, generation }; },
    sendSignal: async signal => signal.generation === generation ? "accepted" : "superseded",
  });
  const a = make(aClock); const b = make(bClock);
  await a.start(); await tick();
  await b.start(); await tick();
  await aClock.fire();
  assert.equal(a.connectionState, "superseded");
  assert.equal(aClock.tasks.size, 0);
  a.update({ ...playing, music: { state: "paused", channelId: "music" } });
  await a.start(); await tick();
  assert.equal(creates, 2, "the old tab cannot reclaim the session automatically");
  await bClock.fire();
  assert.equal(b.connectionState, "connected");
  a.dispose(); b.dispose();
});

test("hung session and heartbeat requests time out, abort and recover; late results are ignored", async () => {
  for (const hang of ["session", "heartbeat"]) {
    const timer = clock();
    let blocked = true;
    let aborted = false;
    let completeLate: (() => void) | undefined;
    let creates = 0;
    const sidecar = new PlayerMonitoringSidecar(() => playing, {
      ...timer, random: () => 0, requestTimeoutMs: 5,
      createSession: async signal => {
        creates++;
        if (hang === "session" && blocked) {
          signal.addEventListener("abort", () => { aborted = true; });
          return new Promise(resolve => { completeLate = () => resolve({ sessionId: "late", generation: 99 }); });
        }
        return { sessionId: "current", generation: 1 };
      },
      sendSignal: async (_snapshot, signal) => {
        if (hang === "heartbeat" && blocked) {
          signal.addEventListener("abort", () => { aborted = true; });
          return new Promise<MonitoringSendResult>(resolve => { completeLate = () => resolve("superseded"); });
        }
        return "accepted";
      },
    });
    await sidecar.start();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(aborted, true);
    assert.equal(sidecar.connectionState, "retrying");
    blocked = false;
    await timer.fire();
    assert.equal(sidecar.connectionState, "connected");
    completeLate?.(); await tick();
    assert.equal(sidecar.connectionState, "connected");
    assert.equal(creates, hang === "session" ? 2 : 1);
    sidecar.dispose();
  }
});

test("default HTTP transport interprets accepted payloads and stops on superseded or invalid credentials", async () => {
  const original = globalThis.fetch;
  try {
    for (const result of ["superseded", "unauthorized", "rejected"] as const) {
      const timer = clock();
      globalThis.fetch = async input => {
        if (String(input).endsWith("/session")) return Response.json({ sessionId: "s", generation: 1 });
        return result === "superseded" ? Response.json({ accepted: { music: false, ambient: false } })
          : new Response(null, { status: result === "unauthorized" ? 401 : 400 });
      };
      const sidecar = new PlayerMonitoringSidecar(() => playing, { ...timer });
      await sidecar.start(); await tick();
      assert.equal(sidecar.connectionState, result);
      assert.equal(timer.tasks.size, 0);
      sidecar.dispose();
    }
  } finally { globalThis.fetch = original; }
});

test("dispose aborts a pending request and prevents later retries or sessions", async () => {
  const timer = clock(); let aborted = false; let creates = 0;
  const sidecar = new PlayerMonitoringSidecar(() => playing, {
    ...timer,
    createSession: signal => { creates++; signal.addEventListener("abort", () => { aborted = true; }); return new Promise(() => {}); },
  });
  await sidecar.start(); await tick(); sidecar.dispose(); await tick();
  assert.equal(aborted, true);
  assert.equal(await sidecar.start(), false);
  assert.equal(creates, 1);
  assert.equal(timer.tasks.size, 0);
});

test("HTTP session overload and heartbeat failure recover without reload; authorization failure stops", async () => {
  const original = globalThis.fetch;
  const timer = clock();
  let sessionCalls = 0;
  let heartbeatCalls = 0;
  try {
    globalThis.fetch = async input => {
      if (String(input).endsWith("/session")) {
        sessionCalls++;
        return sessionCalls === 1 ? new Response(null, { status: 429 }) : Response.json({ sessionId: "s", generation: 1 });
      }
      heartbeatCalls++;
      return heartbeatCalls === 1 ? new Response(null, { status: 503 }) : Response.json({ accepted: { music: true, ambient: true } });
    };
    const sidecar = new PlayerMonitoringSidecar(() => playing, { ...timer, random: () => 0 });
    await sidecar.start(); await tick();
    assert.equal(sidecar.connectionState, "retrying");
    await timer.fire();
    assert.equal(sidecar.connectionState, "retrying");
    await timer.fire();
    assert.equal(sidecar.connectionState, "connected");
    assert.equal(sessionCalls, 2);
    assert.equal(heartbeatCalls, 2);
    sidecar.dispose();
    globalThis.fetch = async () => new Response(null, { status: 401 });
    const unauthorized = new PlayerMonitoringSidecar(() => playing, { ...timer });
    await unauthorized.start(); await tick();
    assert.equal(unauthorized.connectionState, "unauthorized");
    assert.equal(timer.tasks.size, 0);
    unauthorized.dispose();
  } finally { globalThis.fetch = original; }
});

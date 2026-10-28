import { boundedMonitoringRequest } from "../../lib/v2/monitoringRequest";

export type MonitoringPlaybackState = "idle" | "playing" | "paused" | "buffering" | "error";
export type MonitoringLaneSnapshot = { state: MonitoringPlaybackState; channelId: string | null };
export type MonitoringSnapshot = { music: MonitoringLaneSnapshot; ambient: MonitoringLaneSnapshot };
export type MonitoringSignal = MonitoringSnapshot & { sessionId: string; generation: number; music: MonitoringLaneSnapshot & { sequence: number }; ambient: MonitoringLaneSnapshot & { sequence: number } };

export type ProgressTracker = { key: string | null; position: number | null; sampledAt: number | null; progressedAt: number };

export function advanceFailureEpisode(previousKey: string | null, state: string, episodeKey: string): { key: string | null; shouldReport: boolean } {
  if (state !== "error") return { key: null, shouldReport: false };
  if (previousKey === episodeKey) return { key: previousKey, shouldReport: false };
  return { key: episodeKey, shouldReport: true };
}

/** Derive playing only from observed media-time movement, never from play() resolving alone. */
export function observeLaneProgress(input: {
  status: string;
  channelId: string | null;
  key: string | null;
  currentTime: number;
  paused: boolean;
  seeking: boolean;
}, tracker: ProgressTracker, now: number): MonitoringLaneSnapshot {
  if (tracker.key !== input.key) {
    tracker.key = input.key;
    tracker.position = null;
    tracker.sampledAt = null;
    tracker.progressedAt = -Infinity;
  }
  const position = Number.isFinite(input.currentTime) && input.currentTime >= 0 ? input.currentTime : 0;
  const elapsedSeconds = tracker.sampledAt === null ? 0 : Math.max(0, now - tracker.sampledAt) / 1_000;
  const delta = tracker.position === null ? 0 : position - tracker.position;
  const plausibleProgress = delta > 0.05 && delta <= elapsedSeconds * 2 + 0.5;
  if (!input.paused && !input.seeking && plausibleProgress) {
    tracker.progressedAt = now;
  }
  tracker.position = position;
  tracker.sampledAt = now;

  let state: MonitoringPlaybackState;
  if (!input.channelId || input.status === "idle") state = "idle";
  else if (input.status === "error") state = "error";
  else if (input.status === "paused") state = "paused";
  else if (input.paused || input.seeking) state = "buffering";
  else if (now - tracker.progressedAt <= 6_000) state = "playing";
  else state = "buffering";
  return { state, channelId: input.channelId };
}

export type MonitoringSession = { sessionId: string; generation: number };
export type MonitoringSendResult = "accepted" | "superseded" | "unauthorized" | "rejected";
export type MonitoringConnectionState = "idle" | "connecting" | "connected" | "retrying" | "superseded" | "unauthorized" | "rejected" | "stopped";
type SenderOptions = {
  createSession?: (signal: AbortSignal) => Promise<MonitoringSession>;
  sendSignal?: (signal: MonitoringSignal, abortSignal: AbortSignal) => Promise<MonitoringSendResult>;
  random?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  requestTimeoutMs?: number;
};

class MonitoringTerminalError extends Error {
  constructor(readonly state: "unauthorized" | "rejected") { super("Monitoring request rejected"); }
}

async function createSessionRequest(signal: AbortSignal): Promise<MonitoringSession> {
  const response = await fetch("/api/v2/monitoring/session", {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
  });
  if (response.status === 401 || response.status === 403) throw new MonitoringTerminalError("unauthorized");
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw new MonitoringTerminalError("rejected");
  if (!response.ok) throw new Error("Monitoring session unavailable");
  const value = await response.json() as Partial<MonitoringSession>;
  if (typeof value.sessionId !== "string" || !Number.isSafeInteger(value.generation) || (value.generation ?? 0) < 1) {
    throw new Error("Invalid monitoring session response");
  }
  return { sessionId: value.sessionId, generation: value.generation as number };
}

async function sendSignalRequest(signal: MonitoringSignal, abortSignal: AbortSignal): Promise<MonitoringSendResult> {
  const response = await fetch("/api/v2/monitoring/heartbeat", {
    method: "POST", credentials: "same-origin", cache: "no-store", signal: abortSignal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(signal),
  });
  if (response.status === 401 || response.status === 403) return "unauthorized";
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) return "rejected";
  if (!response.ok) throw new Error("Monitoring heartbeat unavailable");
  const value = await response.json() as { accepted?: { music?: boolean; ambient?: boolean } };
  if (value.accepted?.music === true && value.accepted.ambient === true) return "accepted";
  if (value.accepted?.music === false || value.accepted?.ambient === false) return "superseded";
  throw new Error("Invalid monitoring heartbeat response");
}

/** Best-effort typed error signal; never delays or controls playback. */
export async function reportPlaybackFailure(lane: "music" | "ambient") {
  try {
    await boundedMonitoringRequest(signal => fetch("/api/v2/monitoring/error", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lane }),
    }));
  } catch { /* Error analytics must never affect playback. */ }
}

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000, 60_000];
const OUTAGE_PROBE_MS = 120_000;

/** One owner per device: a superseded tab stops telemetry, never reclaims in a loop. */
export class PlayerMonitoringSidecar {
  private session: MonitoringSession | null = null;
  private pending: MonitoringSnapshot | null = null;
  private inFlight = false;
  private running = false;
  private disposed = false;
  private lastObservedKey = "";
  private musicSequence = 0;
  private ambientSequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryScheduled = false;
  private failures = 0;
  private startPromise: Promise<boolean> | null = null;
  private readonly lifetime = new AbortController();
  private state: MonitoringConnectionState = "idle";
  private readonly createSession: NonNullable<SenderOptions["createSession"]>;
  private readonly sendSignal: NonNullable<SenderOptions["sendSignal"]>;
  private readonly random: () => number;
  private readonly schedule: NonNullable<SenderOptions["schedule"]>;
  private readonly cancel: NonNullable<SenderOptions["cancel"]>;

  constructor(private readonly readSnapshot: () => MonitoringSnapshot, private readonly options: SenderOptions = {}) {
    this.createSession = options.createSession ?? createSessionRequest;
    this.sendSignal = options.sendSignal ?? sendSignalRequest;
    this.random = options.random ?? Math.random;
    this.schedule = options.schedule ?? setTimeout;
    this.cancel = options.cancel ?? clearTimeout;
  }

  get connectionState(): MonitoringConnectionState { return this.state; }

  /** Starts one lifetime, including bounded-backoff recovery if initialization fails. */
  start(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.startPromise) return this.startPromise;
    this.running = true;
    this.state = "connecting";
    this.startPromise = Promise.resolve(true);
    void this.flush();
    return this.startPromise;
  }

  update(snapshot: MonitoringSnapshot) {
    if (!this.running || this.disposed) return;
    const key = JSON.stringify(snapshot);
    if (key === this.lastObservedKey) return;
    this.lastObservedKey = key;
    this.pending = snapshot;
    // State changes coalesce during backoff; they cannot turn an outage into a retry storm.
    if (!this.inFlight && !this.retryScheduled) {
      this.clearTimer();
      void this.flush();
    }
  }

  dispose() {
    this.disposed = true;
    this.stop("stopped");
    this.lifetime.abort();
  }

  private clearTimer() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.retryScheduled = false;
  }

  private stop(state: MonitoringConnectionState) {
    this.running = false;
    this.pending = null;
    this.clearTimer();
    this.state = state;
  }

  private scheduleNext(delay: number, retry: boolean) {
    this.clearTimer();
    this.retryScheduled = retry;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.retryScheduled = false;
      if (this.running && !this.disposed) void this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.inFlight || !this.running || this.disposed) return;
    this.inFlight = true;
    try {
      if (!this.session) {
        this.session = await boundedMonitoringRequest(this.createSession, this.lifetime.signal, this.options.requestTimeoutMs);
      }
      if (!this.running || this.disposed) return;
      // Read on every retry/heartbeat so recovered telemetry reflects current audio.
      const snapshot = this.pending ?? this.readSnapshot();
      this.pending = null;
      this.lastObservedKey = JSON.stringify(snapshot);
      const signal: MonitoringSignal = {
        ...snapshot, sessionId: this.session.sessionId, generation: this.session.generation,
        music: { ...snapshot.music, sequence: ++this.musicSequence },
        ambient: { ...snapshot.ambient, sequence: ++this.ambientSequence },
      };
      const result = await boundedMonitoringRequest(abortSignal => this.sendSignal(signal, abortSignal), this.lifetime.signal, this.options.requestTimeoutMs);
      if (!this.running || this.disposed) return;
      if (result !== "accepted") { this.stop(result); return; }
      this.failures = 0;
      this.state = "connected";
    } catch (error) {
      if (!this.running || this.disposed) return;
      if (error instanceof MonitoringTerminalError) { this.stop(error.state); return; }
      this.state = "retrying";
      const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length)] ?? OUTAGE_PROBE_MS;
      this.failures = Math.min(this.failures + 1, RETRY_DELAYS_MS.length);
      this.scheduleNext(delay + Math.floor(this.random() * delay * 0.1), true);
    } finally {
      this.inFlight = false;
    }
    if (!this.running || this.disposed || this.retryScheduled) return;
    if (this.pending) void this.flush();
    else this.scheduleNext(120_000 + Math.floor(this.random() * 15_001), false);
  }
}

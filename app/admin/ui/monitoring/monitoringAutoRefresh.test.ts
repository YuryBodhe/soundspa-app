import assert from "node:assert/strict";
import test from "node:test";
import type { MonitoringSnapshotV1 } from "../../../../db/v2/monitoringSnapshotModel";
import { createMonitoringAutoRefresh, MONITORING_AUTO_REFRESH_MS } from "./monitoringAutoRefresh";

const snapshot = { asOf: "2026-10-02T13:15:00.000Z" } as MonitoringSnapshotV1;

test("auto refresh is scheduled every 60 seconds and timer/manual refreshes never overlap", async () => {
  let intervalMs = 0;
  let tick: (() => void) | undefined;
  let fetches = 0;
  let resolveFetch: ((value: MonitoringSnapshotV1) => void) | undefined;
  const received: MonitoringSnapshotV1[] = [];
  const controller = createMonitoringAutoRefresh({
    fetchSnapshot: () => { fetches++; return new Promise((resolve) => { resolveFetch = resolve; }); },
    onSnapshot: (value) => received.push(value), onError: () => assert.fail("unexpected refresh error"), onRefreshing: () => {},
  }, (callback, delay) => { tick = callback; intervalMs = delay; return 1 as unknown as ReturnType<typeof setInterval>; }, () => {});

  controller.start();
  assert.equal(intervalMs, MONITORING_AUTO_REFRESH_MS);
  assert.equal(intervalMs, 60_000);
  tick?.();
  await Promise.resolve();
  assert.equal(fetches, 1);
  await controller.refresh();
  assert.equal(fetches, 1, "manual refresh is coalesced while automatic request is active");
  resolveFetch?.(snapshot);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [snapshot]);

  const manualRefresh = controller.refresh();
  assert.equal(fetches, 2, "manual Refresh starts a new request after the previous one completes");
  resolveFetch?.(snapshot);
  await manualRefresh;
  await new Promise((resolve) => setImmediate(resolve));
  controller.stop();
});

test("stop clears the interval, aborts the active request and prevents late updates", async () => {
  let tick: (() => void) | undefined;
  let cleared = false;
  let signal: AbortSignal | undefined;
  let resolveFetch: ((value: MonitoringSnapshotV1) => void) | undefined;
  let updates = 0;
  const controller = createMonitoringAutoRefresh({
    fetchSnapshot: (requestSignal) => { signal = requestSignal; return new Promise((resolve) => { resolveFetch = resolve; }); },
    onSnapshot: () => updates++, onError: () => assert.fail("unexpected refresh error"), onRefreshing: () => {},
  }, (callback) => { tick = callback; return 2 as unknown as ReturnType<typeof setInterval>; },
  (timer) => { cleared = timer === (2 as unknown as ReturnType<typeof setInterval>); });

  controller.start();
  tick?.();
  await Promise.resolve();
  controller.stop();
  assert.equal(cleared, true);
  assert.equal(signal?.aborted, true);
  resolveFetch?.(snapshot);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates, 0);
  await controller.refresh();
  assert.equal(updates, 0);
});

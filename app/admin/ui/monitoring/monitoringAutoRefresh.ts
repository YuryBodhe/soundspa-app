import { boundedMonitoringRequest, MONITORING_REQUEST_TIMEOUT_MS } from "../../../../lib/v2/monitoringRequest";
import type { MonitoringSnapshotV1 } from "../../../../db/v2/monitoringSnapshotModel";

export const MONITORING_AUTO_REFRESH_MS = 60_000;

type RefreshCallbacks = {
  fetchSnapshot: (signal: AbortSignal) => Promise<MonitoringSnapshotV1>;
  onSnapshot: (snapshot: MonitoringSnapshotV1) => void;
  onError: (error: unknown) => void;
  onRefreshing: (refreshing: boolean) => void;
};

export function createMonitoringAutoRefresh(
  callbacks: RefreshCallbacks,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setInterval> = (callback, delay) => setInterval(callback, delay),
  cancel: (timer: ReturnType<typeof setInterval>) => void = clearInterval,
  timeoutMs = MONITORING_REQUEST_TIMEOUT_MS,
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let controller: AbortController | null = null;
  let inFlight = false;
  let stopped = false;

  async function refresh(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    controller = new AbortController();
    callbacks.onRefreshing(true);
    try {
      const snapshot = await boundedMonitoringRequest(callbacks.fetchSnapshot, controller.signal, timeoutMs);
      if (!stopped) callbacks.onSnapshot(snapshot);
    } catch (error) {
      if (!stopped && !(error instanceof Error && error.name === "AbortError")) callbacks.onError(error);
    } finally {
      inFlight = false;
      controller = null;
      if (!stopped) callbacks.onRefreshing(false);
    }
  }

  return {
    refresh,
    start() {
      if (stopped || timer !== null) return;
      timer = schedule(() => { void refresh(); }, MONITORING_AUTO_REFRESH_MS);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) cancel(timer);
      timer = null;
      controller?.abort();
      controller = null;
    },
  };
}

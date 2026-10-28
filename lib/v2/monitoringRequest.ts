/** Bounds telemetry only; callers must never use this to control audio. */
export const MONITORING_REQUEST_TIMEOUT_MS = 10_000;

export function boundedMonitoringRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  timeoutMs = MONITORING_REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abort);
      complete();
    };
    const abort = () => finish(() => {
      controller.abort();
      reject(new DOMException("Monitoring request canceled", "AbortError"));
    });
    const timer = setTimeout(() => finish(() => {
      controller.abort();
      reject(new Error("Monitoring request timed out"));
    }), timeoutMs);
    if (parentSignal?.aborted) { abort(); return; }
    parentSignal?.addEventListener("abort", abort, { once: true });
    try {
      Promise.resolve(operation(controller.signal)).then(
        value => finish(() => resolve(value)),
        error => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

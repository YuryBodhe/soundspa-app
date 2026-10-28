export type PlayerOwnershipState = "unsupported" | "activeElsewhere" | "waiting" | "owned" | "released";

type HeldLock = { name: string };
export type LockManagerLike = {
  request(name: string, options: { mode: "exclusive"; signal: AbortSignal }, callback: (lock: HeldLock | null) => unknown): Promise<unknown>;
  query?: () => Promise<{ held: HeldLock[] }>;
};

/** Same-origin, per-Device audio ownership. The lock callback remains pending until release(). */
export class DevicePlayerOwnership {
  readonly lockName: string;
  private state: PlayerOwnershipState = "waiting";
  private disposed = false;
  private owned = false;
  private releaseHeldLock: (() => void) | null = null;
  private readonly controller = new AbortController();

  constructor(
    deviceId: string,
    private readonly onStateChange: (state: PlayerOwnershipState) => void,
    private readonly manager: LockManagerLike | null | undefined = typeof navigator !== "undefined" ? navigator.locks as unknown as LockManagerLike : undefined,
  ) {
    this.lockName = `soundspa-v2:player:${deviceId}`;
  }

  get currentState() { return this.state; }
  get isOwner() { return this.owned; }

  start() {
    if (this.disposed) return;
    if (!this.manager) {
      this.setState("unsupported");
      return;
    }
    this.setState("waiting");
    // This query informs the standby message only; request() remains the ownership authority.
    void this.manager.query?.().then(({ held }) => {
      if (!this.disposed && !this.owned && held.some(lock => lock.name === this.lockName)) this.setState("activeElsewhere");
    }).catch(() => { /* The exclusive request still works if status inspection is unavailable. */ });

    try {
      void this.manager.request(this.lockName, { mode: "exclusive", signal: this.controller.signal }, async lock => {
        if (!lock || this.disposed) return;
        this.owned = true;
        this.setState("owned");
        await new Promise<void>(resolve => { this.releaseHeldLock = resolve; });
        this.releaseHeldLock = null;
        this.owned = false;
      }).catch(error => {
      if (!this.disposed && error instanceof Error && error.name !== "AbortError") this.setState("unsupported");
      });
    } catch {
      this.setState("unsupported");
    }
  }

  /** Stop audio and finish the bounded server-release attempt before allowing the next tab to acquire. */
  async release(afterPlaybackStopped: Promise<unknown> = Promise.resolve()) {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort(); // Cancels a queued request; does not steal an acquired lock.
    await afterPlaybackStopped.catch(() => undefined);
    this.releaseHeldLock?.();
    this.setState("released");
  }

  private setState(state: PlayerOwnershipState) {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }
}

export function canStartPlayerAudio(input: { monitoringEnabled: boolean; lockOwned: boolean; monitoringReady: boolean; monitoringConnected: boolean }) {
  return !input.monitoringEnabled || (input.lockOwned && input.monitoringReady && input.monitoringConnected);
}

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

type Session = { sessionId: string; generation: number };
type SenderOptions = {
  readSnapshot: () => MonitoringSnapshot;
  createSession?: () => Promise<Session>;
  sendSignal?: (signal: MonitoringSignal) => Promise<boolean>;
  random?: () => number;
};

async function createSessionRequest(): Promise<Session> {
  const response = await fetch("/api/v2/monitoring/session", {
    method: "POST", credentials: "same-origin", cache: "no-store",
  });
  if (!response.ok) throw new Error("Monitoring session unavailable");
  const value = await response.json() as Partial<Session>;
  if (typeof value.sessionId !== "string" || !Number.isSafeInteger(value.generation) || (value.generation ?? 0) < 1) {
    throw new Error("Invalid monitoring session response");
  }
  return { sessionId: value.sessionId, generation: value.generation as number };
}

async function sendSignalRequest(signal: MonitoringSignal): Promise<boolean> {
  const response = await fetch("/api/v2/monitoring/heartbeat", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(signal),
  });
  return response.ok;
}

/** Best-effort typed error signal; no client-supplied IDs, codes, or messages are accepted. */
export async function reportPlaybackFailure(lane: "music" | "ambient") {
  try {
    await fetch("/api/v2/monitoring/error", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lane }),
    });
  } catch {
    // Error analytics is a sidecar and must never affect playback.
  }
}

/** Best-effort monitoring transport: one request in flight and one coalesced latest snapshot. */
export class PlayerMonitoringSidecar {
  private session: Session | null = null;
  private pending: MonitoringSnapshot | null = null;
  private inFlight = false;
  private active = false;
  private disposed = false;
  private lastObservedKey = "";
  private musicSequence = 0;
  private ambientSequence = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly createSession: () => Promise<Session>;
  private readonly sendSignal: (signal: MonitoringSignal) => Promise<boolean>;
  private readonly random: () => number;

  constructor(private readonly readSnapshot: () => MonitoringSnapshot, options: Omit<SenderOptions, "readSnapshot"> = {}) {
    this.createSession = options.createSession ?? createSessionRequest;
    this.sendSignal = options.sendSignal ?? sendSignalRequest;
    this.random = options.random ?? Math.random;
  }

  async start(): Promise<boolean> {
    if (this.disposed || this.active) return false;
    try {
      const session = await this.createSession();
      if (this.disposed) return false;
      this.session = session;
      this.active = true;
      this.forceSignal(this.readSnapshot());
      this.scheduleHeartbeat();
      return true;
    } catch {
      // Monitoring is a sidecar. A failed session request never reaches playback controls.
      return false;
    }
  }

  update(snapshot: MonitoringSnapshot) {
    if (this.disposed) return;
    const key = JSON.stringify(snapshot);
    if (key === this.lastObservedKey) return;
    this.lastObservedKey = key;
    if (this.active) this.queue(snapshot);
  }

  dispose() {
    this.disposed = true;
    this.active = false;
    this.pending = null;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private forceSignal(snapshot: MonitoringSnapshot) {
    this.lastObservedKey = JSON.stringify(snapshot);
    this.queue(snapshot);
  }

  private queue(snapshot: MonitoringSnapshot) {
    if (!this.active || !this.session) return;
    this.pending = snapshot;
    if (!this.inFlight) void this.flush();
  }

  private async flush() {
    if (this.inFlight || !this.pending || !this.active || !this.session) return;
    const snapshot = this.pending;
    this.pending = null;
    this.inFlight = true;
    const signal: MonitoringSignal = {
      ...snapshot,
      sessionId: this.session.sessionId,
      generation: this.session.generation,
      music: { ...snapshot.music, sequence: ++this.musicSequence },
      ambient: { ...snapshot.ambient, sequence: ++this.ambientSequence },
    };
    let accepted = false;
    try { accepted = await this.sendSignal(signal); } catch { /* best effort; a later state change/heartbeat may recover */ }
    this.inFlight = false;
    if (this.disposed) return;
    // Do not spin on a failed request. Keep the newest snapshot until a later transition/heartbeat.
    if (accepted && this.pending) void this.flush();
  }

  private scheduleHeartbeat() {
    if (!this.active || this.disposed) return;
    const delay = 120_000 + Math.floor(this.random() * 15_001);
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      if (!this.active || this.disposed) return;
      this.forceSignal(this.readSnapshot());
      this.scheduleHeartbeat();
    }, delay);
  }
}

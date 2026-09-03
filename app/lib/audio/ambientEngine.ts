export interface AmbientTrack {
  id: string;
  url: string;
}

export type AmbientPlaybackStatus = "idle" | "loading" | "playing" | "error";

export interface AmbientEngineState {
  status: AmbientPlaybackStatus;
  activeTrackId: string | null;
  sourceKind: "network" | "blob" | null;
  volume: number;
  currentTime: number;
  error: string | null;
}

type Listener = () => void;
type CachedAmbient = { objectUrl: string; lastUsed: number };
type PendingFetch = { controller: AbortController; promise: Promise<void> };

const MAX_CACHED_AMBIENT = 3;
const INITIAL_STATE: AmbientEngineState = {
  status: "idle",
  activeTrackId: null,
  sourceKind: null,
  volume: 0.4,
  currentTime: 0,
  error: null,
};

export class AmbientEngine {
  private audio: HTMLAudioElement | null = null;
  private audioErrorListener: (() => void) | null = null;
  private audioEndedListener: (() => void) | null = null;
  private cache = new Map<string, CachedAmbient>();
  private pendingFetches = new Map<string, PendingFetch>();
  private usageSequence = 0;
  private listeners = new Set<Listener>();
  private state: AmbientEngineState = INITIAL_STATE;
  private generation = 0;
  private disposed = false;

  getSnapshot = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  toggle = async (track: AmbientTrack) => {
    if (this.disposed || typeof window === "undefined") return;

    if (this.state.activeTrackId === track.id) {
      this.stop();
      return;
    }

    const generation = ++this.generation;
    this.cancelPendingFetchesExcept(track.id);
    this.cleanupPlayback();

    const cached = this.cache.get(track.id);
    if (cached) cached.lastUsed = ++this.usageSequence;
    const sourceKind = cached ? "blob" : "network";
    const audio = new Audio(cached?.objectUrl ?? track.url);
    audio.preload = "auto";
    audio.loop = sourceKind === "blob";
    audio.volume = this.state.volume;
    const onError = () => {
      if (this.isPlaybackCurrent(audio, generation)) {
        this.handleError(new Error("The browser could not play this ambient track."));
      }
    };
    const onEnded = () => {
      if (sourceKind === "network" && this.isPlaybackCurrent(audio, generation)) {
        void this.handleNetworkEnded(track, audio, generation);
      }
    };
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    this.audio = audio;
    this.audioErrorListener = onError;
    this.audioEndedListener = onEnded;
    this.update({ status: "loading", activeTrackId: track.id, sourceKind, currentTime: 0, error: null });

    if (!cached) void this.ensureCached(track);

    try {
      await audio.play();
      if (!this.isPlaybackCurrent(audio, generation)) return;
      this.update({ status: "playing", currentTime: audio.currentTime });
    } catch (error) {
      if (!this.isPlaybackCurrent(audio, generation)) return;
      this.handleError(error);
    }
  };

  setVolume = (volume: number) => {
    const nextVolume = Math.min(1, Math.max(0, volume));
    if (this.audio) this.audio.volume = nextVolume;
    this.update({ volume: nextVolume, currentTime: this.audio?.currentTime ?? this.state.currentTime });
  };

  stop = () => {
    if (this.disposed) return;
    this.generation += 1;
    this.cleanupPlayback();
    this.update({ status: "idle", activeTrackId: null, sourceKind: null, currentTime: 0, error: null });
  };

  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.cleanupPlayback();
    this.pendingFetches.forEach(({ controller }) => controller.abort());
    this.pendingFetches.clear();
    this.cache.forEach(({ objectUrl }) => URL.revokeObjectURL(objectUrl));
    this.cache.clear();
    this.listeners.clear();
  };

  private ensureCached(track: AmbientTrack) {
    const existing = this.cache.get(track.id);
    if (existing) {
      existing.lastUsed = ++this.usageSequence;
      return Promise.resolve();
    }
    const pending = this.pendingFetches.get(track.id);
    if (pending && !pending.controller.signal.aborted) return pending.promise;
    if (pending) this.pendingFetches.delete(track.id);

    const controller = new AbortController();
    const promise = fetch(track.url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Ambient request failed with ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (this.disposed) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        const cached = this.cache.get(track.id);
        if (cached) {
          cached.lastUsed = ++this.usageSequence;
          URL.revokeObjectURL(objectUrl);
          return;
        }
        this.cache.set(track.id, { objectUrl, lastUsed: ++this.usageSequence });
        this.evictLeastRecentlyUsed();
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!this.disposed) console.error("[AmbientEngine] Cache", error);
      })
      .finally(() => {
        if (this.pendingFetches.get(track.id)?.controller === controller) {
          this.pendingFetches.delete(track.id);
        }
      });

    this.pendingFetches.set(track.id, { controller, promise });
    return promise;
  }

  private evictLeastRecentlyUsed() {
    while (this.cache.size > MAX_CACHED_AMBIENT) {
      let candidate: [string, CachedAmbient] | null = null;
      for (const entry of this.cache) {
        if (entry[0] === this.state.activeTrackId) continue;
        if (!candidate || entry[1].lastUsed < candidate[1].lastUsed) candidate = entry;
      }
      if (!candidate) return;
      this.cache.delete(candidate[0]);
      URL.revokeObjectURL(candidate[1].objectUrl);
    }
  }

  private cancelPendingFetchesExcept(trackId: string) {
    this.pendingFetches.forEach(({ controller }, pendingTrackId) => {
      if (pendingTrackId !== trackId) controller.abort();
    });
  }

  private isPlaybackCurrent(audio: HTMLAudioElement, generation: number) {
    return !this.disposed && this.audio === audio && this.generation === generation;
  }

  private async handleNetworkEnded(track: AmbientTrack, audio: HTMLAudioElement, generation: number) {
    const cached = this.cache.get(track.id);
    if (!cached) {
      audio.currentTime = 0;
      try {
        await audio.play();
        if (this.isPlaybackCurrent(audio, generation)) {
          this.update({ status: "playing", currentTime: audio.currentTime });
        }
      } catch (error) {
        if (this.isPlaybackCurrent(audio, generation)) this.handleError(error);
      }
      return;
    }

    cached.lastUsed = ++this.usageSequence;
    this.cleanupPlayback();
    if (this.disposed || generation !== this.generation || this.state.activeTrackId !== track.id) return;

    const blobAudio = new Audio(cached.objectUrl);
    blobAudio.preload = "auto";
    blobAudio.loop = true;
    blobAudio.volume = this.state.volume;
    const onError = () => {
      if (this.isPlaybackCurrent(blobAudio, generation)) {
        this.handleError(new Error("The browser could not play this ambient track."));
      }
    };
    blobAudio.addEventListener("error", onError);
    this.audio = blobAudio;
    this.audioErrorListener = onError;
    this.audioEndedListener = null;
    this.update({ status: "loading", sourceKind: "blob", currentTime: 0, error: null });

    try {
      await blobAudio.play();
      if (this.isPlaybackCurrent(blobAudio, generation)) {
        this.update({ status: "playing", currentTime: blobAudio.currentTime });
      }
    } catch (error) {
      if (this.isPlaybackCurrent(blobAudio, generation)) this.handleError(error);
    }
  }

  private handleError(error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load or play this ambient track.";
    console.error("[AmbientEngine]", message);
    this.generation += 1;
    this.cleanupPlayback();
    this.update({ status: "error", sourceKind: null, currentTime: 0, error: message });
  }

  private cleanupPlayback() {
    if (!this.audio) return;
    this.audio.pause();
    if (this.audioErrorListener) this.audio.removeEventListener("error", this.audioErrorListener);
    if (this.audioEndedListener) this.audio.removeEventListener("ended", this.audioEndedListener);
    this.audio.removeAttribute("src");
    this.audio.load();
    this.audio = null;
    this.audioErrorListener = null;
    this.audioEndedListener = null;
  }

  private update(patch: Partial<AmbientEngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}

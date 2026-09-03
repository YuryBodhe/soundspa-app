export interface Mp3Track {
  id: string;
  url: string;
}

export type Mp3PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface Mp3EngineState {
  status: Mp3PlaybackStatus;
  currentTrackIndex: number;
  preparedTrackIndex: number | null;
  sourceKind: "blob" | null;
  currentTime: number;
  error: string | null;
}

type CachedTrack = { index: number; objectUrl: string };
type SlotIndex = 0 | 1;
type Listener = () => void;

const INITIAL_STATE: Mp3EngineState = {
  status: "idle",
  currentTrackIndex: 0,
  preparedTrackIndex: null,
  sourceKind: null,
  currentTime: 0,
  error: null,
};

const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000] as const;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

class TrackRequestError extends Error {
  constructor(readonly status: number) {
    super(`MP3 request failed with ${status}`);
  }
}

class TrackTimeoutError extends Error {
  constructor() {
    super("MP3 download timed out");
  }
}

export class Mp3Engine {
  private audio: HTMLAudioElement | null = null;
  private slots: [CachedTrack | null, CachedTrack | null] = [null, null];
  private activeSlot: SlotIndex | null = null;
  private desiredNextIndex = 0;
  private prefetchPromise: Promise<void> | null = null;
  private loadPromise: Promise<void> | null = null;
  private fetchController: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private listeners = new Set<Listener>();
  private state: Mp3EngineState = INITIAL_STATE;
  private generation = 0;
  private requestId = 0;
  private playRequestId = 0;
  private wantsPlayback = false;
  private disposed = false;

  constructor(private readonly tracks: readonly Mp3Track[]) {
    if (tracks.length === 0) throw new Error("MP3 playlist must contain at least one track");
    if (typeof window !== "undefined") window.addEventListener("online", this.handleOnline);
  }

  getSnapshot = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  play = async () => {
    if (this.disposed || typeof window === "undefined") return;
    this.wantsPlayback = true;

    if (this.audio && this.getActiveTrack()) {
      const audio = this.audio;
      const generation = this.generation;
      const playRequestId = ++this.playRequestId;
      try {
        await audio.play();
        if (!this.isAudioOperationCurrent(audio, generation, playRequestId)) return;
        if (!this.wantsPlayback) {
          audio.pause();
          return;
        }
        this.update({ status: "playing", currentTime: audio.currentTime, error: null });
        void this.prefetchDesiredTrack();
      } catch (error) {
        if (!this.isAudioOperationCurrent(audio, generation, playRequestId) || !this.wantsPlayback) return;
        this.handlePlayError(error);
      }
      return;
    }

    if (!this.loadPromise) {
      this.loadPromise = this.loadInitialTrack().finally(() => {
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  };

  pause = () => {
    this.wantsPlayback = false;
    this.playRequestId += 1;
    this.clearRetryTimer();
    if (!this.audio) {
      if (this.state.status === "loading") this.update({ status: "paused" });
      return;
    }
    this.audio.pause();
    this.update({ status: "paused", currentTime: this.audio.currentTime });
  };

  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.wantsPlayback = false;
    this.generation += 1;
    this.requestId += 1;
    this.playRequestId += 1;
    this.clearRetryTimer();
    this.fetchController?.abort();
    this.fetchController = null;
    this.prefetchPromise = null;
    this.loadPromise = null;
    if (typeof window !== "undefined") window.removeEventListener("online", this.handleOnline);

    if (this.audio) {
      this.audio.pause();
      this.audio.removeEventListener("ended", this.handleEnded);
      this.audio.removeEventListener("error", this.handleAudioError);
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }

    const urls = new Set(this.slots.flatMap((slot) => slot ? [slot.objectUrl] : []));
    urls.forEach((url) => this.revoke(url));
    this.slots = [null, null];
    this.activeSlot = null;
    this.listeners.clear();
  };

  private loadInitialTrack = async () => {
    const generation = this.generation;
    const requestId = ++this.requestId;
    const controller = new AbortController();
    let playback: { audio: HTMLAudioElement; playRequestId: number } | null = null;
    this.fetchController = controller;
    this.update({ status: "loading", error: null });

    try {
      const cached = await this.fetchTrack(0, controller);
      if (!this.isRequestCurrent(generation, requestId)) {
        this.revoke(cached.objectUrl);
        return;
      }

      this.slots[0] = cached;
      this.activeSlot = 0;
      this.desiredNextIndex = (cached.index + 1) % this.tracks.length;

      const audio = new Audio(cached.objectUrl);
      audio.preload = "auto";
      audio.addEventListener("ended", this.handleEnded);
      audio.addEventListener("error", this.handleAudioError);
      this.audio = audio;
      this.update({
        currentTrackIndex: cached.index,
        preparedTrackIndex: null,
        sourceKind: "blob",
        currentTime: 0,
      });

      if (!this.wantsPlayback) {
        this.update({ status: "paused" });
        return;
      }

      const playRequestId = ++this.playRequestId;
      playback = { audio, playRequestId };
      await audio.play();
      if (!this.isAudioOperationCurrent(audio, generation, playRequestId)) return;
      if (!this.wantsPlayback) {
        audio.pause();
        return;
      }
      this.update({ status: "playing", currentTime: audio.currentTime });
      void this.prefetchDesiredTrack();
    } catch (error) {
      if (playback && !this.isAudioOperationCurrent(
        playback.audio,
        generation,
        playback.playRequestId,
      )) return;
      if (
        !this.isAbortError(error)
        && this.isRequestCurrent(generation, requestId)
        && this.wantsPlayback
      ) {
        this.handlePlayError(error);
      }
    } finally {
      if (this.requestId === requestId) this.fetchController = null;
    }
  };

  private fetchTrack = async (index: number, controller: AbortController): Promise<CachedTrack> => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(this.tracks[index].url, { signal: controller.signal });
      if (!response.ok) throw new TrackRequestError(response.status);
      const blob = await response.blob();
      if (timedOut) throw new TrackTimeoutError();
      return { index, objectUrl: URL.createObjectURL(blob) };
    } catch (error) {
      if (timedOut) throw new TrackTimeoutError();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  private prefetchDesiredTrack = async () => {
    if (this.disposed || this.prefetchPromise || this.activeSlot === null) return;

    const cachedSlot = this.findSlotByTrackIndex(this.desiredNextIndex);
    if (cachedSlot !== null) {
      this.clearRetryTimer();
      this.retryAttempt = 0;
      this.updatePreparedTrackIndex();
      return;
    }

    const targetIndex = this.desiredNextIndex;
    const generation = this.generation;
    const requestId = ++this.requestId;
    const controller = new AbortController();
    this.fetchController = controller;

    const promise = this.fetchTrack(targetIndex, controller)
      .then((cached) => {
        if (!this.isRequestCurrent(generation, requestId) || targetIndex !== this.desiredNextIndex) {
          this.revoke(cached.objectUrl);
          return;
        }

        const standbySlot = this.otherSlot(this.activeSlot!);
        const displaced = this.slots[standbySlot];
        this.slots[standbySlot] = cached;
        this.clearRetryTimer();
        this.retryAttempt = 0;
        this.updatePreparedTrackIndex();
        if (displaced && displaced.objectUrl !== cached.objectUrl) this.revoke(displaced.objectUrl);
      })
      .catch((error) => {
        if (this.isAbortError(error) || !this.isRequestCurrent(generation, requestId)) return;
        if (this.shouldRetry(error)) this.scheduleRecoveryRetry();
      })
      .finally(() => {
        if (this.requestId === requestId) {
          this.fetchController = null;
          this.prefetchPromise = null;
        }
      });

    this.prefetchPromise = promise;
    await promise;
  };

  private handleEnded = async () => {
    if (this.disposed || !this.audio || this.activeSlot === null) return;

    const standbySlot = this.otherSlot(this.activeSlot);
    const standby = this.slots[standbySlot];
    const nextSlot = standby ? standbySlot : this.activeSlot;
    const next = this.slots[nextSlot];
    if (!next) return;

    this.activeSlot = nextSlot;
    if (next.index === this.desiredNextIndex) {
      this.desiredNextIndex = (this.desiredNextIndex + 1) % this.tracks.length;
      this.clearRetryTimer();
      this.retryAttempt = 0;
    }

    if (this.audio.src !== next.objectUrl) this.audio.src = next.objectUrl;
    this.audio.currentTime = 0;
    this.update({
      status: this.wantsPlayback ? "loading" : "paused",
      currentTrackIndex: next.index,
      sourceKind: "blob",
      currentTime: 0,
      error: null,
    });
    this.updatePreparedTrackIndex();

    if (!this.wantsPlayback) return;
    const audio = this.audio;
    const generation = this.generation;
    const playRequestId = ++this.playRequestId;
    try {
      await audio.play();
      if (!this.isAudioOperationCurrent(audio, generation, playRequestId)) return;
      if (!this.wantsPlayback) {
        audio.pause();
        return;
      }
      this.update({ status: "playing", currentTime: audio.currentTime });
      void this.prefetchDesiredTrack();
    } catch (error) {
      if (!this.isAudioOperationCurrent(audio, generation, playRequestId) || !this.wantsPlayback) return;
      this.handlePlayError(error);
    }
  };

  private handleAudioError = () => {
    this.wantsPlayback = false;
    this.clearRetryTimer();
    this.update({ status: "error", error: "The browser could not play this MP3." });
  };

  private handleOnline = () => {
    if (this.disposed || !this.wantsPlayback || this.activeSlot === null) return;
    if (this.findSlotByTrackIndex(this.desiredNextIndex) !== null) return;
    if (this.prefetchPromise) return;
    this.clearRetryTimer();
    void this.prefetchDesiredTrack();
  };

  private scheduleRecoveryRetry() {
    if (this.disposed || !this.wantsPlayback || this.retryTimer) return;
    const delayIndex = Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1);
    const baseDelay = RETRY_DELAYS_MS[delayIndex];
    const jitteredDelay = Math.round(baseDelay * (0.9 + Math.random() * 0.2));
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.prefetchDesiredTrack();
    }, jitteredDelay);
  }

  private clearRetryTimer() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private shouldRetry(error: unknown) {
    if (!(error instanceof TrackRequestError)) return true;
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  private isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
  }

  private isRequestCurrent(generation: number, requestId: number) {
    return !this.disposed && generation === this.generation && requestId === this.requestId;
  }

  private isAudioOperationCurrent(
    audio: HTMLAudioElement,
    generation: number,
    playRequestId: number,
  ) {
    return !this.disposed
      && generation === this.generation
      && playRequestId === this.playRequestId
      && this.audio === audio;
  }

  private getActiveTrack() {
    return this.activeSlot === null ? null : this.slots[this.activeSlot];
  }

  private findSlotByTrackIndex(index: number): SlotIndex | null {
    if (this.slots[0]?.index === index) return 0;
    if (this.slots[1]?.index === index) return 1;
    return null;
  }

  private otherSlot(slot: SlotIndex): SlotIndex {
    return slot === 0 ? 1 : 0;
  }

  private updatePreparedTrackIndex() {
    if (this.activeSlot === null) {
      this.update({ preparedTrackIndex: null });
      return;
    }
    this.update({ preparedTrackIndex: this.slots[this.otherSlot(this.activeSlot)]?.index ?? null });
  }

  private handlePlayError(error: unknown) {
    this.wantsPlayback = false;
    this.clearRetryTimer();
    const message = error instanceof Error ? error.message : "Unable to load or play this MP3.";
    this.update({ status: "error", error: message });
  }

  private update(patch: Partial<Mp3EngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private revoke(objectUrl: string | null) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

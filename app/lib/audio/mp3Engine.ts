export interface Mp3Track { id: string; url: string }
export type Mp3PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";
export interface Mp3EngineState {
  status: Mp3PlaybackStatus;
  currentTrackIndex: number;
  preparedTrackIndex: number | null;
  sourceKind: "network" | "blob" | null;
  currentTime: number;
  error: string | null;
}

type CachedTrack = { index: number; objectUrl: string; cachedAt: number };
type SlotIndex = 0 | 1;
type Listener = () => void;
type AudibleSource = { kind: "network" | "blob"; trackIndex: number; slot: SlotIndex | null };
type PlaybackPhase = "idle" | "startup-buffering" | "starting-audible" | "audible-network" | "audible-blob";
type BufferHealth = "unknown" | "healthy" | "low" | "critical";

const INITIAL_STATE: Mp3EngineState = { status: "idle", currentTrackIndex: 0, preparedTrackIndex: null, sourceKind: null, currentTime: 0, error: null };
const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000] as const;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const HANDOFF_GRACE_MS = 10_000;
const HANDOFF_PROGRESS_EPSILON_SECONDS = 0.25;
const METADATA_TIMEOUT_MS = 15_000;
const BUFFER_SAMPLE_INTERVAL_MS = 500;
const STARTUP_BUFFER_SECONDS = 5;
const PROGRESSION_FREEZE_MS = 3_000;
const PROGRESSION_EPSILON_SECONDS = 0.25;
const BUFFER_RANGE_EPSILON_SECONDS = 0.1;
const BUFFER_HEALTHY_ENTER_SECONDS = 30;
const BUFFER_HEALTHY_EXIT_SECONDS = 20;
const BUFFER_CRITICAL_ENTER_SECONDS = 8;
const BUFFER_CRITICAL_EXIT_SECONDS = 12;
const CACHE_HEALTHY_STABILITY_MS = 7_000;

class TrackRequestError extends Error {
  constructor(readonly status: number) { super(`MP3 request failed with ${status}`); }
}
class TrackTimeoutError extends Error {
  constructor() { super("MP3 download timed out"); }
}

export class Mp3Engine {
  private audio: HTMLAudioElement | null = null;
  private audibleSource: AudibleSource | null = null;
  private slots: [CachedTrack | null, CachedTrack | null] = [null, null];
  private desiredNextIndex = 0;
  private cachePromise: Promise<void> | null = null;
  private cacheController: AbortController | null = null;
  private cacheAbortReason: "playback" | "dispose" | null = null;
  private cacheRequestId = 0;
  private cacheSequence = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private handoffTimer: ReturnType<typeof setTimeout> | null = null;
  private handoffStartTime = 0;
  private handoffInProgress = false;
  private phase: PlaybackPhase = "idle";
  private bufferHealth: BufferHealth = "unknown";
  private bufferSampleTimer: ReturnType<typeof setInterval> | null = null;
  private lastObservedCurrentTime = 0;
  private lastProgressAt = 0;
  private healthySince: number | null = null;
  private networkPressure = false;
  private startupId = 0;
  private startupCompletionInProgress = false;
  private cachePreparationStarted = false;
  private cacheRetryNotBefore = 0;
  private failedStartRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private failedStartRetryAttempt = 0;
  private failedStartTrackIndex: number | null = null;
  private sourceListenersCleanup: (() => void) | null = null;
  private listeners = new Set<Listener>();
  private state: Mp3EngineState = INITIAL_STATE;
  private generation = 0;
  private sourceVersion = 0;
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
    if (this.audio && this.audibleSource) {
      if (
        this.failedStartTrackIndex !== null
        && this.audibleSource.kind === "network"
        && this.audibleSource.trackIndex === this.failedStartTrackIndex
      ) {
        this.clearFailedStartRetryTimer();
        return this.startNetworkTrack(this.failedStartTrackIndex, true);
      }
      if (this.phase === "startup-buffering" || this.phase === "starting-audible") {
        return this.resumeStartupBuffering();
      }
      if (this.audibleSource.kind === "network") {
        if (this.cachePromise) this.yieldCacheToPlayback();
        this.bufferHealth = "unknown";
        this.healthySince = null;
        this.lastObservedCurrentTime = this.audio.currentTime;
        this.lastProgressAt = performance.now();
        this.networkPressure = false;
        this.update({ status: "loading", currentTime: this.audio.currentTime, error: null });
      }
      this.startBufferSampler();
      return this.playCurrentAudio();
    }
    this.desiredNextIndex = this.tracks.length > 1 ? 1 : 0;
    return this.startNetworkTrack(0);
  };

  pause = () => {
    this.wantsPlayback = false;
    this.playRequestId += 1;
    this.clearFailedStartRetryTimer();
    this.clearHandoffTimer();
    this.stopBufferSampler();
    if (!this.audio) {
      if (this.state.status === "loading") this.update({ status: "paused" });
      return;
    }
    this.audio.pause();
    if (this.phase === "startup-buffering" || this.phase === "starting-audible") {
      this.startupId += 1;
      this.startupCompletionInProgress = false;
      this.phase = "startup-buffering";
      this.audio.currentTime = 0;
    } else if (this.audibleSource?.kind === "network") {
      this.bufferHealth = "unknown";
      this.healthySince = null;
      this.networkPressure = false;
    }
    this.update({ status: "paused", currentTime: this.audio.currentTime });
    if (this.cachePreparationStarted) void this.ensureCachePipeline();
  };

  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.wantsPlayback = false;
    this.generation += 1;
    this.sourceVersion += 1;
    this.cacheRequestId += 1;
    this.playRequestId += 1;
    this.startupId += 1;
    this.stopBufferSampler();
    this.clearHandoffTimer();
    this.clearRetryTimer();
    this.clearFailedStartRecovery();
    this.cacheAbortReason = "dispose";
    this.cacheController?.abort();
    this.cacheController = null;
    this.cachePromise = null;
    this.sourceListenersCleanup?.();
    this.sourceListenersCleanup = null;
    if (typeof window !== "undefined") window.removeEventListener("online", this.handleOnline);
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    new Set(this.slots.flatMap((slot) => slot ? [slot.objectUrl] : [])).forEach((url) => this.revoke(url));
    this.slots = [null, null];
    this.audibleSource = null;
    this.phase = "idle";
    this.listeners.clear();
  };

  private startNetworkTrack = async (index: number, recoveringFailedStart = false) => {
    if (!recoveringFailedStart) this.clearFailedStartRecovery();
    const audio = recoveringFailedStart ? this.recreateAudio() : this.ensureAudio();
    this.assignSource(audio, { kind: "network", trackIndex: index, slot: null }, this.tracks[index].url);
    this.phase = "startup-buffering";
    this.bufferHealth = "unknown";
    this.lastObservedCurrentTime = 0;
    this.lastProgressAt = performance.now();
    this.healthySince = null;
    this.networkPressure = false;
    audio.muted = false;
    this.update({ status: this.wantsPlayback ? "loading" : "paused", currentTrackIndex: index, sourceKind: "network", currentTime: 0, error: null });
    this.updatePreparedTrackIndex();
    if (this.wantsPlayback) this.resumeStartupBuffering();
  };

  private startBlobTrack = async (slot: SlotIndex, position = 0) => {
    const cached = this.slots[slot];
    if (!cached) return;
    this.clearFailedStartRecovery();
    const audio = this.ensureAudio();
    this.assignSource(audio, { kind: "blob", trackIndex: cached.index, slot }, cached.objectUrl);
    this.phase = "audible-blob";
    audio.muted = false;
    this.stopBufferSampler();
    if (position > 0) {
      const version = this.sourceVersion;
      try { await this.waitForMetadata(audio, version); }
      catch (error) {
        if (this.isSourceCurrent(audio, version) && this.wantsPlayback) this.handlePlayError(error);
        return;
      }
      if (!this.isSourceCurrent(audio, version)) return;
      const maximum = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.1) : position;
      audio.currentTime = Math.min(position, maximum);
    }
    this.update({ status: this.wantsPlayback ? "loading" : "paused", currentTrackIndex: cached.index, sourceKind: "blob", currentTime: audio.currentTime, error: null });
    this.updatePreparedTrackIndex();
    if (this.wantsPlayback) await this.playCurrentAudio();
  };

  private ensureAudio() {
    if (!this.audio) { this.audio = new Audio(); this.audio.preload = "auto"; }
    return this.audio;
  }

  private recreateAudio() {
    this.sourceListenersCleanup?.();
    this.sourceListenersCleanup = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.audio = new Audio();
    this.audio.preload = "auto";
    return this.audio;
  }

  private assignSource(audio: HTMLAudioElement, source: AudibleSource, url: string) {
    this.clearHandoffTimer();
    this.stopBufferSampler();
    this.startupId += 1;
    this.startupCompletionInProgress = false;
    this.sourceListenersCleanup?.();
    this.sourceVersion += 1;
    const version = this.sourceVersion;
    this.audibleSource = source;
    audio.src = url;
    this.sourceListenersCleanup = this.attachSourceListeners(audio, version);
    audio.load();
  }

  private attachSourceListeners(audio: HTMLAudioElement, version: number) {
    const guarded = (callback: () => void) => () => { if (this.isSourceCurrent(audio, version)) callback(); };
    const onEnded = guarded(() => { void this.handleEnded(); });
    const onError = guarded(() => { void this.handleAudioError(); });
    const onPlaying = guarded(this.handlePlaybackProgress);
    const onTimeUpdate = guarded(this.handleTimeUpdate);
    const onProgress = guarded(this.evaluateBufferState);
    const onWaiting = guarded(this.handleBuffering);
    const onStalled = guarded(this.handleBuffering);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("progress", onProgress);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("progress", onProgress);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
    };
  }

  private resumeStartupBuffering = () => {
    const audio = this.audio;
    if (!audio || this.audibleSource?.kind !== "network") return;
    this.startupId += 1;
    this.phase = "startup-buffering";
    this.startupCompletionInProgress = false;
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    this.update({ status: "loading", currentTime: 0, error: null });
    this.startBufferSampler();
  };

  private completeStartup = async () => {
    const audio = this.audio;
    if (!audio || this.audibleSource?.kind !== "network" || this.startupCompletionInProgress) return;
    const generation = this.generation;
    const sourceVersion = this.sourceVersion;
    const startupId = this.startupId;
    const playRequestId = ++this.playRequestId;
    this.startupCompletionInProgress = true;
    this.phase = "starting-audible";
    audio.currentTime = 0;
    audio.muted = false;
    this.lastObservedCurrentTime = 0;
    this.lastProgressAt = performance.now();
    this.update({ status: "loading", currentTime: 0, error: null });

    try {
      await audio.play();
      if (!this.isStartupOperationCurrent(audio, generation, sourceVersion, startupId, playRequestId)) return;
      if (!this.wantsPlayback) audio.pause();
    } catch (error) {
      if (!this.isStartupOperationCurrent(audio, generation, sourceVersion, startupId, playRequestId) || !this.wantsPlayback) return;
      this.handlePlayError(error);
    } finally {
      if (this.isSourceCurrent(audio, sourceVersion) && startupId === this.startupId) {
        this.startupCompletionInProgress = false;
      }
    }
  };

  private startBufferSampler() {
    if (this.bufferSampleTimer || this.audibleSource?.kind !== "network") return;
    this.evaluateBufferState();
    this.bufferSampleTimer = setInterval(this.evaluateBufferState, BUFFER_SAMPLE_INTERVAL_MS);
  }

  private stopBufferSampler() {
    if (this.bufferSampleTimer) clearInterval(this.bufferSampleTimer);
    this.bufferSampleTimer = null;
  }

  private evaluateBufferState = () => {
    const audio = this.audio;
    if (this.disposed || !this.wantsPlayback || !audio || this.audibleSource?.kind !== "network") return;
    const now = performance.now();
    const currentTime = audio.currentTime;
    const startupBufferedSeconds = this.getStartupBufferedSeconds(audio);
    const bufferAhead = this.getBufferAhead(audio);

    if (currentTime >= this.lastObservedCurrentTime + PROGRESSION_EPSILON_SECONDS) {
      this.lastObservedCurrentTime = currentTime;
      this.lastProgressAt = now;
      this.networkPressure = false;
      this.clearHandoffTimer();
      if (this.phase === "starting-audible") {
        this.clearFailedStartRecovery();
        this.phase = "audible-network";
        this.cachePreparationStarted = true;
        this.update({ status: "playing", currentTime, error: null });
      } else if (this.phase === "audible-network" && this.state.status !== "playing") {
        this.update({ status: "playing", currentTime, error: null });
      }
    }

    if (this.phase === "startup-buffering") {
      if (startupBufferedSeconds >= STARTUP_BUFFER_SECONDS) {
        this.clearFailedStartRetryTimer();
        void this.completeStartup();
      }
      return;
    }

    if (this.phase !== "starting-audible" && this.phase !== "audible-network") return;
    const frozen = now - this.lastProgressAt >= PROGRESSION_FREEZE_MS;
    this.updateBufferHealth(bufferAhead, now, frozen);
    if (frozen) {
      this.update({ status: "loading", currentTime });
      this.yieldCacheToPlayback();
      this.handleBuffering();
      return;
    }

    this.update({ currentTime });
    if (this.canRunCache(now)) void this.ensureCachePipeline();
  };

  private getStartupBufferedSeconds(audio: HTMLAudioElement) {
    for (let index = 0; index < audio.buffered.length; index += 1) {
      if (audio.buffered.start(index) <= BUFFER_RANGE_EPSILON_SECONDS) return audio.buffered.end(index);
    }
    return 0;
  }

  private getBufferAhead(audio: HTMLAudioElement) {
    const currentTime = audio.currentTime;
    for (let index = 0; index < audio.buffered.length; index += 1) {
      if (
        audio.buffered.start(index) <= currentTime + BUFFER_RANGE_EPSILON_SECONDS
        && audio.buffered.end(index) >= currentTime
      ) return Math.max(0, audio.buffered.end(index) - currentTime);
    }
    return 0;
  }

  private updateBufferHealth(bufferAhead: number, now: number, frozen: boolean) {
    let nextHealth = this.bufferHealth;
    if (frozen || bufferAhead < BUFFER_CRITICAL_ENTER_SECONDS) nextHealth = "critical";
    else if (this.bufferHealth === "critical" && bufferAhead < BUFFER_CRITICAL_EXIT_SECONDS) nextHealth = "critical";
    else if (this.bufferHealth === "healthy" && bufferAhead >= BUFFER_HEALTHY_EXIT_SECONDS) nextHealth = "healthy";
    else if (bufferAhead >= BUFFER_HEALTHY_ENTER_SECONDS) nextHealth = "healthy";
    else nextHealth = "low";

    if (nextHealth === "healthy") {
      if (this.bufferHealth !== "healthy") this.healthySince = now;
    } else {
      this.healthySince = null;
      this.yieldCacheToPlayback();
    }
    this.bufferHealth = nextHealth;
  }

  private canRunCache(now = performance.now()) {
    if (!this.cachePreparationStarted || this.cachePromise || now < this.cacheRetryNotBefore) return false;
    if (!this.wantsPlayback) return this.state.status === "paused";
    if (this.audibleSource?.kind === "blob") return this.phase === "audible-blob";
    return this.phase === "audible-network"
      && this.bufferHealth === "healthy"
      && this.healthySince !== null
      && now - this.healthySince >= CACHE_HEALTHY_STABILITY_MS
      && !this.networkPressure
      && now - this.lastProgressAt < PROGRESSION_FREEZE_MS;
  }

  private yieldCacheToPlayback() {
    if (!this.cacheController) return;
    this.cacheAbortReason = "playback";
    this.cacheController.abort();
  }

  private playCurrentAudio = async () => {
    const audio = this.audio;
    if (!audio || !this.audibleSource) return;
    const generation = this.generation;
    const sourceVersion = this.sourceVersion;
    const playRequestId = ++this.playRequestId;
    try {
      await audio.play();
      if (!this.isAudioOperationCurrent(audio, generation, sourceVersion, playRequestId)) return;
      if (!this.wantsPlayback) { audio.pause(); return; }
      if (this.audibleSource.kind === "network") {
        this.lastObservedCurrentTime = audio.currentTime;
        this.lastProgressAt = performance.now();
        this.update({ status: "loading", currentTime: audio.currentTime, error: null });
      } else {
        this.update({ status: "playing", currentTime: audio.currentTime, error: null });
        this.clearHandoffTimer();
        void this.ensureCachePipeline();
      }
    } catch (error) {
      if (!this.isAudioOperationCurrent(audio, generation, sourceVersion, playRequestId) || !this.wantsPlayback) return;
      this.handlePlayError(error);
    }
  };

  private ensureCachePipeline = async () => {
    if (this.disposed || !this.audibleSource || !this.canRunCache()) return;
    const currentIndex = this.audibleSource.trackIndex;
    const targetIndex = this.findSlotByTrackIndex(currentIndex) === null ? currentIndex : this.desiredNextIndex;
    if (this.findSlotByTrackIndex(targetIndex) !== null) {
      this.clearRetryTimer(); this.retryAttempt = 0; this.updatePreparedTrackIndex(); return;
    }
    const generation = this.generation;
    const requestId = ++this.cacheRequestId;
    const controller = new AbortController();
    this.cacheController = controller;
    this.cacheAbortReason = null;
    let cacheSucceeded = false;
    const promise = this.fetchTrack(targetIndex, controller)
      .then((cached) => {
        if (!this.isCacheRequestCurrent(generation, requestId)) { this.revoke(cached.objectUrl); return; }
        if (this.findSlotByTrackIndex(targetIndex) !== null) { this.revoke(cached.objectUrl); return; }
        const replacementSlot = this.selectReplacementSlot();
        if (replacementSlot === null) { this.revoke(cached.objectUrl); return; }
        const displaced = this.slots[replacementSlot];
        this.slots[replacementSlot] = cached;
        cacheSucceeded = true;
        this.clearRetryTimer(); this.retryAttempt = 0; this.cacheRetryNotBefore = 0; this.updatePreparedTrackIndex();
        if (displaced && displaced.objectUrl !== cached.objectUrl) this.revoke(displaced.objectUrl);
      })
      .catch((error) => {
        if (!this.isCacheRequestCurrent(generation, requestId)) return;
        if (this.isAbortError(error)) {
          if (this.cacheAbortReason === "playback") this.scheduleRecoveryRetry();
          return;
        }
        if (this.shouldRetry(error)) this.scheduleRecoveryRetry();
      })
      .finally(() => {
        if (this.cacheRequestId === requestId) {
          this.cacheController = null;
          this.cacheAbortReason = null;
          this.cachePromise = null;
          if (!this.disposed && this.cachePreparationStarted && cacheSucceeded) queueMicrotask(() => { void this.ensureCachePipeline(); });
        }
      });
    this.cachePromise = promise;
    await promise;
  };

  private fetchTrack = async (index: number, controller: AbortController): Promise<CachedTrack> => {
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(this.tracks[index].url, { signal: controller.signal });
      if (!response.ok) throw new TrackRequestError(response.status);
      const blob = await response.blob();
      if (timedOut) throw new TrackTimeoutError();
      return { index, objectUrl: URL.createObjectURL(blob), cachedAt: ++this.cacheSequence };
    } catch (error) { if (timedOut) throw new TrackTimeoutError(); throw error; }
    finally { clearTimeout(timeout); }
  };

  private handleEnded = async () => {
    if (this.disposed || !this.audio || !this.audibleSource) return;
    if (this.phase === "startup-buffering" || this.phase === "starting-audible") {
      this.audio.currentTime = 0;
      if (this.phase === "startup-buffering" && this.wantsPlayback) void this.completeStartup();
      return;
    }
    const logicalNextIndex = this.desiredNextIndex;
    const logicalNextSlot = this.findSlotByTrackIndex(logicalNextIndex);
    if (logicalNextSlot !== null) {
      this.desiredNextIndex = (logicalNextIndex + 1) % this.tracks.length;
      this.clearRetryTimer(); this.retryAttempt = 0;
      await this.startBlobTrack(logicalNextSlot); return;
    }
    this.desiredNextIndex = (logicalNextIndex + 1) % this.tracks.length;
    await this.startNetworkTrack(logicalNextIndex);
  };

  private handleAudioError = async () => {
    if (!this.audibleSource) return;
    if (this.audibleSource.kind === "network") {
      const failedTrackIndex = this.audibleSource.trackIndex;
      const cachedSlot = this.findSlotByTrackIndex(this.audibleSource.trackIndex);
      if (cachedSlot !== null && this.wantsPlayback) { await this.handoffToBlob(cachedSlot); return; }
      const fallbackSlot = this.selectFallbackSlot();
      if (fallbackSlot !== null && this.wantsPlayback) {
        this.desiredNextIndex = failedTrackIndex;
        await this.startBlobTrack(fallbackSlot);
        return;
      }
      if (
        this.wantsPlayback
        && (this.phase === "startup-buffering" || this.phase === "starting-audible")
        && this.lastObservedCurrentTime < PROGRESSION_EPSILON_SECONDS
      ) {
        this.scheduleFailedStartRecovery(failedTrackIndex);
        return;
      }
    }
    if (this.wantsPlayback) this.handlePlayError(new Error("The browser could not play this MP3."));
  };

  private handlePlaybackProgress = () => {
    if (!this.audio || !this.audibleSource) return;
    if (this.phase === "startup-buffering" || this.phase === "starting-audible") {
      this.evaluateBufferState();
      return;
    }
    if (this.phase === "audible-network") {
      this.evaluateBufferState();
      return;
    }
    this.clearHandoffTimer();
    if (this.wantsPlayback && !this.audio.paused) this.update({ status: "playing", currentTime: this.audio.currentTime, error: null });
  };

  private handleTimeUpdate = () => {
    if (!this.audio) return;
    if (this.phase === "startup-buffering" || this.phase === "starting-audible") return;
    if (this.handoffTimer && this.audio.currentTime > this.handoffStartTime + HANDOFF_PROGRESS_EPSILON_SECONDS) this.clearHandoffTimer();
    this.update({ currentTime: this.audio.currentTime });
  };

  private handleBuffering = () => {
    if (
      !this.disposed
      && this.wantsPlayback
      && this.audio
      && this.audibleSource?.kind === "network"
      && (this.phase === "startup-buffering" || this.phase === "starting-audible")
      && this.lastObservedCurrentTime < PROGRESSION_EPSILON_SECONDS
    ) {
      this.scheduleFailedStartRecovery(this.audibleSource.trackIndex);
      return;
    }
    if (
      this.disposed
      || !this.wantsPlayback
      || !this.audio
      || this.audibleSource?.kind !== "network"
      || (this.phase !== "starting-audible" && this.phase !== "audible-network")
    ) return;
    const audio = this.audio;
    const generation = this.generation;
    const sourceVersion = this.sourceVersion;
    const trackIndex = this.audibleSource.trackIndex;
    this.networkPressure = true;
    this.yieldCacheToPlayback();
    if (this.handoffTimer || this.handoffInProgress) return;
    this.handoffStartTime = audio.currentTime;
    this.handoffTimer = setTimeout(() => {
      this.handoffTimer = null;
      if (!this.isSourceCurrent(audio, sourceVersion) || generation !== this.generation || !this.wantsPlayback || this.audibleSource?.kind !== "network" || this.audibleSource.trackIndex !== trackIndex || audio.currentTime > this.handoffStartTime + HANDOFF_PROGRESS_EPSILON_SECONDS) return;
      const cachedSlot = this.findSlotByTrackIndex(trackIndex);
      if (cachedSlot !== null) {
        void this.handoffToBlob(cachedSlot);
        return;
      }
      const fallbackSlot = this.selectFallbackSlot();
      if (fallbackSlot !== null) {
        this.desiredNextIndex = trackIndex;
        void this.startBlobTrack(fallbackSlot);
      }
    }, HANDOFF_GRACE_MS);
  };

  private handoffToBlob = async (slot: SlotIndex) => {
    if (this.disposed || this.handoffInProgress || !this.audio || !this.wantsPlayback || this.audibleSource?.kind !== "network") return;
    const cached = this.slots[slot];
    if (!cached || cached.index !== this.audibleSource.trackIndex) return;
    this.handoffInProgress = true;
    this.clearHandoffTimer();
    const position = this.audio.currentTime;
    try { await this.startBlobTrack(slot, position); }
    finally { this.handoffInProgress = false; }
  };

  private handleOnline = () => {
    if (
      this.failedStartRetryTimer
      && this.failedStartTrackIndex !== null
      && this.wantsPlayback
      && this.audibleSource?.kind === "network"
      && this.audibleSource.trackIndex === this.failedStartTrackIndex
    ) {
      const trackIndex = this.failedStartTrackIndex;
      this.clearFailedStartRetryTimer();
      void this.startNetworkTrack(trackIndex, true);
      return;
    }
    if (this.disposed || !this.cachePreparationStarted || !this.audibleSource || this.cachePromise) return;
    if (performance.now() >= this.cacheRetryNotBefore && this.canRunCache()) void this.ensureCachePipeline();
  };

  private scheduleRecoveryRetry() {
    if (this.disposed || !this.cachePreparationStarted || this.retryTimer) return;
    const baseDelay = RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)];
    const delay = Math.round(baseDelay * (0.9 + Math.random() * 0.2));
    this.retryAttempt += 1;
    this.cacheRetryNotBefore = performance.now() + delay;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.ensureCachePipeline(); }, delay);
  }

  private scheduleFailedStartRecovery(trackIndex: number) {
    if (this.disposed || !this.wantsPlayback || this.failedStartRetryTimer) return;
    this.failedStartTrackIndex = trackIndex;
    this.startupCompletionInProgress = false;
    this.phase = "startup-buffering";
    this.update({ status: "loading", currentTime: 0, error: null });
    const generation = this.generation;
    const audio = this.audio;
    const bufferedAtSchedule = audio ? this.getStartupBufferedSeconds(audio) : 0;
    const baseDelay = RETRY_DELAYS_MS[Math.min(this.failedStartRetryAttempt, RETRY_DELAYS_MS.length - 1)];
    const delay = Math.round(baseDelay * (0.9 + Math.random() * 0.2));
    this.failedStartRetryAttempt += 1;
    this.failedStartRetryTimer = setTimeout(() => {
      this.failedStartRetryTimer = null;
      if (
        this.disposed
        || !this.wantsPlayback
        || generation !== this.generation
        || this.failedStartTrackIndex !== trackIndex
        || this.audibleSource?.kind !== "network"
        || this.audibleSource.trackIndex !== trackIndex
      ) return;
      const bufferedNow = this.audio ? this.getStartupBufferedSeconds(this.audio) : 0;
      if (bufferedNow > bufferedAtSchedule + BUFFER_RANGE_EPSILON_SECONDS) {
        this.failedStartRetryAttempt = 0;
        this.scheduleFailedStartRecovery(trackIndex);
        return;
      }
      void this.startNetworkTrack(trackIndex, true);
    }, delay);
  }

  private clearFailedStartRetryTimer() {
    if (this.failedStartRetryTimer) clearTimeout(this.failedStartRetryTimer);
    this.failedStartRetryTimer = null;
  }

  private clearFailedStartRecovery() {
    this.clearFailedStartRetryTimer();
    this.failedStartRetryAttempt = 0;
    this.failedStartTrackIndex = null;
  }

  private clearRetryTimer() { if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null; }
  private clearHandoffTimer() { if (this.handoffTimer) clearTimeout(this.handoffTimer); this.handoffTimer = null; }

  private waitForMetadata(audio: HTMLAudioElement, version: number) {
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
        if (!this.isSourceCurrent(audio, version)) { resolve(); return; }
        if (error) reject(error); else resolve();
      };
      const onLoaded = () => finish();
      const onError = () => finish(new Error("The browser could not read the cached MP3."));
      const timeout = setTimeout(() => finish(new Error("Cached MP3 metadata timed out")), METADATA_TIMEOUT_MS);
      audio.addEventListener("loadedmetadata", onLoaded);
      audio.addEventListener("error", onError);
    });
  }

  private selectReplacementSlot(): SlotIndex | null {
    if (!this.slots[0]) return 0;
    if (!this.slots[1]) return 1;
    const protectedSlot = this.getProtectedSlot();
    if (protectedSlot !== null) return this.otherSlot(protectedSlot);
    return this.slots[0].cachedAt <= this.slots[1].cachedAt ? 0 : 1;
  }

  private selectFallbackSlot(): SlotIndex | null {
    const currentIndex = this.audibleSource?.trackIndex;
    const other = this.slots.map((slot, index) => ({ slot, index: index as SlotIndex })).find(({ slot }) => slot && slot.index !== currentIndex);
    if (other) return other.index;
    return this.findSlotByTrackIndex(currentIndex ?? -1);
  }

  private getProtectedSlot(): SlotIndex | null {
    if (this.audibleSource?.kind === "blob") return this.audibleSource.slot;
    return this.audibleSource ? this.findSlotByTrackIndex(this.audibleSource.trackIndex) : null;
  }

  private updatePreparedTrackIndex() {
    this.update({ preparedTrackIndex: this.findSlotByTrackIndex(this.desiredNextIndex) !== null ? this.desiredNextIndex : null });
  }
  private findSlotByTrackIndex(index: number): SlotIndex | null {
    if (this.slots[0]?.index === index) return 0;
    if (this.slots[1]?.index === index) return 1;
    return null;
  }
  private otherSlot(slot: SlotIndex): SlotIndex { return slot === 0 ? 1 : 0; }
  private shouldRetry(error: unknown) { return !(error instanceof TrackRequestError) || error.status === 408 || error.status === 429 || error.status >= 500; }
  private isAbortError(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }
  private isCacheRequestCurrent(generation: number, requestId: number) { return !this.disposed && generation === this.generation && requestId === this.cacheRequestId; }
  private isSourceCurrent(audio: HTMLAudioElement, version: number) { return !this.disposed && this.audio === audio && version === this.sourceVersion; }
  private isAudioOperationCurrent(audio: HTMLAudioElement, generation: number, version: number, playRequestId: number) {
    return generation === this.generation && playRequestId === this.playRequestId && this.isSourceCurrent(audio, version);
  }
  private isStartupOperationCurrent(
    audio: HTMLAudioElement,
    generation: number,
    version: number,
    startupId: number,
    playRequestId: number,
  ) {
    return startupId === this.startupId
      && this.isAudioOperationCurrent(audio, generation, version, playRequestId);
  }
  private handlePlayError(error: unknown) {
    this.wantsPlayback = false;
    this.stopBufferSampler();
    this.clearHandoffTimer();
    this.clearRetryTimer();
    this.clearFailedStartRecovery();
    this.update({ status: "error", error: error instanceof Error ? error.message : "Unable to load or play this MP3." });
  }
  private update(patch: Partial<Mp3EngineState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private revoke(objectUrl: string | null) { if (objectUrl) URL.revokeObjectURL(objectUrl); }
}

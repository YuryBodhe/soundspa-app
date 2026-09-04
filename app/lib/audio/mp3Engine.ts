import { MusicSessionCache, musicSessionCache } from "./musicSessionCache";

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

type CachedTrack = { index: number; cacheKey: string; objectUrl: string; cachedAt: number };
type SlotIndex = 0 | 1;
type Listener = () => void;
type AudibleSource = { kind: "network" | "blob"; trackIndex: number; slot: SlotIndex | null };
type PlaybackPhase = "idle" | "startup-buffering" | "starting-audible" | "audible-network" | "audible-blob";
type BufferHealth = "unknown" | "healthy" | "low" | "critical";
type NetworkRecoveryTarget = { trackIndex: number; position: number };

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
  private networkRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private networkRetryAttempt = 0;
  private networkRecoveryTarget: NetworkRecoveryTarget | null = null;
  private startupPosition = 0;
  private recoveryAttemptSourceVersion: number | null = null;
  private deadNetworkSourceVersion: number | null = null;
  private freezeLoggedSourceVersion: number | null = null;
  private sourceListenersCleanup: (() => void) | null = null;
  private listeners = new Set<Listener>();
  private state: Mp3EngineState = INITIAL_STATE;
  private generation = 0;
  private sourceVersion = 0;
  private playRequestId = 0;
  private wantsPlayback = false;
  private disposed = false;

  constructor(
    private readonly tracks: readonly Mp3Track[],
    private readonly sessionCache: MusicSessionCache = musicSessionCache,
  ) {
    if (tracks.length === 0) throw new Error("MP3 playlist must contain at least one track");
    this.sessionCache.logSnapshot("engine-created-before-restore");
    this.hydrateSlotsFromSessionCache();
    this.sessionCache.logSnapshot("engine-created-after-restore");
    if (typeof window !== "undefined") window.addEventListener("online", this.handleOnline);
  }

  getSnapshot = () => this.state;
  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  play = async () => {
    if (this.disposed || typeof window === "undefined") return;
    if (this.networkRecoveryTarget || this.state.status === "loading" || this.state.status === "error") {
      let path = "reuse-current-audio";
      if (this.networkRecoveryTarget && this.findSlotByTrackIndex(this.networkRecoveryTarget.trackIndex) !== null) path = "cached-blob";
      else if (this.networkRecoveryTarget && this.selectFallbackSlot() !== null) path = "cached-blob";
      else if (this.networkRecoveryTarget) path = "fresh-network-audio";
      else if (this.phase === "startup-buffering" || this.phase === "starting-audible") path = "resume-startup-buffering";
      this.logRecovery("explicit-play-during-recovery", { path, status: this.state.status, phase: this.phase });
    }
    this.wantsPlayback = true;
    if (this.audio && this.audibleSource) {
      if (
        this.networkRecoveryTarget !== null
        && this.audibleSource.kind === "network"
        && this.audibleSource.trackIndex === this.networkRecoveryTarget.trackIndex
      ) {
        const target = this.networkRecoveryTarget;
        this.clearNetworkRetryTimer();
        return this.recoverToBestAvailable(target, true);
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
    const cachedInitialSlot = this.findSlotByTrackIndex(0) ?? this.restoreTrackFromSessionCache(0);
    if (cachedInitialSlot !== null) return this.startBlobTrack(cachedInitialSlot);
    return this.startNetworkTrack(0);
  };

  pause = () => {
    this.wantsPlayback = false;
    this.playRequestId += 1;
    this.clearNetworkRetryTimer();
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
      this.audio.currentTime = this.startupPosition;
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
    this.sessionCache.logSnapshot("engine-dispose-before-cleanup");
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
    this.clearNetworkRecovery();
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

  private startNetworkTrack = async (index: number, recovering = false, position = 0) => {
    if (!recovering) this.clearNetworkRecovery();
    const audio = recovering ? this.recreateAudio() : this.ensureAudio();
    this.assignSource(audio, { kind: "network", trackIndex: index, slot: null }, this.tracks[index].url);
    const version = this.sourceVersion;
    if (recovering) {
      this.recoveryAttemptSourceVersion = version;
      this.logRecovery("new-audio-created", { sourceVersion: version, trackIndex: index, recoveryPosition: position });
    }
    this.phase = "startup-buffering";
    this.startupPosition = Math.max(0, position);
    this.bufferHealth = "unknown";
    this.lastObservedCurrentTime = this.startupPosition;
    this.lastProgressAt = performance.now();
    this.healthySince = null;
    this.networkPressure = false;
    audio.muted = false;
    this.update({ status: this.wantsPlayback ? "loading" : "paused", currentTrackIndex: index, sourceKind: "network", currentTime: this.startupPosition, error: null });
    this.updatePreparedTrackIndex();
    if (this.startupPosition > 0) {
      try { await this.waitForMetadata(audio, version); }
      catch {
        if (this.isSourceCurrent(audio, version) && this.wantsPlayback) this.scheduleNetworkRecovery(index, this.startupPosition);
        return;
      }
      if (!this.isSourceCurrent(audio, version)) return;
      const maximum = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.1) : this.startupPosition;
      audio.currentTime = Math.min(this.startupPosition, maximum);
      if (recovering) this.logRecovery("seek-restored", { requestedPosition: this.startupPosition, resultingCurrentTime: audio.currentTime });
    }
    if (this.wantsPlayback) this.resumeStartupBuffering();
  };

  private startBlobTrack = async (slot: SlotIndex, position = 0) => {
    const cached = this.slots[slot];
    if (!cached) return;
    if (!this.networkRecoveryTarget) this.clearNetworkRecovery();
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
      this.logRecovery("old-audio-destroyed", {
        oldSourceVersion: this.sourceVersion,
        currentTime: this.audio.currentTime,
        readyState: this.audio.readyState,
        networkState: this.audio.networkState,
      });
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
    this.deadNetworkSourceVersion = null;
    this.freezeLoggedSourceVersion = null;
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
    const onLoadedMetadata = guarded(() => {
      if (this.recoveryAttemptSourceVersion === version) {
        this.logRecovery("metadata-loaded", { duration: audio.duration, intendedSeekPosition: this.startupPosition });
      }
    });
    const onTimeUpdate = guarded(this.handleTimeUpdate);
    const onProgress = guarded(this.evaluateBufferState);
    const onWaiting = guarded(this.handleBuffering);
    const onStalled = guarded(this.handleBuffering);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("progress", onProgress);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
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
    audio.currentTime = this.startupPosition;
    audio.muted = false;
    this.update({ status: "loading", currentTime: this.startupPosition, error: null });
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
    audio.currentTime = this.startupPosition;
    audio.muted = false;
    this.lastObservedCurrentTime = this.startupPosition;
    this.lastProgressAt = performance.now();
    this.update({ status: "loading", currentTime: this.startupPosition, error: null });
    const isRecoveryAttempt = this.recoveryAttemptSourceVersion === sourceVersion;
    if (isRecoveryAttempt) this.logRecovery("recovery-play-requested", { sourceVersion, phase: this.phase });

    try {
      await audio.play();
      if (isRecoveryAttempt) this.logRecovery("recovery-play-resolved", { sourceVersion, phase: this.phase });
      if (!this.isStartupOperationCurrent(audio, generation, sourceVersion, startupId, playRequestId)) return;
      if (!this.wantsPlayback) audio.pause();
    } catch (error) {
      if (isRecoveryAttempt) {
        this.logRecovery("recovery-play-rejected", {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
          wantsPlayback: this.wantsPlayback,
          phase: this.phase,
          hasRecoveryTarget: this.networkRecoveryTarget !== null,
        });
      }
      if (!this.isStartupOperationCurrent(audio, generation, sourceVersion, startupId, playRequestId) || !this.wantsPlayback) return;
      if (isRecoveryAttempt && this.networkRecoveryTarget) {
        this.confirmDeadNetworkSource(this.networkRecoveryTarget);
        this.scheduleNetworkRecovery(this.networkRecoveryTarget.trackIndex, this.networkRecoveryTarget.position);
        return;
      }
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
      this.freezeLoggedSourceVersion = null;
      this.lastObservedCurrentTime = currentTime;
      this.lastProgressAt = now;
      this.networkPressure = false;
      this.clearHandoffTimer();
      if (
        this.recoveryAttemptSourceVersion === this.sourceVersion
        || this.deadNetworkSourceVersion === this.sourceVersion
      ) {
        this.logRecovery("real-progression-restored", {
          sourceVersion: this.sourceVersion,
          trackIndex: this.audibleSource.trackIndex,
          currentTime,
        });
        this.recoveryAttemptSourceVersion = null;
      }
      if (this.networkRecoveryTarget?.trackIndex === this.audibleSource.trackIndex) this.clearNetworkRecovery();
      if (this.phase === "starting-audible") {
        this.clearNetworkRecovery();
        this.phase = "audible-network";
        this.cachePreparationStarted = true;
        this.update({ status: "playing", currentTime, error: null });
      } else if (this.phase === "audible-network" && this.state.status !== "playing") {
        this.update({ status: "playing", currentTime, error: null });
      }
    }

    if (this.phase === "startup-buffering") {
      const startupReserve = this.startupPosition > BUFFER_RANGE_EPSILON_SECONDS ? bufferAhead : startupBufferedSeconds;
      if (startupReserve >= STARTUP_BUFFER_SECONDS) {
        this.logRecovery("startup-buffer-ready", { currentTime, bufferAhead, sourceVersion: this.sourceVersion });
        this.clearNetworkRetryTimer();
        void this.completeStartup();
      }
      return;
    }

    if (this.phase !== "starting-audible" && this.phase !== "audible-network") return;
    const frozen = now - this.lastProgressAt >= PROGRESSION_FREEZE_MS;
    this.updateBufferHealth(bufferAhead, now, frozen);
    if (frozen) {
      if (this.freezeLoggedSourceVersion !== this.sourceVersion) {
        this.freezeLoggedSourceVersion = this.sourceVersion;
        this.logRecovery("freeze-detected", {
          trackIndex: this.audibleSource.trackIndex,
          phase: this.phase,
          sourceKind: this.audibleSource.kind,
          currentTime,
          bufferAhead,
          readyState: audio.readyState,
          networkState: audio.networkState,
          paused: audio.paused,
          wantsPlayback: this.wantsPlayback,
        });
      }
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
    if (this.restoreTrackFromSessionCache(targetIndex) !== null) {
      this.clearRetryTimer(); this.retryAttempt = 0; this.updatePreparedTrackIndex();
      queueMicrotask(() => { void this.ensureCachePipeline(); });
      return;
    }
    const generation = this.generation;
    const requestId = ++this.cacheRequestId;
    const controller = new AbortController();
    this.cacheController = controller;
    this.cacheAbortReason = null;
    let cacheSucceeded = false;
    const targetUrl = this.tracks[targetIndex].url;
    this.logMusicCache("full-fetch-start", { trackIndex: targetIndex, trackUrl: targetUrl });
    const promise = this.fetchTrack(targetIndex, controller)
      .then((blob) => {
        this.logMusicCache("full-fetch-complete", { trackIndex: targetIndex, trackUrl: targetUrl, blobSize: blob.size });
        if (!this.isCacheRequestCurrent(generation, requestId)) return;
        if (this.findSlotByTrackIndex(targetIndex) !== null) return;
        const replacementSlot = this.selectReplacementSlot();
        if (replacementSlot === null) return;
        const cacheKey = this.tracks[targetIndex].url;
        this.sessionCache.put(cacheKey, blob, this.getProtectedCacheKeys());
        const cached = this.createCachedTrack(targetIndex, cacheKey, blob);
        const displaced = this.slots[replacementSlot];
        this.slots[replacementSlot] = cached;
        cacheSucceeded = true;
        this.clearRetryTimer(); this.retryAttempt = 0; this.cacheRetryNotBefore = 0; this.updatePreparedTrackIndex();
        if (displaced && displaced.objectUrl !== cached.objectUrl) this.revoke(displaced.objectUrl);
        const recoveryTarget = this.networkRecoveryTarget;
        if (
          recoveryTarget?.trackIndex === targetIndex
          && this.wantsPlayback
          && this.audibleSource?.kind === "network"
        ) {
          queueMicrotask(() => { void this.recoverToBestAvailable(recoveryTarget, false); });
        }
      })
      .catch((error) => {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        this.logMusicCache(this.isAbortError(error) ? "full-fetch-abort" : "full-fetch-failed", {
          trackIndex: targetIndex,
          trackUrl: targetUrl,
          reason: this.isAbortError(error) ? this.cacheAbortReason ?? reason : reason,
        });
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

  private fetchTrack = async (index: number, controller: AbortController): Promise<Blob> => {
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(this.tracks[index].url, { signal: controller.signal });
      if (!response.ok) throw new TrackRequestError(response.status);
      const blob = await response.blob();
      if (timedOut) throw new TrackTimeoutError();
      return blob;
    } catch (error) { if (timedOut) throw new TrackTimeoutError(); throw error; }
    finally { clearTimeout(timeout); }
  };

  private handleEnded = async () => {
    if (this.disposed || !this.audio || !this.audibleSource) return;
    if (this.phase === "startup-buffering" || this.phase === "starting-audible") {
      this.audio.currentTime = this.startupPosition;
      if (this.phase === "startup-buffering" && this.wantsPlayback) void this.completeStartup();
      return;
    }
    if (this.audibleSource.kind === "blob" && this.networkRecoveryTarget) {
      const target = this.networkRecoveryTarget;
      const targetSlot = this.findSlotByTrackIndex(target.trackIndex);
      if (targetSlot !== null) {
        this.desiredNextIndex = (target.trackIndex + 1) % this.tracks.length;
        this.clearNetworkRecovery();
        await this.startBlobTrack(targetSlot, target.position);
        return;
      }
      const fallbackSlot = this.selectFallbackSlot();
      if (fallbackSlot !== null) {
        await this.startBlobTrack(fallbackSlot);
        void this.ensureCachePipeline();
        return;
      }
    }
    const logicalNextIndex = this.desiredNextIndex;
    const logicalNextSlot = this.findSlotByTrackIndex(logicalNextIndex);
    if (logicalNextSlot !== null) {
      this.desiredNextIndex = (logicalNextIndex + 1) % this.tracks.length;
      this.clearRetryTimer(); this.retryAttempt = 0;
      await this.startBlobTrack(logicalNextSlot); return;
    }
    const fallbackSlot = this.selectFallbackSlot();
    if (fallbackSlot !== null) {
      this.setNetworkRecoveryTarget(logicalNextIndex, 0);
      await this.startBlobTrack(fallbackSlot);
      void this.ensureCachePipeline();
      return;
    }
    this.desiredNextIndex = (logicalNextIndex + 1) % this.tracks.length;
    await this.startNetworkTrack(logicalNextIndex);
  };

  private handleAudioError = async () => {
    if (!this.audibleSource) return;
    if (this.audibleSource.kind === "network") {
      const failedTrackIndex = this.audibleSource.trackIndex;
      if (this.wantsPlayback) {
        const target = this.setNetworkRecoveryTarget(failedTrackIndex, this.getRecoveryPosition());
        const recoveredLocally = await this.recoverToBestAvailable(target, false);
        if (!recoveredLocally) {
          if (
            this.phase === "audible-network"
            || this.recoveryAttemptSourceVersion === this.sourceVersion
          ) this.confirmDeadNetworkSource(target);
          this.scheduleNetworkRecovery(target.trackIndex, target.position);
        }
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
      this.scheduleNetworkRecovery(this.audibleSource.trackIndex, this.getRecoveryPosition());
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
    if (this.deadNetworkSourceVersion === this.sourceVersion && this.networkRecoveryTarget) {
      if (!this.networkRetryTimer) {
        this.scheduleNetworkRecovery(this.networkRecoveryTarget.trackIndex, this.networkRecoveryTarget.position);
      }
      return;
    }
    if (this.handoffTimer || this.handoffInProgress) return;
    this.handoffStartTime = audio.currentTime;
    this.logRecovery("handoff-grace-started", { currentTime: audio.currentTime, bufferAhead: this.getBufferAhead(audio) });
    this.handoffTimer = setTimeout(() => {
      this.handoffTimer = null;
      const cachedSlot = this.findSlotByTrackIndex(trackIndex);
      const guardState = {
        sourceCurrent: this.isSourceCurrent(audio, sourceVersion),
        generationMatches: generation === this.generation,
        wantsPlayback: this.wantsPlayback,
        sourceKind: this.audibleSource?.kind ?? null,
        trackIndex: this.audibleSource?.trackIndex ?? null,
        expectedTrackIndex: trackIndex,
        progressed: audio.currentTime > this.handoffStartTime + HANDOFF_PROGRESS_EPSILON_SECONDS,
        phase: this.phase,
        paused: audio.paused,
        sourceVersion: this.sourceVersion,
        expectedSourceVersion: sourceVersion,
      };
      this.logRecovery("handoff-grace-fired", {
        currentTime: audio.currentTime,
        bufferAhead: this.getBufferAhead(audio),
        blobAvailable: this.slots.some((slot) => slot !== null),
        sameTrackBlobAvailable: cachedSlot !== null,
        ...guardState,
      });
      const skipReason = !guardState.sourceCurrent ? "source-not-current"
        : !guardState.generationMatches ? "generation-mismatch"
          : !guardState.wantsPlayback ? "playback-not-wanted"
            : guardState.sourceKind !== "network" ? "source-not-network"
              : guardState.trackIndex !== trackIndex ? "track-mismatch"
                : guardState.progressed ? "playback-progressed" : null;
      if (skipReason) {
        this.logRecovery("handoff-grace-skipped", { reason: skipReason, ...guardState });
        return;
      }
      if (cachedSlot !== null) {
        void this.handoffToBlob(cachedSlot);
        return;
      }
      const fallbackSlot = this.selectFallbackSlot();
      if (fallbackSlot !== null) {
        const target = this.setNetworkRecoveryTarget(trackIndex, this.handoffStartTime);
        void this.recoverToBestAvailable(target, false);
        return;
      }
      const target = this.setNetworkRecoveryTarget(trackIndex, this.handoffStartTime);
      this.confirmDeadNetworkSource(target);
      this.scheduleNetworkRecovery(trackIndex, this.handoffStartTime);
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
    this.logRecovery("online-received", {
      wantsPlayback: this.wantsPlayback,
      sourceKind: this.audibleSource?.kind ?? null,
      phase: this.phase,
      hasRecoveryTarget: this.networkRecoveryTarget !== null,
      hasNetworkRetryTimer: this.networkRetryTimer !== null,
      currentTime: this.audio?.currentTime ?? null,
      bufferAhead: this.audio ? this.getBufferAhead(this.audio) : 0,
    });
    if (
      this.networkRecoveryTarget !== null
      && this.wantsPlayback
      && this.audibleSource?.kind === "network"
      && this.audibleSource.trackIndex === this.networkRecoveryTarget.trackIndex
      && (
        this.networkRetryTimer !== null
        || this.deadNetworkSourceVersion === this.sourceVersion
      )
    ) {
      const target = this.networkRecoveryTarget;
      this.clearNetworkRetryTimer();
      void this.recoverToBestAvailable(target, true);
      return;
    }
    if (this.networkRecoveryTarget && this.audibleSource?.kind === "blob" && this.wantsPlayback) {
      this.clearRetryTimer();
      this.cacheRetryNotBefore = 0;
      void this.ensureCachePipeline();
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

  private scheduleNetworkRecovery(trackIndex: number, position: number) {
    if (this.disposed || !this.wantsPlayback) return;
    this.setNetworkRecoveryTarget(trackIndex, position);
    if (this.networkRetryTimer) return;
    const target = this.networkRecoveryTarget;
    if (!target) return;
    this.startupPosition = target.position;
    this.startupCompletionInProgress = false;
    const sourceVersionAtSchedule = this.sourceVersion;
    const confirmedDeadSource = this.deadNetworkSourceVersion === sourceVersionAtSchedule;
    if (!confirmedDeadSource) this.phase = "startup-buffering";
    this.update({ status: "loading", currentTime: target.position, error: null });
    const generation = this.generation;
    const audio = this.audio;
    const bufferedAtSchedule = audio ? this.getBufferAhead(audio) : 0;
    const currentTimeAtSchedule = audio?.currentTime ?? target.position;
    const nextAttempt = this.networkRetryAttempt + 1;
    const baseDelay = RETRY_DELAYS_MS[Math.min(nextAttempt - 1, RETRY_DELAYS_MS.length - 1)];
    const delay = Math.round(baseDelay * (0.9 + Math.random() * 0.2));
    this.logRecovery("network-retry-scheduled", {
      retryAttempt: nextAttempt,
      delay,
      savedPosition: target.position,
    });
    this.networkRetryTimer = setTimeout(() => {
      this.networkRetryTimer = null;
      const currentTimeNow = this.audio?.currentTime ?? target.position;
      const bufferedNow = this.audio ? this.getBufferAhead(this.audio) : 0;
      const skipReason = this.disposed ? "disposed"
        : !this.wantsPlayback ? "playback-not-wanted"
          : generation !== this.generation ? "generation-mismatch"
            : sourceVersionAtSchedule !== this.sourceVersion ? "source-version-mismatch"
              : this.networkRecoveryTarget?.trackIndex !== trackIndex ? "recovery-target-mismatch" : null;
      if (skipReason) {
        this.logRecovery("network-retry-skipped", { reason: skipReason });
        return;
      }
      const recoveryTarget = this.networkRecoveryTarget;
      if (!recoveryTarget) return;
      if (this.audibleSource?.kind === "blob") {
        this.logRecovery("network-retry-skipped", { reason: "audible-blob-kept-playing" });
        void this.ensureCachePipeline();
        return;
      }
      if (this.audibleSource?.trackIndex !== trackIndex) {
        this.logRecovery("network-retry-skipped", { reason: "audible-track-mismatch" });
        return;
      }
      if (
        !confirmedDeadSource
        && bufferedNow > bufferedAtSchedule + BUFFER_RANGE_EPSILON_SECONDS
        && currentTimeNow >= currentTimeAtSchedule + PROGRESSION_EPSILON_SECONDS
      ) {
        this.logRecovery("retry-postponed-buffer-growth", {
          bufferedAtSchedule,
          bufferedNow,
          bufferDelta: bufferedNow - bufferedAtSchedule,
          currentTimeAtSchedule,
          currentTimeNow,
        });
        this.networkRetryAttempt = 0;
        this.scheduleNetworkRecovery(trackIndex, this.getRecoveryPosition());
        return;
      }
      this.networkRetryAttempt = nextAttempt;
      this.logRecovery("network-retry-fired", {
        retryAttempt: this.networkRetryAttempt,
        bufferedAtSchedule,
        bufferedNow,
        bufferDelta: bufferedNow - bufferedAtSchedule,
        currentTimeAtSchedule,
        currentTimeNow,
        realPlaybackProgression: currentTimeNow >= currentTimeAtSchedule + PROGRESSION_EPSILON_SECONDS,
      });
      void this.recoverToBestAvailable(recoveryTarget, true);
    }, delay);
  }

  private setNetworkRecoveryTarget(trackIndex: number, position: number) {
    if (this.networkRecoveryTarget?.trackIndex === trackIndex) {
      const previousPosition = this.networkRecoveryTarget.position;
      this.networkRecoveryTarget.position = Math.max(this.networkRecoveryTarget.position, position);
      if (this.networkRecoveryTarget.position !== previousPosition) {
        this.logRecovery("recovery-target-set", { trackIndex, savedPosition: this.networkRecoveryTarget.position });
      }
      return this.networkRecoveryTarget;
    }
    const target = { trackIndex, position: Math.max(0, position) };
    this.networkRecoveryTarget = target;
    this.logRecovery("recovery-target-set", { trackIndex, savedPosition: target.position });
    return target;
  }

  private recoverToBestAvailable = async (target: NetworkRecoveryTarget, allowNetwork: boolean) => {
    if (
      this.disposed
      || !this.wantsPlayback
      || this.networkRecoveryTarget?.trackIndex !== target.trackIndex
    ) return false;

    const sameTrackSlot = this.findSlotByTrackIndex(target.trackIndex);
    if (sameTrackSlot !== null) {
      this.clearNetworkRecovery();
      await this.startBlobTrack(sameTrackSlot, target.position);
      return true;
    }

    const fallbackSlot = this.selectFallbackSlot();
    if (fallbackSlot !== null) {
      this.desiredNextIndex = target.trackIndex;
      await this.startBlobTrack(fallbackSlot);
      if (!this.disposed && this.wantsPlayback && this.networkRecoveryTarget?.trackIndex === target.trackIndex) {
        void this.ensureCachePipeline();
      }
      return true;
    }

    if (!allowNetwork) return false;
    await this.startNetworkTrack(target.trackIndex, true, target.position);
    return true;
  }

  private getRecoveryPosition() {
    return Math.max(this.networkRecoveryTarget?.position ?? 0, this.audio?.currentTime ?? 0, this.state.currentTime);
  }

  private confirmDeadNetworkSource(target: NetworkRecoveryTarget) {
    if (this.audibleSource?.kind !== "network" || this.deadNetworkSourceVersion === this.sourceVersion) return;
    this.deadNetworkSourceVersion = this.sourceVersion;
    this.logRecovery("dead-source-confirmed", {
      sourceVersion: this.sourceVersion,
      currentTime: this.audio?.currentTime ?? target.position,
      recoveryTarget: { trackIndex: target.trackIndex, position: target.position },
    });
  }

  private clearNetworkRetryTimer() {
    if (this.networkRetryTimer) clearTimeout(this.networkRetryTimer);
    this.networkRetryTimer = null;
  }

  private clearNetworkRecovery() {
    this.clearNetworkRetryTimer();
    this.networkRetryAttempt = 0;
    this.networkRecoveryTarget = null;
    this.deadNetworkSourceVersion = null;
    this.recoveryAttemptSourceVersion = null;
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

  private hydrateSlotsFromSessionCache() {
    for (let index = 0; index < this.tracks.length && this.slots.some((slot) => slot === null); index += 1) {
      this.restoreTrackFromSessionCache(index);
    }
  }

  private restoreTrackFromSessionCache(index: number): SlotIndex | null {
    const existingSlot = this.findSlotByTrackIndex(index);
    if (existingSlot !== null) return existingSlot;
    const cacheKey = this.tracks[index]?.url;
    if (!cacheKey) return null;
    const blob = this.sessionCache.get(cacheKey);
    this.logMusicCache("engine-cache-restore", {
      trackIndex: index,
      trackUrl: cacheKey,
      hit: blob !== null,
      ...(blob ? { blobSize: blob.size } : {}),
    });
    if (!blob) return null;
    const replacementSlot = this.selectReplacementSlot();
    if (replacementSlot === null) return null;
    const displaced = this.slots[replacementSlot];
    this.slots[replacementSlot] = this.createCachedTrack(index, cacheKey, blob);
    if (displaced) this.revoke(displaced.objectUrl);
    return replacementSlot;
  }

  private createCachedTrack(index: number, cacheKey: string, blob: Blob): CachedTrack {
    return { index, cacheKey, objectUrl: URL.createObjectURL(blob), cachedAt: ++this.cacheSequence };
  }

  private getProtectedCacheKeys() {
    const protectedKeys = new Set<string>();
    const protectedSlot = this.getProtectedSlot();
    if (protectedSlot !== null) protectedKeys.add(this.slots[protectedSlot]!.cacheKey);
    return protectedKeys;
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
    this.logRecovery("terminal-handlePlayError", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      phase: this.phase,
      sourceKind: this.audibleSource?.kind ?? null,
      wantsPlaybackBeforeReset: this.wantsPlayback,
      hasRecoveryTarget: this.networkRecoveryTarget !== null,
      sourceVersion: this.sourceVersion,
    });
    this.wantsPlayback = false;
    this.stopBufferSampler();
    this.clearHandoffTimer();
    this.clearRetryTimer();
    this.clearNetworkRecovery();
    this.update({ status: "error", error: error instanceof Error ? error.message : "Unable to load or play this MP3." });
  }
  private update(patch: Partial<Mp3EngineState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private logRecovery(event: string, details: Record<string, unknown>) { console.info(`[Mp3Recovery] ${event}`, details); }
  private logMusicCache(event: string, details: Record<string, unknown>) { console.info(`[MusicSessionCache] ${event}`, details); }
  private revoke(objectUrl: string | null) { if (objectUrl) URL.revokeObjectURL(objectUrl); }
}

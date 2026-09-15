import { ambientOverlapDiagnosticsEnabled, recordAmbientOverlapDiagnostic } from "./ambientOverlapDiagnostics";
import { PersistentAmbientDecks } from "./persistentAmbientDecks";

export interface AmbientTrack { id: string; url: string; }
export type AmbientPlaybackStatus = "idle" | "loading" | "playing" | "error";
export interface AmbientEngineState { status: AmbientPlaybackStatus; activeTrackId: string | null; sourceKind: "network" | "blob" | null; volume: number; currentTime: number; error: string | null; }

type Listener = () => void;
type CachedAmbient = { objectUrl: string; lastUsed: number };
type PendingFetch = { controller: AbortController; promise: Promise<void> };
type CandidateDeck = {
  audio: HTMLAudioElement; sourceNode: MediaElementAudioSourceNode | null; track: AmbientTrack;
  index: number; generation: number; started: boolean; progressed: boolean; startTime: number;
  progressTimer: ReturnType<typeof setInterval> | null;
  transitionTimer: ReturnType<typeof setTimeout> | null;
  transitionId: number; currentTimeAtPlay: number; lastSampleAt: number; realOverlapProven: boolean;
  onError: () => void; onLoadedMetadata: () => void;
};

const MAX_CACHED_AMBIENT = 3;
const OVERLAP_SECONDS = 3;
const CANDIDATE_PREPARE_SECONDS = 6;
const CANDIDATE_PROGRESS_TIMEOUT_MS = 2_000;
const CANDIDATE_PROGRESS_INTERVAL_MS = 100;
// Give A a short grace after its calculated end; then prefer already-progressing B over indefinite double playback.
const OVERLAP_END_TOLERANCE_MS = 1_500;
const INITIAL_STATE: AmbientEngineState = { status: "idle", activeTrackId: null, sourceKind: null, volume: 0.4, currentTime: 0, error: null };

export function ambientOverlapEnabled() { return process.env.NEXT_PUBLIC_V2_AMBIENT_OVERLAP === "1"; }
export function persistentAmbientDecksEnabled() { return process.env.NEXT_PUBLIC_V2_AMBIENT_PERSISTENT_DECKS === "1"; }

export class AmbientEngine {
  private audio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private mediaSourceNode: MediaElementAudioSourceNode | null = null;
  private audioErrorListener: (() => void) | null = null;
  private audioEndedListener: (() => void) | null = null;
  private audioTimeUpdateListener: (() => void) | null = null;
  private candidate: CandidateDeck | null = null;
  private persistentDecks: PersistentAmbientDecks | null = null;
  private playlist: readonly AmbientTrack[] = [];
  private activeTrackIndex = 0;
  private activeSelectionId: string | null = null;
  private candidateAttemptedForCurrent = false;
  private transitionSequence = 0;
  private diagnosticOnceKeys = new Set<string>();
  private readonly overlapEnabled: boolean;
  private cache = new Map<string, CachedAmbient>();
  private pendingFetches = new Map<string, PendingFetch>();
  private usageSequence = 0;
  private listeners = new Set<Listener>();
  private state: AmbientEngineState = INITIAL_STATE;
  private generation = 0;
  private disposed = false;

  constructor(overlapEnabled = ambientOverlapEnabled()) { this.overlapEnabled = overlapEnabled; }
  getSnapshot = () => this.state;
  subscribe = (listener: Listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  toggle = async (track: AmbientTrack) => {
    if (this.disposed || typeof window === "undefined") return;
    if (this.state.activeTrackId === track.id) { this.stop(); return; }
    this.requestPlaybackAudioSession();
    const generation = ++this.generation;
    this.cancelPendingFetchesExcept(new Set([track.id]));
    this.cleanupPlayback();
    const cached = this.cache.get(track.id);
    if (cached) cached.lastUsed = ++this.usageSequence;
    const sourceKind = cached ? "blob" : "network";
    const audio = new Audio(cached?.objectUrl ?? track.url);
    audio.preload = "auto";
    audio.loop = sourceKind === "blob";
    audio.volume = this.state.volume;
    this.mediaSourceNode = this.attachToAudioGraph(audio);
    this.resumeAudioContext();
    const onError = () => {
      if (this.isPlaybackCurrent(audio, generation)) this.handleError(new Error("The browser could not play this ambient track."));
    };
    const onEnded = () => {
      if (sourceKind === "network" && this.isPlaybackCurrent(audio, generation)) void this.handleNetworkEnded(track, audio, generation);
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
      if (this.isPlaybackCurrent(audio, generation)) this.update({ status: "playing", currentTime: audio.currentTime });
    } catch (error) { if (this.isPlaybackCurrent(audio, generation)) this.handleError(error); }
  };

  togglePlaylist = async (selectionId: string, tracks: readonly AmbientTrack[]) => {
    if (this.disposed || typeof window === "undefined" || tracks.length === 0) return;
    if (!this.overlapEnabled) { await this.toggle(tracks[0]); return; }
    if (this.activeSelectionId === selectionId) { this.stop(); return; }
    if (persistentAmbientDecksEnabled() && tracks.length === 1) {
      this.startPersistentOneTrack(selectionId, tracks[0]);
      return;
    }
    if (this.candidate) this.diagnostic("overlap-cancelled", { transitionId: this.candidate.transitionId, reason: "channel-switch" });
    this.requestPlaybackAudioSession();
    const generation = ++this.generation;
    this.cancelPendingFetchesExcept(new Set(tracks.map((track) => track.id)));
    this.cleanupPlayback();
    this.playlist = tracks;
    this.activeTrackIndex = 0;
    this.activeSelectionId = selectionId;
    await this.startPlaylistTrack(0, generation);
  };

  setVolume = (volume: number) => {
    const nextVolume = Math.min(1, Math.max(0, volume));
    if (this.audio) this.audio.volume = nextVolume;
    if (this.candidate) this.candidate.audio.volume = nextVolume;
    if (this.gainNode) this.gainNode.gain.value = nextVolume;
    this.persistentDecks?.setVolume(nextVolume);
    this.update({ volume: nextVolume, currentTime: this.audio?.currentTime ?? this.state.currentTime });
  };

  stop = () => {
    if (this.disposed) return;
    if (this.candidate) this.diagnostic("overlap-cancelled", { transitionId: this.candidate.transitionId, reason: "stop" });
    this.generation += 1;
    this.cleanupPlayback();
    this.playlist = [];
    this.activeTrackIndex = 0;
    this.activeSelectionId = null;
    this.candidateAttemptedForCurrent = false;
    this.update({ status: "idle", activeTrackId: null, sourceKind: null, currentTime: 0, error: null });
  };

  dispose = () => {
    if (this.disposed) return;
    if (this.candidate) this.diagnostic("overlap-cancelled", { transitionId: this.candidate.transitionId, reason: "dispose" });
    this.disposed = true;
    this.generation += 1;
    this.cleanupPlayback();
    this.pendingFetches.forEach(({ controller }) => controller.abort());
    this.pendingFetches.clear();
    this.cache.forEach(({ objectUrl }) => URL.revokeObjectURL(objectUrl));
    this.cache.clear();
    const audioContext = this.audioContext;
    this.audioContext = null;
    this.gainNode = null;
    if (audioContext) void audioContext.close().catch(() => undefined);
    this.listeners.clear();
  };

  private async startPlaylistTrack(index: number, generation: number) {
    const track = this.playlist[index];
    if (!track || !this.isGenerationCurrent(generation)) return;
    this.activeTrackIndex = index;
    this.candidateAttemptedForCurrent = false;
    const cached = this.cache.get(track.id);
    if (cached) cached.lastUsed = ++this.usageSequence;
    const sourceKind = cached ? "blob" : "network";
    const audio = new Audio(cached?.objectUrl ?? track.url);
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = this.state.volume;
    this.mediaSourceNode = this.attachToAudioGraph(audio);
    this.resumeAudioContext();
    this.installPlaylistListeners(audio, generation);
    this.audio = audio;
    this.update({ status: "loading", activeTrackId: track.id, sourceKind, currentTime: 0, error: null });
    if (!cached) void this.ensureCached(track).then(() => { if (this.isPlaybackCurrent(audio, generation)) this.prepareNextTrack(generation); });
    else this.prepareNextTrack(generation);
    try {
      await audio.play();
      if (this.isPlaybackCurrent(audio, generation)) this.update({ status: "playing", currentTime: audio.currentTime });
    } catch (error) { if (this.isPlaybackCurrent(audio, generation)) this.handleError(error); }
  }

  private installPlaylistListeners(audio: HTMLAudioElement, generation: number) {
    const onError = () => { if (this.isPlaybackCurrent(audio, generation)) this.handleError(new Error("The browser could not play this ambient track.")); };
    const onEnded = () => {
      if (!this.isPlaybackCurrent(audio, generation)) return;
      void this.handlePlaylistEnded(audio, generation);
    };
    const onTimeUpdate = () => {
      if (!this.isPlaybackCurrent(audio, generation)) return;
      this.update({ currentTime: audio.currentTime });
      this.captureOverlapSample(audio, generation);
      this.maybePrepareCandidate(generation);
      this.maybeStartCandidate(generation);
    };
    audio.addEventListener("error", onError); audio.addEventListener("ended", onEnded); audio.addEventListener("timeupdate", onTimeUpdate);
    this.audioErrorListener = onError; this.audioEndedListener = onEnded; this.audioTimeUpdateListener = onTimeUpdate;
  }

  private ensureCached(track: AmbientTrack) {
    const existing = this.cache.get(track.id);
    if (existing) { existing.lastUsed = ++this.usageSequence; return Promise.resolve(); }
    const pending = this.pendingFetches.get(track.id);
    if (pending && !pending.controller.signal.aborted) return pending.promise;
    if (pending) this.pendingFetches.delete(track.id);
    const controller = new AbortController();
    const promise = fetch(track.url, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`Ambient request failed with ${response.status}`); return response.blob(); })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (this.disposed) { URL.revokeObjectURL(objectUrl); return; }
        const cached = this.cache.get(track.id);
        if (cached) { cached.lastUsed = ++this.usageSequence; URL.revokeObjectURL(objectUrl); return; }
        this.cache.set(track.id, { objectUrl, lastUsed: ++this.usageSequence });
        this.diagnostic("next-blob-ready", { trackId: track.id, blobSize: blob.size });
        if (this.state.activeTrackId === track.id) this.persistentDecks?.setBlobUrl(objectUrl);
        this.evictLeastRecentlyUsed();
      })
      .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; if (!this.disposed) console.error("[AmbientEngine] Cache", error); })
      .finally(() => { if (this.pendingFetches.get(track.id)?.controller === controller) this.pendingFetches.delete(track.id); });
    this.pendingFetches.set(track.id, { controller, promise });
    return promise;
  }

  private prepareNextTrack(generation: number) {
    if (!this.overlapEnabled || !this.isGenerationCurrent(generation) || this.candidate || this.playlist.length === 0) return;
    const nextIndex = (this.activeTrackIndex + 1) % this.playlist.length;
    const nextTrack = this.playlist[nextIndex];
    const cached = this.cache.get(nextTrack.id);
    if (!cached) { void this.ensureCached(nextTrack).then(() => { if (this.isGenerationCurrent(generation)) this.maybePrepareCandidate(generation); }); return; }
    this.maybePrepareCandidate(generation);
  }

  private maybePrepareCandidate(generation: number) {
    const current = this.audio;
    if (!current || !this.overlapEnabled || !this.isPlaybackCurrent(current, generation) || this.candidate || this.candidateAttemptedForCurrent || this.playlist.length === 0 ||
      !Number.isFinite(current.duration) || current.duration - current.currentTime > CANDIDATE_PREPARE_SECONDS) return;
    const nextIndex = (this.activeTrackIndex + 1) % this.playlist.length;
    const nextTrack = this.playlist[nextIndex];
    const cached = this.cache.get(nextTrack.id);
    if (!cached) { this.diagnosticOnce(`not-ready:${generation}:${nextTrack.id}`, "fallback", { reason: "candidate-not-blob-ready", generation, currentTrackId: this.state.activeTrackId, nextTrackId: nextTrack.id, currentTime: current.currentTime, duration: current.duration }); return; }
    this.candidateAttemptedForCurrent = true;
    cached.lastUsed = ++this.usageSequence;
    const audio = new Audio(cached.objectUrl);
    const transitionId = ++this.transitionSequence;
    this.diagnostic("candidate-window", { transitionId, generation, currentTrackId: this.state.activeTrackId, nextTrackId: nextTrack.id, currentTime: current.currentTime, duration: current.duration, overlapStart: current.duration - OVERLAP_SECONDS, allowed: true });
    this.diagnostic("candidate-audio-created", { transitionId, generation, trackId: nextTrack.id, selfOverlap: nextTrack.id === this.state.activeTrackId, sameObjectUrl: current.src === cached.objectUrl });
    let sourceNode: MediaElementAudioSourceNode | null = null;
    try {
      audio.preload = "auto"; audio.loop = false; audio.volume = this.state.volume;
      sourceNode = this.attachToAudioGraph(audio);
    } catch (error) {
      this.diagnostic("fallback", { transitionId, reason: "graph-error", error: error instanceof Error ? error.message : String(error) });
      audio.pause();
      sourceNode?.disconnect();
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    const candidate: CandidateDeck = {
      audio, sourceNode, track: nextTrack, index: nextIndex, generation, started: false, progressed: false, startTime: 0,
      progressTimer: null, transitionTimer: null,
      transitionId, currentTimeAtPlay: 0, lastSampleAt: 0, realOverlapProven: false,
      onError: () => { if (this.candidate === candidate) { this.diagnostic("fallback", { transitionId, reason: "candidate-error" }); this.disposeCandidate(candidate); } },
      onLoadedMetadata: () => { if (this.candidate === candidate) { this.diagnostic("candidate-metadata-ready", { transitionId, candidateDuration: candidate.audio.duration, readyState: candidate.audio.readyState }); this.maybeStartCandidate(generation); } },
    };
    audio.addEventListener("error", candidate.onError); audio.addEventListener("loadedmetadata", candidate.onLoadedMetadata);
    this.candidate = candidate;
    this.maybeStartCandidate(generation);
  }

  private maybeStartCandidate(generation: number) {
    const current = this.audio; const candidate = this.candidate;
    if (!current || !candidate || candidate.started) return;
    const blockedReason = !this.isPlaybackCurrent(current, generation) || candidate.generation !== generation ? "stale-generation"
      : !Number.isFinite(current.duration) ? "current-duration-unavailable"
        : current.duration - current.currentTime > OVERLAP_SECONDS ? "before-overlap-window"
          : candidate.audio.readyState < HTMLMediaElement.HAVE_METADATA ? "candidate-metadata-unavailable"
            : !this.audioContext || this.audioContext.state !== "running" ? "audio-context-not-running"
              : null;
    if (blockedReason) {
      this.diagnosticOnce(`candidate-blocked:${candidate.transitionId}:${blockedReason}`, "candidate-attempt", { transitionId: candidate.transitionId, allowed: false, reason: blockedReason, currentTime: current.currentTime, duration: current.duration, candidateReadyState: candidate.audio.readyState, audioContextState: this.audioContext?.state ?? null });
      return;
    }
    this.diagnostic("candidate-attempt", { transitionId: candidate.transitionId, allowed: true, currentTime: current.currentTime, duration: current.duration, candidateReadyState: candidate.audio.readyState, audioContextState: this.audioContext?.state ?? null });
    candidate.started = true; candidate.startTime = candidate.audio.currentTime;
    candidate.currentTimeAtPlay = current.currentTime;
    this.diagnostic("candidate-play-called", { transitionId: candidate.transitionId, generation, currentTrackId: this.state.activeTrackId, candidateTrackId: candidate.track.id, currentTime: current.currentTime, duration: current.duration, candidateTime: candidate.audio.currentTime, readyState: candidate.audio.readyState });
    void candidate.audio.play().then(() => {
      if (this.candidate !== candidate || !this.isPlaybackCurrent(current, generation)) { this.diagnostic("fallback", { transitionId: candidate.transitionId, reason: "stale-generation" }); return; }
      this.diagnostic("candidate-play-resolved", { transitionId: candidate.transitionId, currentTime: current.currentTime, candidateTime: candidate.audio.currentTime });
      const startedAt = Date.now();
      candidate.progressTimer = setInterval(() => {
        if (this.candidate !== candidate || !this.isPlaybackCurrent(current, generation)) { this.diagnostic("fallback", { transitionId: candidate.transitionId, reason: "stale-generation" }); this.disposeCandidate(candidate); return; }
        this.captureOverlapSample(current, generation);
        if (candidate.audio.currentTime > candidate.startTime + 0.05) {
          candidate.progressed = true;
          this.maybeRecordOverlapProof(current, candidate);
          if (!candidate.realOverlapProven) this.diagnostic("candidate-progression-only", { transitionId: candidate.transitionId, currentTimeAtPlay: candidate.currentTimeAtPlay, currentTime: current.currentTime, candidateStartTime: candidate.startTime, candidateTime: candidate.audio.currentTime, beforeCurrentEnded: !current.ended });
          if (candidate.progressTimer) clearInterval(candidate.progressTimer);
          candidate.progressTimer = null;
          this.startTransitionWatchdog(current, candidate, generation);
        } else if (Date.now() - startedAt >= CANDIDATE_PROGRESS_TIMEOUT_MS) { this.diagnostic("fallback", { transitionId: candidate.transitionId, reason: "no-progression", currentTime: current.currentTime, candidateTime: candidate.audio.currentTime }); this.disposeCandidate(candidate); }
      }, CANDIDATE_PROGRESS_INTERVAL_MS);
    }).catch((error) => { if (this.candidate === candidate) { this.diagnostic("fallback", { transitionId: candidate.transitionId, reason: "play-rejected", errorName: error instanceof Error ? error.name : null, errorMessage: error instanceof Error ? error.message : String(error) }); this.disposeCandidate(candidate); } });
  }

  private startTransitionWatchdog(current: HTMLAudioElement, candidate: CandidateDeck, generation: number) {
    const remainingMs = Math.max(0, current.duration - current.currentTime) * 1_000;
    this.diagnostic("watchdog-start", { transitionId: candidate.transitionId, currentTime: current.currentTime, duration: current.duration, remainingMs, deadlineMs: remainingMs + OVERLAP_END_TOLERANCE_MS });
    candidate.transitionTimer = setTimeout(() => {
      if (this.candidate !== candidate || !this.isPlaybackCurrent(current, generation)) return;
      candidate.transitionTimer = null;
      if (candidate.progressed && !candidate.audio.paused && !candidate.audio.ended && !candidate.audio.error) {
        this.diagnostic("fallback", { transitionId: candidate.transitionId, reason: "watchdog-candidate-wins", realOverlapProven: candidate.realOverlapProven });
        this.promoteCandidate(candidate, generation);
      } else {
        this.diagnostic("fallback", { transitionId: candidate.transitionId, reason: "watchdog-current-wins" });
        this.disposeCandidate(candidate);
      }
    }, remainingMs + OVERLAP_END_TOLERANCE_MS);
  }

  private async handlePlaylistEnded(audio: HTMLAudioElement, generation: number) {
    if (!this.isPlaybackCurrent(audio, generation)) return;
    const candidate = this.candidate;
    this.diagnostic("current-ended", { generation, trackId: this.state.activeTrackId, currentTime: audio.currentTime, duration: audio.duration, candidateTrackId: candidate?.track.id ?? null, candidateProgressed: candidate?.progressed ?? false, realOverlapProven: candidate?.realOverlapProven ?? false });
    if (candidate?.progressed && candidate.generation === generation) { this.diagnostic("transition", { transitionId: candidate.transitionId, reason: "normal-overlap-promotion", realOverlapProven: candidate.realOverlapProven }); this.promoteCandidate(candidate, generation); return; }
    if (candidate) this.disposeCandidate(candidate);
    this.diagnostic("fallback", { reason: "sequential-fallback", generation, trackId: this.state.activeTrackId });
    const nextIndex = (this.activeTrackIndex + 1) % this.playlist.length;
    this.cleanupCurrentPlayback();
    if (this.isGenerationCurrent(generation)) await this.startPlaylistTrack(nextIndex, generation);
  }

  private promoteCandidate(candidate: CandidateDeck, generation: number) {
    if (this.candidate !== candidate || !this.isGenerationCurrent(generation)) return;
    this.cleanupCurrentPlayback(); this.candidate = null;
    if (candidate.progressTimer) clearInterval(candidate.progressTimer);
    if (candidate.transitionTimer) clearTimeout(candidate.transitionTimer);
    candidate.transitionTimer = null;
    candidate.audio.removeEventListener("error", candidate.onError); candidate.audio.removeEventListener("loadedmetadata", candidate.onLoadedMetadata);
    this.audio = candidate.audio; this.mediaSourceNode = candidate.sourceNode; this.activeTrackIndex = candidate.index;
    this.diagnostic("candidate-promoted", { transitionId: candidate.transitionId, generation, trackId: candidate.track.id, candidateTime: candidate.audio.currentTime, realOverlapProven: candidate.realOverlapProven });
    this.candidateAttemptedForCurrent = false;
    this.installPlaylistListeners(candidate.audio, generation);
    this.update({ status: "playing", activeTrackId: candidate.track.id, sourceKind: "blob", currentTime: candidate.audio.currentTime, error: null });
    this.prepareNextTrack(generation);
  }

  private disposeCandidate(candidate = this.candidate) {
    if (!candidate) return;
    if (this.candidate === candidate) this.candidate = null;
    if (candidate.progressTimer) clearInterval(candidate.progressTimer);
    if (candidate.transitionTimer) clearTimeout(candidate.transitionTimer);
    candidate.transitionTimer = null;
    candidate.audio.removeEventListener("error", candidate.onError); candidate.audio.removeEventListener("loadedmetadata", candidate.onLoadedMetadata);
    candidate.audio.pause(); candidate.sourceNode?.disconnect(); candidate.audio.removeAttribute("src"); candidate.audio.load();
  }

  private evictLeastRecentlyUsed() {
    while (this.cache.size > MAX_CACHED_AMBIENT) {
      let candidate: [string, CachedAmbient] | null = null;
      for (const entry of this.cache) {
        if (this.isCacheProtected(entry[0])) continue;
        if (!candidate || entry[1].lastUsed < candidate[1].lastUsed) candidate = entry;
      }
      if (!candidate) return;
      this.cache.delete(candidate[0]); URL.revokeObjectURL(candidate[1].objectUrl);
    }
  }

  private isCacheProtected(trackId: string) { return trackId === this.state.activeTrackId || trackId === this.candidate?.track.id; }
  private cancelPendingFetchesExcept(trackIds: Set<string>) { this.pendingFetches.forEach(({ controller }, id) => { if (!trackIds.has(id)) controller.abort(); }); }
  private isGenerationCurrent(generation: number) { return !this.disposed && this.generation === generation; }
  private isPlaybackCurrent(audio: HTMLAudioElement, generation: number) { return this.isGenerationCurrent(generation) && this.audio === audio; }

  private async handleNetworkEnded(track: AmbientTrack, audio: HTMLAudioElement, generation: number) {
    const cached = this.cache.get(track.id);
    if (!cached) {
      audio.currentTime = 0;
      try { await audio.play(); if (this.isPlaybackCurrent(audio, generation)) this.update({ status: "playing", currentTime: audio.currentTime }); }
      catch (error) { if (this.isPlaybackCurrent(audio, generation)) this.handleError(error); }
      return;
    }
    cached.lastUsed = ++this.usageSequence;
    this.cleanupCurrentPlayback();
    if (!this.isGenerationCurrent(generation) || this.state.activeTrackId !== track.id) return;
    const blobAudio = new Audio(cached.objectUrl);
    blobAudio.preload = "auto"; blobAudio.loop = true; blobAudio.volume = this.state.volume;
    this.mediaSourceNode = this.attachToAudioGraph(blobAudio); this.resumeAudioContext();
    const onError = () => {
      if (this.isPlaybackCurrent(blobAudio, generation)) this.handleError(new Error("The browser could not play this ambient track."));
    };
    blobAudio.addEventListener("error", onError);
    this.audio = blobAudio; this.audioErrorListener = onError; this.audioEndedListener = null;
    this.update({ status: "loading", sourceKind: "blob", currentTime: 0, error: null });
    try { await blobAudio.play(); if (this.isPlaybackCurrent(blobAudio, generation)) this.update({ status: "playing", currentTime: blobAudio.currentTime }); }
    catch (error) { if (this.isPlaybackCurrent(blobAudio, generation)) this.handleError(error); }
  }

  private handleError(error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load or play this ambient track.";
    console.error("[AmbientEngine]", message); this.generation += 1; this.cleanupPlayback(); this.playlist = []; this.activeSelectionId = null;
    this.update({ status: "error", sourceKind: null, currentTime: 0, error: message });
  }

  private cleanupPlayback() { this.persistentDecks?.dispose(); this.persistentDecks = null; this.disposeCandidate(); this.cleanupCurrentPlayback(); }

  private startPersistentOneTrack(selectionId: string, track: AmbientTrack) {
    // Called directly by the card click. The two deck play() calls happen synchronously in the constructor.
    this.requestPlaybackAudioSession();
    const generation = ++this.generation;
    this.cancelPendingFetchesExcept(new Set([track.id]));
    this.cleanupPlayback();
    this.playlist = [track]; this.activeTrackIndex = 0; this.activeSelectionId = selectionId;
    const cached = this.cache.get(track.id);
    if (cached) cached.lastUsed = ++this.usageSequence;
    this.update({ status: "loading", activeTrackId: track.id, sourceKind: cached ? "blob" : "network", currentTime: 0, error: null });
    try {
      this.persistentDecks = new PersistentAmbientDecks(track, cached?.objectUrl ?? track.url, cached?.objectUrl ?? null, this.state.volume,
        (event, details) => this.diagnostic(event, details),
        (status, sourceKind, currentTime, error) => {
          if (!this.isGenerationCurrent(generation)) return;
          this.update({ status, sourceKind, currentTime, error: error ?? null });
        });
    } catch (error) {
      this.diagnostic("persistent-construction-failed", { error: error instanceof Error ? error.message : String(error) });
      if (this.isGenerationCurrent(generation)) this.update({ status: "error", error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!cached) void this.ensureCached(track);
  }
  private cleanupCurrentPlayback() {
    if (!this.audio) return;
    this.audio.pause(); this.mediaSourceNode?.disconnect(); this.mediaSourceNode = null;
    if (this.audioErrorListener) this.audio.removeEventListener("error", this.audioErrorListener);
    if (this.audioEndedListener) this.audio.removeEventListener("ended", this.audioEndedListener);
    if (this.audioTimeUpdateListener) this.audio.removeEventListener("timeupdate", this.audioTimeUpdateListener);
    this.audio.removeAttribute("src"); this.audio.load(); this.audio = null;
    this.audioErrorListener = null; this.audioEndedListener = null; this.audioTimeUpdateListener = null;
  }

  private attachToAudioGraph(audio: HTMLAudioElement) {
    if (!this.audioContext) {
      const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return null;
      this.audioContext = new AudioContextConstructor(); this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.state.volume; this.gainNode.connect(this.audioContext.destination);
    }
    if (!this.gainNode) return null;
    const sourceNode = this.audioContext.createMediaElementSource(audio);
    try {
      sourceNode.connect(this.gainNode);
      return sourceNode;
    } catch (error) {
      sourceNode.disconnect();
      throw error;
    }
  }

  private resumeAudioContext() {
    if (this.audioContext && this.audioContext.state !== "running" && this.audioContext.state !== "closed") void this.audioContext.resume().catch(() => undefined);
  }

  private requestPlaybackAudioSession() {
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (audioSession) {
      try { audioSession.type = "playback"; console.info("[AmbientEngine] Audio Session", { supported: true, playbackSet: audioSession.type === "playback" }); }
      catch (error) { console.warn("[AmbientEngine] Audio Session playback could not be set", error); }
    } else console.info("[AmbientEngine] Audio Session", { supported: false });
  }

  private diagnostic(event: string, details: Record<string, unknown>) {
    recordAmbientOverlapDiagnostic(event, { selectionId: this.activeSelectionId, generation: this.generation, activeTrackId: this.state.activeTrackId, ...details });
  }

  private diagnosticOnce(key: string, event: string, details: Record<string, unknown>) {
    if (!ambientOverlapDiagnosticsEnabled() || this.diagnosticOnceKeys.has(key)) return;
    this.diagnosticOnceKeys.add(key);
    this.diagnostic(event, details);
  }

  private captureOverlapSample(current: HTMLAudioElement, generation: number) {
    const candidate = this.candidate;
    if (!candidate || !ambientOverlapDiagnosticsEnabled() || !this.isPlaybackCurrent(current, generation) || candidate.generation !== generation || !candidate.started || Date.now() - candidate.lastSampleAt < 250) return;
    candidate.lastSampleAt = Date.now();
    this.diagnostic("overlap-sample", { transitionId: candidate.transitionId, currentTime: current.currentTime, currentDuration: current.duration, currentPaused: current.paused, currentEnded: current.ended, currentReadyState: current.readyState, candidateTime: candidate.audio.currentTime, candidatePaused: candidate.audio.paused, candidateEnded: candidate.audio.ended, candidateReadyState: candidate.audio.readyState });
    this.maybeRecordOverlapProof(current, candidate);
  }

  private maybeRecordOverlapProof(current: HTMLAudioElement, candidate: CandidateDeck) {
    if (candidate.realOverlapProven || !candidate.progressed || current.ended || current.currentTime <= candidate.currentTimeAtPlay + 0.05 || candidate.audio.currentTime <= candidate.startTime + 0.05) return;
    candidate.realOverlapProven = true;
    this.diagnostic("overlap-proven", { transitionId: candidate.transitionId, currentTimeAtPlay: candidate.currentTimeAtPlay, currentTime: current.currentTime, candidateStartTime: candidate.startTime, candidateTime: candidate.audio.currentTime, beforeCurrentEnded: true });
  }

  private update(patch: Partial<AmbientEngineState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
}

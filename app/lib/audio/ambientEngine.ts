export interface AmbientTrack { id: string; url: string; }
export type AmbientPlaybackStatus = "idle" | "loading" | "playing" | "error";
export interface AmbientEngineState { status: AmbientPlaybackStatus; activeTrackId: string | null; sourceKind: "network" | "blob" | null; volume: number; currentTime: number; error: string | null; }

type Listener = () => void;
type CachedAmbient = { objectUrl: string; lastUsed: number };
type PendingFetch = { controller: AbortController; promise: Promise<void> };
type CandidateDeck = {
  audio: HTMLAudioElement; sourceNode: MediaElementAudioSourceNode | null; track: AmbientTrack;
  index: number; generation: number; started: boolean; progressed: boolean; startTime: number;
  progressTimer: ReturnType<typeof setInterval> | null; onError: () => void; onLoadedMetadata: () => void;
};

const MAX_CACHED_AMBIENT = 3;
const OVERLAP_SECONDS = 3;
const CANDIDATE_PROGRESS_TIMEOUT_MS = 2_000;
const CANDIDATE_PROGRESS_INTERVAL_MS = 100;
const INITIAL_STATE: AmbientEngineState = { status: "idle", activeTrackId: null, sourceKind: null, volume: 0.4, currentTime: 0, error: null };

export function ambientOverlapEnabled() { return process.env.NEXT_PUBLIC_V2_AMBIENT_OVERLAP === "1"; }

export class AmbientEngine {
  private audio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private mediaSourceNode: MediaElementAudioSourceNode | null = null;
  private audioErrorListener: (() => void) | null = null;
  private audioEndedListener: (() => void) | null = null;
  private audioTimeUpdateListener: (() => void) | null = null;
  private candidate: CandidateDeck | null = null;
  private playlist: readonly AmbientTrack[] = [];
  private activeTrackIndex = 0;
  private activeSelectionId: string | null = null;
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
  toggle = async (track: AmbientTrack) => { await this.togglePlaylist(track.id, [track]); };

  togglePlaylist = async (selectionId: string, tracks: readonly AmbientTrack[]) => {
    if (this.disposed || typeof window === "undefined" || tracks.length === 0) return;
    const playlist = this.overlapEnabled ? tracks : [tracks[0]];
    const effectiveSelectionId = this.overlapEnabled ? selectionId : playlist[0].id;
    if (this.activeSelectionId === effectiveSelectionId) { this.stop(); return; }
    this.requestPlaybackAudioSession();
    const generation = ++this.generation;
    this.cancelPendingFetchesExcept(new Set(playlist.map((track) => track.id)));
    this.cleanupPlayback();
    this.playlist = playlist;
    this.activeTrackIndex = 0;
    this.activeSelectionId = effectiveSelectionId;
    await this.startTrack(0, generation);
  };

  setVolume = (volume: number) => {
    const nextVolume = Math.min(1, Math.max(0, volume));
    if (this.audio) this.audio.volume = nextVolume;
    if (this.candidate) this.candidate.audio.volume = nextVolume;
    if (this.gainNode) this.gainNode.gain.value = nextVolume;
    this.update({ volume: nextVolume, currentTime: this.audio?.currentTime ?? this.state.currentTime });
  };

  stop = () => {
    if (this.disposed) return;
    this.generation += 1;
    this.cleanupPlayback();
    this.playlist = [];
    this.activeTrackIndex = 0;
    this.activeSelectionId = null;
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
    const audioContext = this.audioContext;
    this.audioContext = null;
    this.gainNode = null;
    if (audioContext) void audioContext.close().catch(() => undefined);
    this.listeners.clear();
  };

  private async startTrack(index: number, generation: number) {
    const track = this.playlist[index];
    if (!track || !this.isGenerationCurrent(generation)) return;
    this.activeTrackIndex = index;
    const cached = this.cache.get(track.id);
    if (cached) cached.lastUsed = ++this.usageSequence;
    const sourceKind = cached ? "blob" : "network";
    const audio = new Audio(cached?.objectUrl ?? track.url);
    audio.preload = "auto";
    audio.loop = !this.overlapEnabled && sourceKind === "blob";
    audio.volume = this.state.volume;
    this.mediaSourceNode = this.attachToAudioGraph(audio);
    this.resumeAudioContext();
    this.installCurrentListeners(audio, track, generation);
    this.audio = audio;
    this.update({ status: "loading", activeTrackId: track.id, sourceKind, currentTime: 0, error: null });
    if (!cached) void this.ensureCached(track).then(() => { if (this.isPlaybackCurrent(audio, generation)) this.prepareNextTrack(generation); });
    else if (this.overlapEnabled) this.prepareNextTrack(generation);
    try {
      await audio.play();
      if (this.isPlaybackCurrent(audio, generation)) this.update({ status: "playing", currentTime: audio.currentTime });
    } catch (error) { if (this.isPlaybackCurrent(audio, generation)) this.handleError(error); }
  }

  private installCurrentListeners(audio: HTMLAudioElement, track: AmbientTrack, generation: number) {
    const onError = () => { if (this.isPlaybackCurrent(audio, generation)) this.handleError(new Error("The browser could not play this ambient track.")); };
    const onEnded = () => {
      if (!this.isPlaybackCurrent(audio, generation)) return;
      if (this.overlapEnabled) void this.handlePlaylistEnded(audio, generation);
      else void this.handleNetworkEnded(track, audio, generation);
    };
    const onTimeUpdate = () => {
      if (!this.isPlaybackCurrent(audio, generation)) return;
      this.update({ currentTime: audio.currentTime });
      if (this.overlapEnabled) this.maybeStartCandidate(generation);
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
    if (!cached) { void this.ensureCached(nextTrack).then(() => { if (this.isGenerationCurrent(generation)) this.prepareNextTrack(generation); }); return; }
    cached.lastUsed = ++this.usageSequence;
    const audio = new Audio(cached.objectUrl);
    audio.preload = "auto"; audio.loop = false; audio.volume = this.state.volume;
    const sourceNode = this.attachToAudioGraph(audio);
    const candidate: CandidateDeck = {
      audio, sourceNode, track: nextTrack, index: nextIndex, generation, started: false, progressed: false, startTime: 0, progressTimer: null,
      onError: () => { if (this.candidate === candidate) this.disposeCandidate(candidate); },
      onLoadedMetadata: () => { if (this.candidate === candidate) this.maybeStartCandidate(generation); },
    };
    audio.addEventListener("error", candidate.onError); audio.addEventListener("loadedmetadata", candidate.onLoadedMetadata);
    this.candidate = candidate;
  }

  private maybeStartCandidate(generation: number) {
    const current = this.audio; const candidate = this.candidate;
    if (!current || !candidate || candidate.started || !this.isPlaybackCurrent(current, generation) || candidate.generation !== generation ||
      !Number.isFinite(current.duration) || current.duration - current.currentTime > OVERLAP_SECONDS ||
      candidate.audio.readyState < HTMLMediaElement.HAVE_METADATA || !this.audioContext || this.audioContext.state !== "running") return;
    candidate.started = true; candidate.startTime = candidate.audio.currentTime;
    void candidate.audio.play().then(() => {
      if (this.candidate !== candidate || !this.isPlaybackCurrent(current, generation)) return;
      const startedAt = Date.now();
      candidate.progressTimer = setInterval(() => {
        if (this.candidate !== candidate || !this.isPlaybackCurrent(current, generation)) { this.disposeCandidate(candidate); return; }
        if (candidate.audio.currentTime > candidate.startTime + 0.05) {
          candidate.progressed = true;
          if (candidate.progressTimer) clearInterval(candidate.progressTimer);
          candidate.progressTimer = null;
        } else if (Date.now() - startedAt >= CANDIDATE_PROGRESS_TIMEOUT_MS) this.disposeCandidate(candidate);
      }, CANDIDATE_PROGRESS_INTERVAL_MS);
    }).catch(() => { if (this.candidate === candidate) this.disposeCandidate(candidate); });
  }

  private async handlePlaylistEnded(audio: HTMLAudioElement, generation: number) {
    if (!this.isPlaybackCurrent(audio, generation)) return;
    const candidate = this.candidate;
    if (candidate?.progressed && candidate.generation === generation) { this.promoteCandidate(candidate, generation); return; }
    if (candidate) this.disposeCandidate(candidate);
    const nextIndex = (this.activeTrackIndex + 1) % this.playlist.length;
    this.cleanupCurrentPlayback();
    if (this.isGenerationCurrent(generation)) await this.startTrack(nextIndex, generation);
  }

  private promoteCandidate(candidate: CandidateDeck, generation: number) {
    if (this.candidate !== candidate || !this.isGenerationCurrent(generation)) return;
    this.cleanupCurrentPlayback(); this.candidate = null;
    if (candidate.progressTimer) clearInterval(candidate.progressTimer);
    candidate.audio.removeEventListener("error", candidate.onError); candidate.audio.removeEventListener("loadedmetadata", candidate.onLoadedMetadata);
    this.audio = candidate.audio; this.mediaSourceNode = candidate.sourceNode; this.activeTrackIndex = candidate.index;
    this.installCurrentListeners(candidate.audio, candidate.track, generation);
    this.update({ status: "playing", activeTrackId: candidate.track.id, sourceKind: "blob", currentTime: candidate.audio.currentTime, error: null });
    this.prepareNextTrack(generation);
  }

  private disposeCandidate(candidate = this.candidate) {
    if (!candidate) return;
    if (this.candidate === candidate) this.candidate = null;
    if (candidate.progressTimer) clearInterval(candidate.progressTimer);
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
    this.installCurrentListeners(blobAudio, track, generation); this.audio = blobAudio;
    this.update({ status: "loading", sourceKind: "blob", currentTime: 0, error: null });
    try { await blobAudio.play(); if (this.isPlaybackCurrent(blobAudio, generation)) this.update({ status: "playing", currentTime: blobAudio.currentTime }); }
    catch (error) { if (this.isPlaybackCurrent(blobAudio, generation)) this.handleError(error); }
  }

  private handleError(error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load or play this ambient track.";
    console.error("[AmbientEngine]", message); this.generation += 1; this.cleanupPlayback(); this.playlist = []; this.activeSelectionId = null;
    this.update({ status: "error", sourceKind: null, currentTime: 0, error: message });
  }

  private cleanupPlayback() { this.disposeCandidate(); this.cleanupCurrentPlayback(); }
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
    const sourceNode = this.audioContext.createMediaElementSource(audio); sourceNode.connect(this.gainNode); return sourceNode;
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

  private update(patch: Partial<AmbientEngineState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
}

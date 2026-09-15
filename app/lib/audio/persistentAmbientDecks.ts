import type { AmbientTrack } from "./ambientEngine";

type Deck = { id: "A" | "B"; audio: HTMLAudioElement; source: MediaElementAudioSourceNode; gate: GainNode; primed: boolean; primeProgressed: boolean; primeStart: number; primeTimer: ReturnType<typeof setInterval> | null };
type Diagnostic = (event: string, details: Record<string, unknown>) => void;
type Status = (status: "loading" | "playing" | "error", sourceKind: "network" | "blob", currentTime: number, error?: string) => void;

const OVERLAP_SECONDS = 3;
const PREPARE_SECONDS = 6;
const PROGRESSION_TIMEOUT_MS = 2_000;
const END_TOLERANCE_MS = 1_500;

// One-track, staging-only proof: both media elements receive play() directly inside the original tap.
export class PersistentAmbientDecks {
  private readonly context: AudioContext;
  private readonly volumeGain: GainNode;
  private readonly decks: [Deck, Deck];
  private current: Deck;
  private standby: Deck;
  private blobUrl: string | null;
  private candidateStarted = false;
  private candidateProgressed = false;
  private candidateStart = 0;
  private currentAtCandidateStart = 0;
  private overlapProven = false;
  private transitionId = 0;
  private candidateTimer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastSampleAt = 0;

  constructor(private readonly track: AmbientTrack, sourceUrl: string, blobUrl: string | null, volume: number, private readonly diagnostic: Diagnostic, private readonly status: Status) {
    const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) throw new Error("Web Audio is required for silent standby priming.");
    this.context = new Context();
    this.volumeGain = this.context.createGain();
    this.volumeGain.gain.value = volume;
    this.volumeGain.connect(this.context.destination);
    const makeDeck = (id: "A" | "B"): Deck => {
      const audio = new Audio(sourceUrl);
      audio.preload = "auto"; audio.loop = false; audio.volume = 1;
      const gate = this.context.createGain();
      gate.gain.value = id === "A" ? 1 : 0;
      gate.connect(this.volumeGain);
      try {
        const source = this.context.createMediaElementSource(audio);
        source.connect(gate);
        this.diagnostic("persistent-deck-created", { deck: id, trackId: track.id, createdDuringUserGesture: true, source: blobUrl ? "blob" : "network", sourceIdentity: sourceUrl });
        return { id, audio, source, gate, primed: false, primeProgressed: false, primeStart: 0, primeTimer: null };
      } catch (error) { audio.pause(); audio.removeAttribute("src"); audio.load(); gate.disconnect(); throw error; }
    };
    let first: Deck | null = null;
    try {
      first = makeDeck("A");
      this.decks = [first, makeDeck("B")];
    } catch (error) {
      if (first) { first.audio.pause(); first.source.disconnect(); first.gate.disconnect(); first.audio.removeAttribute("src"); first.audio.load(); }
      this.volumeGain.disconnect(); void this.context.close().catch(() => undefined); throw error;
    }
    this.current = this.decks[0]; this.standby = this.decks[1]; this.blobUrl = blobUrl;
    this.current.audio.addEventListener("timeupdate", this.onCurrentTimeUpdate);
    this.current.audio.addEventListener("ended", this.onCurrentEnded);
    this.decks.forEach(deck => deck.audio.addEventListener("error", this.onMediaError));
    void this.context.resume().catch(error => this.diagnostic("persistent-context-resume-rejected", { error: String(error) }));
    // These two calls are deliberately adjacent and synchronous: no await, metadata callback, or timer before B.play().
    this.diagnostic("persistent-prime-play-called", { deck: "B", sourceIdentity: this.standby.audio.src });
    const standbyPlay = this.standby.audio.play();
    this.diagnostic("persistent-current-play-called", { deck: "A", sourceIdentity: this.current.audio.src });
    const currentPlay = this.current.audio.play();
    void standbyPlay.then(() => {
      if (this.disposed) return;
      this.standby.primed = true; this.standby.primeStart = this.standby.audio.currentTime;
      this.diagnostic("persistent-prime-play-resolved", { deck: "B", currentTime: this.standby.audio.currentTime });
      const startedAt = Date.now();
      this.standby.primeTimer = setInterval(() => {
        if (this.disposed) return;
        if (this.standby.audio.currentTime > this.standby.primeStart + 0.05) {
          this.standby.primeProgressed = true;
          this.diagnostic("persistent-prime-progressed", { deck: "B", currentTime: this.standby.audio.currentTime });
          this.finishPriming();
        } else if (Date.now() - startedAt >= PROGRESSION_TIMEOUT_MS) { this.diagnostic("persistent-prime-no-progression", { deck: "B" }); this.finishPriming(); }
      }, 100);
    }).catch(error => { if (!this.disposed) { this.diagnostic("persistent-prime-play-rejected", { deck: "B", name: error instanceof Error ? error.name : null, message: String(error) }); this.finishPriming(); } });
    void currentPlay.then(() => { if (!this.disposed) this.status("playing", this.blobUrl ? "blob" : "network", this.current.audio.currentTime); })
      .catch(error => { if (!this.disposed) { this.diagnostic("persistent-current-play-rejected", { name: error instanceof Error ? error.name : null, message: String(error) }); this.status("error", this.blobUrl ? "blob" : "network", 0, String(error)); this.dispose(); } });
  }

  setVolume(volume: number) { if (!this.disposed) this.volumeGain.gain.value = volume; }

  setBlobUrl(url: string) {
    if (this.disposed || this.blobUrl === url) return;
    this.blobUrl = url;
    this.diagnostic("persistent-blob-ready", { trackId: this.track.id });
    if (this.standby.audio.paused && !this.candidateStarted && !this.standby.primeTimer) this.replaceStandbySource(url);
  }

  private replaceStandbySource(url: string) {
    if (this.disposed || this.standby.audio.src === url) return;
    const prior = this.standby.audio.src;
    this.standby.audio.src = url; this.standby.audio.load();
    this.diagnostic("persistent-standby-source-replaced", { deck: this.standby.id, from: prior, to: url, primeProgressed: this.standby.primeProgressed });
  }

  private finishPriming() {
    if (this.standby.primeTimer) clearInterval(this.standby.primeTimer);
    this.standby.primeTimer = null;
    this.standby.audio.pause();
    this.standby.audio.currentTime = 0;
    this.diagnostic("persistent-prime-paused", { deck: this.standby.id, primed: this.standby.primed, realProgression: this.standby.primeProgressed, currentTime: this.standby.audio.currentTime });
    if (this.blobUrl) this.replaceStandbySource(this.blobUrl);
  }

  private readonly onCurrentTimeUpdate = () => {
    if (this.disposed) return;
    const audio = this.current.audio;
    this.status("playing", audio.src.startsWith("blob:") ? "blob" : "network", audio.currentTime);
    if (this.candidateStarted) { this.sample(); return; }
    if (!this.standby.primed || !this.standby.primeProgressed || !this.standby.audio.paused || !Number.isFinite(audio.duration) || audio.duration - audio.currentTime > PREPARE_SECONDS) return;
    if (this.blobUrl && this.standby.audio.src !== this.blobUrl) this.replaceStandbySource(this.blobUrl);
    if (audio.duration - audio.currentTime <= OVERLAP_SECONDS && this.standby.audio.readyState >= HTMLMediaElement.HAVE_METADATA) this.startCandidate();
  };

  private startCandidate() {
    if (this.disposed || this.candidateStarted) return;
    this.candidateStarted = true; this.candidateProgressed = false; this.overlapProven = false;
    this.transitionId++; this.candidateStart = this.standby.audio.currentTime; this.currentAtCandidateStart = this.current.audio.currentTime;
    this.standby.gate.gain.value = 1;
    this.diagnostic("persistent-auto-play-called", { transitionId: this.transitionId, currentDeck: this.current.id, standbyDeck: this.standby.id, currentTime: this.current.audio.currentTime, candidateTime: this.candidateStart, sourceIdentity: this.standby.audio.src, sourceReplacedSincePrime: this.standby.audio.src !== this.current.audio.src });
    void this.standby.audio.play().then(() => {
      if (this.disposed || !this.candidateStarted) return;
      this.diagnostic("persistent-auto-play-resolved", { transitionId: this.transitionId, standbyDeck: this.standby.id });
      const startedAt = Date.now();
      this.candidateTimer = setInterval(() => {
        if (this.disposed || !this.candidateStarted) return;
        this.sample();
        if (this.standby.audio.currentTime > this.candidateStart + 0.05) {
          this.candidateProgressed = true;
          this.maybeRecordOverlapProof();
          this.diagnostic("persistent-candidate-progressed", { transitionId: this.transitionId, currentTime: this.current.audio.currentTime, candidateTime: this.standby.audio.currentTime });
          if (this.candidateTimer) clearInterval(this.candidateTimer);
          this.candidateTimer = null;
          const remainingMs = Math.max(0, this.current.audio.duration - this.current.audio.currentTime) * 1000;
          this.watchdog = setTimeout(() => this.resolveWatchdog(), remainingMs + END_TOLERANCE_MS);
          this.diagnostic("persistent-watchdog-start", { transitionId: this.transitionId, remainingMs, deadlineMs: remainingMs + END_TOLERANCE_MS });
        } else if (Date.now() - startedAt >= PROGRESSION_TIMEOUT_MS) this.rejectCandidate("no-progression");
      }, 100);
    }).catch(error => { if (!this.disposed && this.candidateStarted) this.rejectCandidate("play-rejected", error); });
  }

  private sample() {
    if (!this.candidateStarted || this.disposed || Date.now() - this.lastSampleAt < 250) return;
    this.lastSampleAt = Date.now();
    const a = this.current.audio, b = this.standby.audio;
    this.diagnostic("persistent-overlap-sample", { transitionId: this.transitionId, currentDeck: this.current.id, standbyDeck: this.standby.id, currentTime: a.currentTime, currentDuration: a.duration, currentPaused: a.paused, currentEnded: a.ended, currentReadyState: a.readyState, candidateTime: b.currentTime, candidatePaused: b.paused, candidateReadyState: b.readyState });
    this.maybeRecordOverlapProof();
  }

  private maybeRecordOverlapProof() {
    const a = this.current.audio, b = this.standby.audio;
    if (!this.overlapProven && this.candidateProgressed && !a.ended && a.currentTime > this.currentAtCandidateStart + 0.05 && b.currentTime > this.candidateStart + 0.05) {
      this.overlapProven = true;
      this.diagnostic("overlap-proven", { transitionId: this.transitionId, currentDeck: this.current.id, standbyDeck: this.standby.id, currentTime: a.currentTime, candidateTime: b.currentTime });
    }
  }

  private rejectCandidate(reason: string, error?: unknown) {
    this.diagnostic("persistent-fallback", { transitionId: this.transitionId, reason, errorName: error instanceof Error ? error.name : null, currentDeck: this.current.id, standbyDeck: this.standby.id });
    this.clearTimers(); this.standby.audio.pause(); this.standby.audio.currentTime = 0; this.standby.gate.gain.value = 0;
    this.candidateStarted = false; this.candidateProgressed = false;
    // A failed automatic B start must not be retried on every timeupdate of this pass.
    this.standby.primed = false;
  }

  private readonly onCurrentEnded = () => {
    if (this.disposed) return;
    this.diagnostic("persistent-current-ended", { transitionId: this.transitionId, currentDeck: this.current.id, candidateProgressed: this.candidateProgressed, overlapProven: this.overlapProven });
    if (this.candidateStarted && this.candidateProgressed && !this.standby.audio.paused) this.promote("normal-overlap-promotion");
    else this.repeatCurrent();
  };

  private repeatCurrent() {
    this.clearTimers(); this.candidateStarted = false; this.candidateProgressed = false;
    this.current.audio.currentTime = 0;
    this.diagnostic("persistent-fallback", { reason: "sequential-fallback", currentDeck: this.current.id });
    void this.current.audio.play().catch(error => { if (!this.disposed) this.diagnostic("persistent-repeat-rejected", { errorName: error instanceof Error ? error.name : null }); });
  }

  private resolveWatchdog() {
    if (this.disposed || !this.candidateStarted) return;
    if (this.candidateProgressed && !this.standby.audio.paused && !this.standby.audio.ended && !this.standby.audio.error) this.promote("watchdog-candidate-wins");
    else this.rejectCandidate("watchdog-current-wins");
  }

  private promote(reason: string) {
    if (this.disposed) return;
    const old = this.current;
    old.audio.removeEventListener("timeupdate", this.onCurrentTimeUpdate);
    old.audio.removeEventListener("ended", this.onCurrentEnded);
    old.audio.pause(); old.gate.gain.value = 0;
    if (old.audio.currentTime > 0.05) { old.primed = true; old.primeProgressed = true; }
    old.audio.currentTime = 0;
    this.clearTimers();
    this.current = this.standby; this.standby = old;
    this.candidateStarted = false; this.candidateProgressed = false;
    this.current.gate.gain.value = 1;
    this.current.audio.addEventListener("timeupdate", this.onCurrentTimeUpdate);
    this.current.audio.addEventListener("ended", this.onCurrentEnded);
    this.diagnostic("persistent-promoted", { transitionId: this.transitionId, reason, currentDeck: this.current.id, standbyDeck: this.standby.id, overlapProven: this.overlapProven });
    this.status("playing", this.current.audio.src.startsWith("blob:") ? "blob" : "network", this.current.audio.currentTime);
    if (this.blobUrl) this.replaceStandbySource(this.blobUrl);
    else this.standby.audio.currentTime = 0;
  }

  private readonly onMediaError = () => { if (!this.disposed) this.diagnostic("persistent-media-error", { currentDeck: this.current.id, standbyDeck: this.standby.id }); };
  private clearTimers() { if (this.candidateTimer) clearInterval(this.candidateTimer); if (this.watchdog) clearTimeout(this.watchdog); this.candidateTimer = null; this.watchdog = null; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clearTimers();
    this.decks.forEach(deck => {
      if (deck.primeTimer) clearInterval(deck.primeTimer);
      deck.audio.removeEventListener("timeupdate", this.onCurrentTimeUpdate);
      deck.audio.removeEventListener("ended", this.onCurrentEnded);
      deck.audio.removeEventListener("error", this.onMediaError);
      deck.audio.pause(); deck.source.disconnect(); deck.gate.disconnect(); deck.audio.removeAttribute("src"); deck.audio.load();
    });
    this.volumeGain.disconnect(); void this.context.close().catch(() => undefined);
    this.diagnostic("persistent-decks-disposed", { deckCount: 2 });
  }
}

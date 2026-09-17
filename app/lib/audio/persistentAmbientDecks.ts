type Deck = { id: "A" | "B"; audio: HTMLAudioElement; source: MediaElementAudioSourceNode; gate: GainNode; primed: boolean; primeProgressed: boolean; primeStart: number; primeTimer: ReturnType<typeof setInterval> | null };
type Status = (status: "loading" | "playing" | "error", sourceKind: "network" | "blob", currentTime: number, error?: string) => void;
function createAmbientAudio(url: string): HTMLAudioElement { const audio = new Audio(); audio.crossOrigin = "anonymous"; audio.src = url; return audio; }

const OVERLAP_SECONDS = 5;
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
  private candidateTimer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(sourceUrl: string, blobUrl: string | null, volume: number, private readonly status: Status) {
    const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) throw new Error("Web Audio is required for silent standby priming.");
    this.context = new Context();
    this.volumeGain = this.context.createGain();
    this.volumeGain.gain.value = volume;
    this.volumeGain.connect(this.context.destination);
    const makeDeck = (id: "A" | "B"): Deck => {
      const audio = createAmbientAudio(sourceUrl);
      audio.preload = "auto"; audio.loop = false; audio.volume = 1;
      const gate = this.context.createGain();
      gate.gain.value = id === "A" ? 1 : 0;
      gate.connect(this.volumeGain);
      try {
        const source = this.context.createMediaElementSource(audio);
        source.connect(gate);
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
    void this.context.resume().catch(() => undefined);
    // These two calls are deliberately adjacent and synchronous: no await, metadata callback, or timer before B.play().
    const standbyPlay = this.standby.audio.play();
    const currentPlay = this.current.audio.play();
    void standbyPlay.then(() => {
      if (this.disposed) return;
      this.standby.primed = true; this.standby.primeStart = this.standby.audio.currentTime;
      const startedAt = Date.now();
      this.standby.primeTimer = setInterval(() => {
        if (this.disposed) return;
        if (this.standby.audio.currentTime > this.standby.primeStart + 0.05) {
          this.standby.primeProgressed = true;
          this.finishPriming();
        } else if (Date.now() - startedAt >= PROGRESSION_TIMEOUT_MS) this.finishPriming();
      }, 100);
    }).catch(() => { if (!this.disposed) this.finishPriming(); });
    void currentPlay.then(() => { if (!this.disposed) this.status("playing", this.blobUrl ? "blob" : "network", this.current.audio.currentTime); })
      .catch(error => { if (!this.disposed) { this.status("error", this.blobUrl ? "blob" : "network", 0, String(error)); this.dispose(); } });
  }

  setVolume(volume: number) { if (!this.disposed) this.volumeGain.gain.value = volume; }

  setBlobUrl(url: string) {
    if (this.disposed || this.blobUrl === url) return;
    this.blobUrl = url;
    if (this.standby.audio.paused && !this.candidateStarted && !this.standby.primeTimer) this.replaceStandbySource(url);
  }

  private replaceStandbySource(url: string) {
    if (this.disposed || this.standby.audio.src === url) return;
    this.standby.audio.src = url; this.standby.audio.load();
  }

  private finishPriming() {
    if (this.standby.primeTimer) clearInterval(this.standby.primeTimer);
    this.standby.primeTimer = null;
    this.standby.audio.pause();
    this.standby.audio.currentTime = 0;
    if (this.blobUrl) this.replaceStandbySource(this.blobUrl);
  }

  private readonly onCurrentTimeUpdate = () => {
    if (this.disposed) return;
    const audio = this.current.audio;
    this.status("playing", audio.src.startsWith("blob:") ? "blob" : "network", audio.currentTime);
    if (this.candidateStarted) return;
    if (!this.standby.primed || !this.standby.primeProgressed || !this.standby.audio.paused || !Number.isFinite(audio.duration) || audio.duration - audio.currentTime > PREPARE_SECONDS) return;
    if (this.blobUrl && this.standby.audio.src !== this.blobUrl) this.replaceStandbySource(this.blobUrl);
    if (audio.duration - audio.currentTime <= OVERLAP_SECONDS && this.standby.audio.readyState >= HTMLMediaElement.HAVE_METADATA) this.startCandidate();
  };

  private startCandidate() {
    if (this.disposed || this.candidateStarted) return;
    this.candidateStarted = true; this.candidateProgressed = false;
    this.candidateStart = this.standby.audio.currentTime;
    this.standby.gate.gain.value = 1;
    void this.standby.audio.play().then(() => {
      if (this.disposed || !this.candidateStarted) return;
      const startedAt = Date.now();
      this.candidateTimer = setInterval(() => {
        if (this.disposed || !this.candidateStarted) return;
        if (this.standby.audio.currentTime > this.candidateStart + 0.05) {
          this.candidateProgressed = true;
          if (this.candidateTimer) clearInterval(this.candidateTimer);
          this.candidateTimer = null;
          const remainingMs = Math.max(0, this.current.audio.duration - this.current.audio.currentTime) * 1000;
          this.watchdog = setTimeout(() => this.resolveWatchdog(), remainingMs + END_TOLERANCE_MS);
        } else if (Date.now() - startedAt >= PROGRESSION_TIMEOUT_MS) this.rejectCandidate();
      }, 100);
    }).catch(() => { if (!this.disposed && this.candidateStarted) this.rejectCandidate(); });
  }

  private rejectCandidate() {
    this.clearTimers(); this.standby.audio.pause(); this.standby.audio.currentTime = 0; this.standby.gate.gain.value = 0;
    this.candidateStarted = false; this.candidateProgressed = false;
    // A failed automatic B start must not be retried on every timeupdate of this pass.
    this.standby.primed = false;
  }

  private readonly onCurrentEnded = () => {
    if (this.disposed) return;
    if (this.candidateStarted && this.candidateProgressed && !this.standby.audio.paused) this.promote();
    else this.repeatCurrent();
  };

  private repeatCurrent() {
    this.clearTimers(); this.candidateStarted = false; this.candidateProgressed = false;
    this.current.audio.currentTime = 0;
    void this.current.audio.play().catch(() => undefined);
  }

  private resolveWatchdog() {
    if (this.disposed || !this.candidateStarted) return;
    if (this.candidateProgressed && !this.standby.audio.paused && !this.standby.audio.ended && !this.standby.audio.error) this.promote();
    else this.rejectCandidate();
  }

  private promote() {
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
    this.status("playing", this.current.audio.src.startsWith("blob:") ? "blob" : "network", this.current.audio.currentTime);
    if (this.blobUrl) this.replaceStandbySource(this.blobUrl);
    else this.standby.audio.currentTime = 0;
  }

  private clearTimers() { if (this.candidateTimer) clearInterval(this.candidateTimer); if (this.watchdog) clearTimeout(this.watchdog); this.candidateTimer = null; this.watchdog = null; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clearTimers();
    this.decks.forEach(deck => {
      if (deck.primeTimer) clearInterval(deck.primeTimer);
      deck.audio.removeEventListener("timeupdate", this.onCurrentTimeUpdate);
      deck.audio.removeEventListener("ended", this.onCurrentEnded);
      deck.audio.pause(); deck.source.disconnect(); deck.gate.disconnect(); deck.audio.removeAttribute("src"); deck.audio.load();
    });
    this.volumeGain.disconnect(); void this.context.close().catch(() => undefined);
  }
}

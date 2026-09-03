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

type PreparedTrack = { index: number; objectUrl: string };
type Listener = () => void;

const INITIAL_STATE: Mp3EngineState = {
  status: "idle",
  currentTrackIndex: 0,
  preparedTrackIndex: null,
  sourceKind: null,
  currentTime: 0,
  error: null,
};

export class Mp3Engine {
  private audio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private preparedTrack: PreparedTrack | null = null;
  private prefetchPromise: Promise<void> | null = null;
  private loadPromise: Promise<void> | null = null;
  private listeners = new Set<Listener>();
  private state: Mp3EngineState = INITIAL_STATE;
  private generation = 0;
  private wantsPlayback = false;
  private disposed = false;

  constructor(private readonly tracks: readonly Mp3Track[]) {
    if (tracks.length === 0) throw new Error("MP3 playlist must contain at least one track");
  }

  getSnapshot = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  play = async () => {
    if (this.disposed || typeof window === "undefined") return;
    this.wantsPlayback = true;

    if (this.audio && this.currentObjectUrl) {
      try {
        await this.audio.play();
        if (!this.wantsPlayback) {
          this.audio.pause();
          return;
        }
        this.update({ status: "playing", currentTime: this.audio.currentTime, error: null });
        void this.prefetchNext();
      } catch (error) {
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
    if (!this.audio) return;
    this.audio.pause();
    this.update({ status: "paused", currentTime: this.audio.currentTime });
  };

  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.wantsPlayback = false;
    this.generation += 1;
    this.prefetchPromise = null;
    this.loadPromise = null;

    if (this.audio) {
      this.audio.pause();
      this.audio.removeEventListener("ended", this.handleEnded);
      this.audio.removeEventListener("error", this.handleAudioError);
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    this.revoke(this.currentObjectUrl);
    this.revoke(this.preparedTrack?.objectUrl ?? null);
    this.currentObjectUrl = null;
    this.preparedTrack = null;
    this.listeners.clear();
  };

  private loadInitialTrack = async () => {
    const generation = this.generation;
    this.update({ status: "loading", error: null });
    try {
      const prepared = await this.fetchTrack(0);
      if (this.disposed || generation !== this.generation) {
        this.revoke(prepared.objectUrl);
        return;
      }

      const audio = new Audio(prepared.objectUrl);
      audio.preload = "auto";
      audio.addEventListener("ended", this.handleEnded);
      audio.addEventListener("error", this.handleAudioError);
      this.audio = audio;
      this.currentObjectUrl = prepared.objectUrl;
      this.update({ currentTrackIndex: 0, sourceKind: "blob", currentTime: 0 });

      if (!this.wantsPlayback) {
        this.update({ status: "paused" });
        return;
      }
      await audio.play();
      if (!this.wantsPlayback) {
        audio.pause();
        this.update({ status: "paused", currentTime: audio.currentTime });
        return;
      }
      this.update({ status: "playing", currentTime: audio.currentTime });
      void this.prefetchNext();
    } catch (error) {
      this.handlePlayError(error);
    }
  };

  private fetchTrack = async (index: number): Promise<PreparedTrack> => {
    const response = await fetch(this.tracks[index].url);
    if (!response.ok) throw new Error(`MP3 request failed with ${response.status}`);
    const blob = await response.blob();
    return { index, objectUrl: URL.createObjectURL(blob) };
  };

  private prefetchNext = async () => {
    if (this.disposed || this.prefetchPromise || this.preparedTrack) return;
    const nextIndex = (this.state.currentTrackIndex + 1) % this.tracks.length;
    const generation = this.generation;

    this.prefetchPromise = this.fetchTrack(nextIndex)
      .then((prepared) => {
        if (this.disposed || generation !== this.generation || nextIndex === this.state.currentTrackIndex) {
          this.revoke(prepared.objectUrl);
          return;
        }
        this.revoke(this.preparedTrack?.objectUrl ?? null);
        this.preparedTrack = prepared;
        this.update({ preparedTrackIndex: nextIndex });
      })
      .catch(() => {
        // No retry loop in Phase 1. An ended track may make one normal load attempt.
      })
      .finally(() => {
        this.prefetchPromise = null;
      });
    await this.prefetchPromise;
  };

  private handleEnded = async () => {
    if (this.disposed || !this.audio) return;
    const nextIndex = (this.state.currentTrackIndex + 1) % this.tracks.length;
    this.update({ status: "loading", error: null });

    try {
      if (!this.preparedTrack && this.prefetchPromise) await this.prefetchPromise;
      const next = this.preparedTrack?.index === nextIndex
        ? this.preparedTrack
        : await this.fetchTrack(nextIndex);
      if (this.disposed || !this.audio) {
        this.revoke(next.objectUrl);
        return;
      }

      this.preparedTrack = null;
      const previousObjectUrl = this.currentObjectUrl;
      this.currentObjectUrl = next.objectUrl;
      this.audio.src = next.objectUrl;
      this.audio.currentTime = 0;
      this.update({ currentTrackIndex: nextIndex, preparedTrackIndex: null, sourceKind: "blob", currentTime: 0 });

      try {
        if (!this.wantsPlayback) {
          this.update({ status: "paused" });
          return;
        }
        await this.audio.play();
        this.update({ status: "playing" });
        void this.prefetchNext();
      } finally {
        this.revoke(previousObjectUrl);
      }
    } catch (error) {
      this.handlePlayError(error);
    }
  };

  private handleAudioError = () => {
    this.wantsPlayback = false;
    this.update({ status: "error", error: "The browser could not play this MP3." });
  };

  private handlePlayError(error: unknown) {
    this.wantsPlayback = false;
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

export interface AmbientTrack {
  id: string;
  url: string;
}

export type AmbientPlaybackStatus = "idle" | "loading" | "playing" | "error";

export interface AmbientEngineState {
  status: AmbientPlaybackStatus;
  activeTrackId: string | null;
  sourceKind: "blob" | null;
  volume: number;
  currentTime: number;
  error: string | null;
}

type Listener = () => void;

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
  private objectUrl: string | null = null;
  private fetchController: AbortController | null = null;
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

    const generation = this.generation + 1;
    this.generation = generation;
    this.cleanupPlayback();
    const controller = new AbortController();
    this.fetchController = controller;
    this.update({ status: "loading", activeTrackId: track.id, sourceKind: null, currentTime: 0, error: null });

    try {
      const response = await fetch(track.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Ambient request failed with ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (this.disposed || generation !== this.generation) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      this.fetchController = null;
      const audio = new Audio(objectUrl);
      audio.preload = "auto";
      audio.loop = true;
      audio.volume = this.state.volume;
      audio.addEventListener("error", this.handleAudioError);
      this.audio = audio;
      this.objectUrl = objectUrl;
      this.update({ sourceKind: "blob" });

      await audio.play();
      if (this.disposed || generation !== this.generation) return;
      this.update({ status: "playing", currentTime: audio.currentTime });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (this.disposed || generation !== this.generation) return;
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
    this.listeners.clear();
  };

  private handleAudioError = () => {
    this.handleError(new Error("The browser could not play this ambient track."));
  };

  private handleError(error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load or play this ambient track.";
    console.error("[AmbientEngine]", message);
    this.generation += 1;
    this.cleanupPlayback();
    this.update({ status: "error", sourceKind: null, currentTime: 0, error: message });
  }

  private cleanupPlayback() {
    this.fetchController?.abort();
    this.fetchController = null;

    if (this.audio) {
      this.audio.pause();
      this.audio.removeEventListener("error", this.handleAudioError);
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }

    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private update(patch: Partial<AmbientEngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}

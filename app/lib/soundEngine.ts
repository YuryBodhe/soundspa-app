import { Howl, Howler } from "howler";

type ChannelId = string;
type NoiseId = string;

interface SoundEngine {
  playChannel: (id: ChannelId, streamUrl: string) => void;
  stopChannel: () => void;
  setNoise: (id: NoiseId | null, streamUrl?: string) => void;
  setNoiseVolume: (volume: number) => void;
  stopNoise: () => void;
}

const isBrowser = typeof window !== "undefined";

let mainHowl: Howl | null = null;
let mainChannelId: ChannelId | null = null;
let mainStreamUrl: string | null = null;

let noiseHowl: Howl | null = null;
let noiseId: NoiseId | null = null;
let noiseStreamUrl: string | null = null;
let noiseVolume = 0.5;
let noiseFadeTimeout: number | null = null;

const clampVolume = (value: number) => {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const destroyHowl = (howl: Howl | null) => {
  if (!howl) return;
  try {
    howl.stop();
    howl.unload();
  } catch (error) {
    console.warn("[soundEngine] Failed to destroy Howl instance", error);
  }
};

const fadeNoiseTo = (targetVolume: number, durationMs: number) => {
  if (!isBrowser || !noiseHowl) return;

  const startVolume = noiseHowl.volume();
  const endVolume = clampVolume(targetVolume);

  if (noiseFadeTimeout !== null) {
    window.clearTimeout(noiseFadeTimeout);
    noiseFadeTimeout = null;
  }

  if (durationMs <= 0) {
    noiseHowl.volume(endVolume);
    return;
  }

  const startTime = performance.now();

  const step = () => {
    if (!noiseHowl) return;

    const now = performance.now();
    const t = Math.min(1, (now - startTime) / durationMs);
    const next = startVolume + (endVolume - startVolume) * t;

    try {
      noiseHowl.volume(next);
    } catch (error) {
      console.warn("[soundEngine] Failed during noise fade", error);
    }

    if (t < 1) {
      noiseFadeTimeout = window.setTimeout(step, 16);
    } else {
      noiseFadeTimeout = null;
    }
  };

  step();
};

export const soundEngine: SoundEngine = {
  playChannel(id, streamUrl) {
    if (!isBrowser) return;

    if (mainHowl && id === mainChannelId && streamUrl && streamUrl === mainStreamUrl) {
      return;
    }

    destroyHowl(mainHowl);
    mainHowl = null;
    mainChannelId = null;
    mainStreamUrl = null;

    if (!streamUrl) return;

    mainHowl = new Howl({
      src: [streamUrl],
      html5: true,
      loop: true,
      volume: 1,
    });

    mainChannelId = id;
    mainStreamUrl = streamUrl;

    try { mainHowl.play(); } catch (e) { console.warn("[soundEngine] main play error:", e); }
  },

  stopChannel() {
    if (!isBrowser) return;
    destroyHowl(mainHowl);
    mainHowl = null;
    mainChannelId = null;
    mainStreamUrl = null;
  },

  setNoise(id, streamUrl) {
    if (!isBrowser) return;
    if (id == null) { this.stopNoise(); return; }

    if (noiseHowl && id === noiseId && streamUrl && streamUrl === noiseStreamUrl) return;

    // Crossfade: keep old playing while fading in new
    const oldHowl = noiseHowl;
    if (oldHowl) {
      const oldVol = oldHowl.volume();
      oldHowl.fade(oldVol, 0, 5000);
      setTimeout(() => { try { oldHowl.stop(); oldHowl.unload(); } catch {} }, 5100);
    }
    noiseHowl = null;
    noiseId = null;
    noiseStreamUrl = null;

    if (!streamUrl) return;

    const isStaticNoise = streamUrl.startsWith("/") || (typeof window !== "undefined" && streamUrl.startsWith("https://" + window.location.host + "/"));

    noiseHowl = new Howl({
      src: [streamUrl],
      html5: !isStaticNoise,
      format: isStaticNoise ? ["mp3"] : undefined,
      loop: true,
      volume: 0,
    });

    noiseId = id;
    noiseStreamUrl = streamUrl;

    try { 
      noiseHowl.volume(0); 
      noiseHowl.play(); 
      // Use native Howler fade for smooth entry
      noiseHowl.fade(0, noiseVolume, 5000);
    } 
    catch (e) { console.warn("[soundEngine] noise play error:", e); }
  },

  setNoiseVolume(volume) {
    if (!isBrowser) return;
    noiseVolume = clampVolume(volume);
    if (noiseHowl) { try { noiseHowl.fade(noiseHowl.volume(), noiseVolume, 400); } catch (e) {} }
  },

  stopNoise() {
    if (!isBrowser) return;
    if (!noiseHowl) { noiseId = null; noiseStreamUrl = null; return; }
    const howl = noiseHowl;
    noiseHowl.fade(noiseHowl.volume(), 0, 5000);
    window.setTimeout(() => {
      if (howl === noiseHowl) { destroyHowl(noiseHowl); noiseHowl = null; noiseId = null; noiseStreamUrl = null; }
      else { destroyHowl(howl); }
    }, 5100);
  },
};

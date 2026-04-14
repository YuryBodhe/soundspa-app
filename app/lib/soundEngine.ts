import { Howl, Howler } from "howler";
import Hls from "hls.js";

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
const FADE_DURATION = 3000;

let mainHowl: Howl | null = null;
let mainHls: Hls | null = null;
let mainAudioElement: HTMLAudioElement | null = null;
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

const fadeOutAndDestroy = (audio: HTMLAudioElement | null, hls: Hls | null) => {
  if (!audio) return;
  const startVol = audio.volume;
  const fadeTime = 3000; // Увеличиваем до 3 сек для мобилок
  const interval = 100;  // Реже шаг = стабильнее на iOS
  const steps = fadeTime / interval;
  const step = startVol / steps;

  const fadeTimer = setInterval(() => {
    if (audio.volume > step) {
      audio.volume -= step;
    } else {
      audio.volume = 0;
      audio.pause();
      // Важно: в Safari сначала убираем src, потом разрушаем hls
      audio.src = ""; 
      audio.load(); 
      hls?.destroy();
      audio.remove();
      clearInterval(fadeTimer);
    }
  }, interval);
};

export const soundEngine: SoundEngine = {
 playChannel(id, streamUrl) {
    if (!isBrowser) return;

    if (id === mainChannelId && streamUrl === mainStreamUrl) return;

    // --- 1. ПЛАВНО ОСТАНАВЛИВАЕМ СТАРОЕ ---
    if (mainHowl) {
      mainHowl.fade(mainHowl.volume(), 0, FADE_DURATION);
      const oldHowl = mainHowl;
      setTimeout(() => { destroyHowl(oldHowl); }, FADE_DURATION + 100);
      mainHowl = null;
    }

    if (mainAudioElement) {
      fadeOutAndDestroy(mainAudioElement, mainHls);
      mainAudioElement = null;
      mainHls = null;
    }

    if (!streamUrl) return;

    mainChannelId = id;
    mainStreamUrl = streamUrl;

    // --- 2. ЗАПУСКАЕМ НОВОЕ ---
    if (streamUrl.includes(".m3u8")) {
      mainAudioElement = new Audio();
      mainAudioElement.volume = 0; 

      // ОБНОВЛЕННАЯ ФУНКЦИЯ ВНУТРИ
      const runFadeIn = (el: HTMLAudioElement) => {
        let vol = 0;
        const interval = 100; // Реже шаг для стабильности iOS
        const step = 1 / (FADE_DURATION / interval);

        const upTimer = setInterval(() => {
          vol += step;
          if (el) {
            el.volume = Math.min(1, vol);
            if (vol >= 1) clearInterval(upTimer);
          } else { 
            clearInterval(upTimer); 
          }
        }, interval);
      };

      if (Hls.isSupported()) {
        mainHls = new Hls({ liveSyncDuration: 10, maxBufferLength: 30 });
        mainHls.loadSource(streamUrl);
        mainHls.attachMedia(mainAudioElement);
        mainHls.on(Hls.Events.MANIFEST_PARSED, () => {
          mainAudioElement?.play().then(() => runFadeIn(mainAudioElement!))
            .catch(e => console.warn("[soundEngine] HLS Play error:", e));
        });
      }
      else if (mainAudioElement.canPlayType('application/vnd.apple.mpegurl')) {
        mainAudioElement.src = streamUrl;
        // Для Safari на iOS добавляем небольшой запас перед воспроизведением
        mainAudioElement.play().then(() => runFadeIn(mainAudioElement!))
          .catch(e => console.warn("[soundEngine] Safari HLS error:", e));
      }
    } else {
      mainHowl = new Howl({ src: [streamUrl], html5: true, volume: 0 });
      mainHowl.play();
      mainHowl.fade(0, 1, FADE_DURATION);
    }
  },

  stopChannel() {
    if (!isBrowser) return;

    if (mainHowl) {
      mainHowl.fade(mainHowl.volume(), 0, FADE_DURATION);
      const old = mainHowl;
      setTimeout(() => { destroyHowl(old); }, FADE_DURATION + 100);
      mainHowl = null;
    }

    if (mainAudioElement) {
      fadeOutAndDestroy(mainAudioElement, mainHls);
      mainAudioElement = null;
      mainHls = null;
    }

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

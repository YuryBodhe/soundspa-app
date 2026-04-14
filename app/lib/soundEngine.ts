import { Howl } from "howler";
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

// Web Audio API контекст (синглтон)
let audioCtx: AudioContext | null = null;
const getAudioCtx = () => {
  if (!audioCtx && isBrowser) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
};

// Хранилище для активного канала
let mainHls: Hls | null = null;
let mainAudioElement: HTMLAudioElement | null = null;
let mainGainNode: GainNode | null = null;
let mainSourceNode: MediaElementAudioSourceNode | null = null;
let mainHowl: Howl | null = null;
let mainChannelId: ChannelId | null = null;
let mainStreamUrl: string | null = null;

// Хранилище для шумов
let noiseHowl: Howl | null = null;
let noiseId: NoiseId | null = null;
let noiseStreamUrl: string | null = null;
let noiseVolume = 0.5;

const clampVolume = (value: number) => {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const destroyHowl = (howl: Howl | null) => {
  if (!howl) return;
  try {
    howl.stop();
    howl.unload();
  } catch (error) {
    console.warn("[soundEngine] Failed to destroy Howl", error);
  }
};

/**
 * Плавное удаление аудио-элемента через Web Audio Gain Node
 */
const fadeOutAndDestroy = (
  audio: HTMLAudioElement | null, 
  hls: Hls | null, 
  gainNode: GainNode | null,
  sourceNode: MediaElementAudioSourceNode | null
) => {
  if (!audio || !gainNode) return;

  const ctx = getAudioCtx();
  if (ctx) {
    // Нативный фейд Web Audio - Safari его не блокирует
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_DURATION / 1000);
  }

  setTimeout(() => {
    audio.pause();
    audio.src = "";
    audio.load();
    hls?.destroy();
    sourceNode?.disconnect();
    gainNode?.disconnect();
    audio.remove();
  }, FADE_DURATION + 100);
};

export const soundEngine: SoundEngine = {
  playChannel(id, streamUrl) {
    if (!isBrowser) return;
    if (id === mainChannelId && streamUrl === mainStreamUrl) return;

    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();

    // 1. ОСТАНОВКА СТАРОГО
    if (mainHowl) {
      mainHowl.fade(mainHowl.volume(), 0, FADE_DURATION);
      const oldHowl = mainHowl;
      setTimeout(() => destroyHowl(oldHowl), FADE_DURATION + 100);
      mainHowl = null;
    }

    if (mainAudioElement) {
      fadeOutAndDestroy(mainAudioElement, mainHls, mainGainNode, mainSourceNode);
      mainAudioElement = null;
      mainHls = null;
      mainGainNode = null;
      mainSourceNode = null;
    }

    if (!streamUrl) return;

    mainChannelId = id;
    mainStreamUrl = streamUrl;

    // 2. ЗАПУСК НОВОГО
    if (streamUrl.includes(".m3u8")) {
      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      // Оставляем громкость элемента на 1, управлять будем через GainNode
      audio.volume = 1; 
      
      mainAudioElement = audio;

      if (ctx) {
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.connect(ctx.destination);
        
        const source = ctx.createMediaElementSource(audio);
        source.connect(gainNode);
        
        mainGainNode = gainNode;
        mainSourceNode = source;
      }

      const runFadeIn = () => {
        if (mainGainNode && ctx) {
          mainGainNode.gain.cancelScheduledValues(ctx.currentTime);
          mainGainNode.gain.setValueAtTime(0, ctx.currentTime);
          mainGainNode.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_DURATION / 1000);
        }
      };

      if (Hls.isSupported()) {
        mainHls = new Hls({ liveSyncDuration: 10, maxBufferLength: 30 });
        mainHls.loadSource(streamUrl);
        mainHls.attachMedia(audio);
        mainHls.on(Hls.Events.MANIFEST_PARSED, () => {
          audio.play().then(runFadeIn).catch(e => console.warn("HLS Play error", e));
        });
      } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = streamUrl;
        audio.play().then(runFadeIn).catch(e => console.warn("Safari HLS error", e));
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
      setTimeout(() => destroyHowl(old), FADE_DURATION + 100);
      mainHowl = null;
    }
    if (mainAudioElement) {
      fadeOutAndDestroy(mainAudioElement, mainHls, mainGainNode, mainSourceNode);
      mainAudioElement = null;
      mainHls = null;
      mainGainNode = null;
      mainSourceNode = null;
    }
    mainChannelId = null;
    mainStreamUrl = null;
  },

  setNoise(id, streamUrl) {
    if (!isBrowser) return;
    if (id == null) { this.stopNoise(); return; }
    if (noiseHowl && id === noiseId && streamUrl === noiseStreamUrl) return;

    const oldHowl = noiseHowl;
    if (oldHowl) {
      oldHowl.fade(oldHowl.volume(), 0, 4000);
      setTimeout(() => destroyHowl(oldHowl), 4100);
    }

    if (!streamUrl) return;

    const isStatic = streamUrl.startsWith("/") || streamUrl.includes(window.location.host);

    noiseHowl = new Howl({
      src: [streamUrl],
      html5: !isStatic,
      loop: true,
      volume: 0,
    });

    noiseId = id;
    noiseStreamUrl = streamUrl;

    try {
      noiseHowl.play();
      noiseHowl.fade(0, noiseVolume, 4000);
    } catch (e) {
      console.warn("Noise play error", e);
    }
  },

  setNoiseVolume(volume) {
    if (!isBrowser) return;
    noiseVolume = clampVolume(volume);
    if (noiseHowl) {
      noiseHowl.fade(noiseHowl.volume(), noiseVolume, 500);
    }
  },

  stopNoise() {
    if (!isBrowser || !noiseHowl) return;
    const current = noiseHowl;
    current.fade(current.volume(), 0, 4000);
    setTimeout(() => {
      if (noiseHowl === current) {
        destroyHowl(noiseHowl);
        noiseHowl = null;
        noiseId = null;
        noiseStreamUrl = null;
      } else {
        destroyHowl(current);
      }
    }, 4100);
  },
};
import { Howl } from "howler";

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

// ОСНОВНОЙ ПОТОК (Azura) - Нативный Audio для стабильности на iOS
let mainAudio: HTMLAudioElement | null = null;
let mainChannelId: ChannelId | null = null;
let mainStreamUrl: string | null = null;

// ШУМОВЫЕ КАНАЛЫ (Howler - для петель и фейдов)
let noiseHowl: Howl | null = null;
let noiseId: NoiseId | null = null;
let noiseStreamUrl: string | null = null;
let noiseVolume = 0.5;

const clampVolume = (value: number) => {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export const soundEngine: SoundEngine = {
  playChannel(id, streamUrl) {
    if (!isBrowser) return;
    if (id === mainChannelId && streamUrl === mainStreamUrl) return;

    // Плавный уход предыдущего потока
    if (mainAudio) {
      const oldAudio = mainAudio;
      let vol = oldAudio.volume;
      const fadeOut = setInterval(() => {
        vol -= 0.05;
        if (vol <= 0) {
          clearInterval(fadeOut);
          oldAudio.pause();
          oldAudio.src = "";
          oldAudio.load();
        } else {
          oldAudio.volume = Math.max(0, vol);
        }
      }, 50); // Быстрый шаг для плавности
    }

    if (!streamUrl) return;

    mainChannelId = id;
    mainStreamUrl = streamUrl;

    mainAudio = new Audio(streamUrl);
    mainAudio.crossOrigin = "anonymous";
    mainAudio.preload = "auto";
    mainAudio.autoplay = true;

    try {
      mainAudio.play().catch(e => console.warn("Azura stream blocked:", e));
    } catch (e) {
      console.warn("Azura play error:", e);
    }
  },

  stopChannel() {
    if (!isBrowser || !mainAudio) return;
    const old = mainAudio;
    let vol = old.volume;
    const fadeOut = setInterval(() => {
      vol -= 0.05;
      if (vol <= 0) {
        clearInterval(fadeOut);
        old.pause();
        old.src = "";
        if (mainAudio === old) {
          mainAudio = null;
          mainChannelId = null;
          mainStreamUrl = null;
        }
      } else {
        old.volume = Math.max(0, vol);
      }
    }, 50);
  },

  setNoise(id, streamUrl) {
    if (!isBrowser) return;
    if (id == null) { this.stopNoise(); return; }
    if (noiseHowl && id === noiseId && streamUrl === noiseStreamUrl) return;

    // Плавная смена одного шума на другой
    if (noiseHowl) {
      const old = noiseHowl;
      old.fade(old.volume(), 0, 2000);
      setTimeout(() => { 
        try { old.stop(); old.unload(); } catch {} 
      }, 2100);
    }

    if (!streamUrl) return;

    noiseHowl = new Howl({
      src: [streamUrl],
      html5: true, 
      loop: true,
      volume: 0, // Начинаем с тишины для плавного входа
    });

    noiseId = id;
    noiseStreamUrl = streamUrl;

    try {
      noiseHowl.play();
      // Входим плавно до того уровня, который сейчас на фейдере
      noiseHowl.fade(0, noiseVolume, 3000);
    } catch (e) {
      console.warn("Noise play error:", e);
    }
  },

  setNoiseVolume(volume) {
    if (!isBrowser) return;
    noiseVolume = clampVolume(volume);
    if (noiseHowl) {
      // Мгновенная реакция на движение ползунка
      noiseHowl.volume(noiseVolume);
    }
  },

  stopNoise() {
    if (!isBrowser || !noiseHowl) return;
    const current = noiseHowl;
    current.fade(current.volume(), 0, 2000);
    setTimeout(() => {
      if (noiseHowl === current) {
        current.stop();
        current.unload();
        noiseHowl = null;
        noiseId = null;
        noiseStreamUrl = null;
      } else {
        current.stop();
        current.unload();
      }
    }, 2100);
  },
};
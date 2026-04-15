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

// ОСНОВНОЙ ПОТОК (Azura) - используем нативный Audio
let mainAudio: HTMLAudioElement | null = null;
let mainChannelId: ChannelId | null = null;
let mainStreamUrl: string | null = null;

// ШУМОВЫЕ КАНАЛЫ (Howler - для петель подходит отлично)
import { Howl } from "howler";
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

    // 1. Плавный уход старого канала через нативный метод (если был)
    if (mainAudio) {
      const oldAudio = mainAudio;
      // Плавное затухание вручную для нативного Audio
      let vol = 1;
      const fadeOut = setInterval(() => {
        vol -= 0.1;
        if (vol <= 0) {
          clearInterval(fadeOut);
          oldAudio.pause();
          oldAudio.src = "";
          oldAudio.load();
        } else {
          oldAudio.volume = vol;
        }
      }, 200);
    }

    if (!streamUrl) return;

    mainChannelId = id;
    mainStreamUrl = streamUrl;

    // 2. Создаем нативный аудио-объект
    mainAudio = new Audio(streamUrl);
    mainAudio.preload = "none"; // Чтобы не жрать трафик до старта
    mainAudio.crossOrigin = "anonymous";
    
    // Включаем нативную поддержку фонового воспроизведения для iOS
    mainAudio.autoplay = true;

    try {
      const playPromise = mainAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.warn("Autoplay blocked or stream error:", error);
        });
      }
    } catch (e) {
      console.warn("Play error", e);
    }
  },

  stopChannel() {
    if (!isBrowser || !mainAudio) return;
    
    let vol = mainAudio.volume;
    const fadeOut = setInterval(() => {
      if (!mainAudio) {
        clearInterval(fadeOut);
        return;
      }
      vol -= 0.1;
      if (vol <= 0) {
        clearInterval(fadeOut);
        mainAudio.pause();
        mainAudio.src = "";
        mainAudio = null;
        mainChannelId = null;
        mainStreamUrl = null;
      } else {
        mainAudio.volume = vol;
      }
    }, 100);
  },

  // Оставляем Howler для шумовых каналов, так как там нужен loop и сложная логика
  setNoise(id, streamUrl) {
    if (!isBrowser) return;
    if (id == null) { this.stopNoise(); return; }
    if (noiseHowl && id === noiseId && streamUrl === noiseStreamUrl) return;

    if (noiseHowl) {
      const old = noiseHowl;
      old.fade(old.volume(), 0, 2000);
      setTimeout(() => { try { old.stop(); old.unload(); } catch {} }, 2100);
    }

    if (!streamUrl) return;

    noiseHowl = new Howl({
      src: [streamUrl],
      html5: true, // Для стримов это критично
      loop: true,
      volume: 0,
    });

    noiseId = id;
    noiseStreamUrl = streamUrl;

    try {
      noiseHowl.play();
      noiseHowl.fade(0, noiseVolume, 3000);
    } catch (e) {
      console.warn("[soundEngine] noise play error:", e);
    }
  },

  setNoiseVolume(volume) {
    if (!isBrowser) return;
    noiseVolume = clampVolume(volume);
    if (noiseHowl) {
      noiseHowl.volume(noiseVolume);
    }
  },

  stopNoise() {
    if (!isBrowser || !noiseHowl) return;
    const current = noiseHowl;
    current.fade(current.volume(), 0, 2000);
    setTimeout(() => {
      if (noiseHowl === current) {
        noiseHowl.stop();
        noiseHowl.unload();
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
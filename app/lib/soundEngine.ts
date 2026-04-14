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
const FADE_DURATION = 3000;

let mainHowl: Howl | null = null;
let mainChannelId: ChannelId | null = null;
let mainStreamUrl: string | null = null;

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

    // 1. СТАРЫЙ КАНАЛ: Просто оставляем его играть "как есть" на 5 секунд
    // Мы не вызываем fade, так как Safari его игнорирует. 
    // Мы просто даем ему доиграть на фоне нового.
    if (mainHowl) {
      const oldHowl = mainHowl;
      setTimeout(() => {
        try {
          oldHowl.stop();
          oldHowl.unload();
        } catch (e) {}
      }, 6000); // Увеличиваем нахлест до 6 секунд
    }

    if (!streamUrl) return;

    mainChannelId = id;
    mainStreamUrl = streamUrl;

    // 2. НОВЫЙ КАНАЛ: 
    mainHowl = new Howl({
      src: [streamUrl],
      html5: true, 
      format: ['mp3', 'aac', 'm4a'],
      volume: 0, // Начинаем с абсолютной тишины
    });

    try {
      mainHowl.play();
      // Даем Safari 200мс осознать, что поток пошел, и только потом начинаем фейд
      setTimeout(() => {
        if (mainHowl) {
          mainHowl.fade(0, 1, 5000); // Растягиваем вход нового канала
        }
      }, 200);
    } catch (e) {
      console.warn("Play error", e);
    }
  },

  stopChannel() {
    if (!isBrowser || !mainHowl) return;
    const old = mainHowl;
    old.fade(old.volume(), 0, FADE_DURATION);
    setTimeout(() => {
      if (mainHowl === old) {
        mainHowl.stop();
        mainHowl.unload();
        mainHowl = null;
        mainChannelId = null;
        mainStreamUrl = null;
      } else {
        old.stop();
        old.unload();
      }
    }, FADE_DURATION + 100);
  },

  setNoise(id, streamUrl) {
    if (!isBrowser) return;
    if (id == null) { this.stopNoise(); return; }
    if (noiseHowl && id === noiseId && streamUrl === noiseStreamUrl) return;

    const oldHowl = noiseHowl;
    if (oldHowl) {
      oldHowl.fade(oldHowl.volume(), 0, 4000);
      setTimeout(() => {
        try { oldHowl.stop(); oldHowl.unload(); } catch {}
      }, 4100);
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
      console.warn("[soundEngine] noise play error:", e);
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
        noiseHowl.stop();
        noiseHowl.unload();
        noiseHowl = null;
        noiseId = null;
        noiseStreamUrl = null;
      } else {
        current.stop();
        current.unload();
      }
    }, 4100);
  },
};
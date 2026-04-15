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

// Состояния основного потока (Azura HLS)
let mainAudio: HTMLAudioElement | null = null;
let mainChannelId: ChannelId | null = null;
let mainStreamUrl: string | null = null;

// Состояния шумового потока (Azura HLS)
let noiseAudio: HTMLAudioElement | null = null;
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

    // 1. Плавный уход старого канала
    if (mainAudio) {
      const oldAudio = mainAudio;
      let vol = oldAudio.volume;
      const fadeOut = setInterval(() => {
        vol -= 0.05;
        if (vol <= 0) {
          clearInterval(fadeOut);
          oldAudio.pause();
          oldAudio.src = "";
          oldAudio.load(); // Важно для сброса HLS буфера
        } else {
          oldAudio.volume = Math.max(0, vol);
        }
      }, 50);
    }

    if (!streamUrl) return;

    mainChannelId = id;
    mainStreamUrl = streamUrl;

    // 2. Создание нового нативного Audio объекта для HLS
    mainAudio = new Audio(streamUrl);
    mainAudio.crossOrigin = "anonymous";
    mainAudio.preload = "auto";
    mainAudio.volume = 1;

    try {
      mainAudio.play().catch(e => console.warn("Main stream play blocked:", e));
    } catch (e) {
      console.warn("Main stream error:", e);
    }
  },

  stopChannel() {
    if (!isBrowser || !mainAudio) return;
    const current = mainAudio;
    let vol = current.volume;
    const fadeOut = setInterval(() => {
      vol -= 0.05;
      if (vol <= 0) {
        clearInterval(fadeOut);
        current.pause();
        current.src = "";
        current.load();
        if (mainAudio === current) {
          mainAudio = null;
          mainChannelId = null;
          mainStreamUrl = null;
        }
      } else {
        current.volume = Math.max(0, vol);
      }
    }, 50);
  },

  setNoise(id, streamUrl) {
    if (!isBrowser) return;
    if (id == null) { this.stopNoise(); return; }
    if (id === noiseId && streamUrl === noiseStreamUrl) return;

    // 1. Плавный уход старого шума
    if (noiseAudio) {
      const oldNoise = noiseAudio;
      let vol = oldNoise.volume;
      const fadeOut = setInterval(() => {
        vol -= 0.05;
        if (vol <= 0) {
          clearInterval(fadeOut);
          oldNoise.pause();
          oldNoise.src = "";
          oldNoise.load();
        } else {
          oldNoise.volume = Math.max(0, vol);
        }
      }, 50);
    }

    if (!streamUrl) return;

    noiseId = id;
    noiseStreamUrl = streamUrl;

    // 2. Создание нового нативного Audio для шумового HLS-потока
    noiseAudio = new Audio(streamUrl);
    noiseAudio.crossOrigin = "anonymous";
    noiseAudio.preload = "auto";
    noiseAudio.volume = 0; // Начинаем с тишины для плавного входа

    try {
      noiseAudio.play().then(() => {
        // Программный фейд-ин до текущего уровня громкости
        let vol = 0;
        const fadeIn = setInterval(() => {
          vol += 0.02;
          if (vol >= noiseVolume || !noiseAudio) {
            clearInterval(fadeIn);
            if (noiseAudio) noiseAudio.volume = noiseVolume;
          } else {
            noiseAudio.volume = vol;
          }
        }, 50);
      }).catch(e => console.warn("Noise stream play blocked:", e));
    } catch (e) {
      console.warn("Noise stream error:", e);
    }
  },

  setNoiseVolume(volume) {
    if (!isBrowser) return;
    noiseVolume = clampVolume(volume);
    if (noiseAudio) {
      // Мгновенная реакция на фейдер
      noiseAudio.volume = noiseVolume;
    }
  },

  stopNoise() {
    if (!isBrowser || !noiseAudio) return;
    const current = noiseAudio;
    let vol = current.volume;
    const fadeOut = setInterval(() => {
      vol -= 0.05;
      if (vol <= 0) {
        clearInterval(fadeOut);
        current.pause();
        current.src = "";
        current.load();
        if (noiseAudio === current) {
          noiseAudio = null;
          noiseId = null;
          noiseStreamUrl = null;
        }
      } else {
        current.volume = Math.max(0, vol);
      }
    }, 50);
  },
};
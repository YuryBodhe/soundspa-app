// soundEngine.ts
type ChannelId = string;
type NoiseId = string;

interface SoundEngine {
  playChannel: (id: ChannelId, streamUrl: string) => void;
  stopChannel: () => void;
  setNoise: (id: NoiseId | null, streamUrl?: string) => void;
  setNoiseVolume: (volume: number) => void;
  stopNoise: () => void;
  initWatcher: () => void;
  setMainVolume: (vol: number) => void;
}

const isBrowser = typeof window !== "undefined";
const FADE_TIME = 3000; 

// --- Внутреннее состояние ---
const sessionId = isBrowser ? `sess_${Math.random().toString(36).substring(2, 9)}_${Date.now()}` : 'node';
let mainAudio: HTMLAudioElement | null = null;
let mainChannelId: string | null = null;
let mainStreamUrl: string | null = null;

let noiseAudio: HTMLAudioElement | null = null;
let noiseId: string | null = null;
let noiseStreamUrl: string | null = null;
let currentNoiseVol = 0.4; // Дефолтное значение

// --- Вспомогательная функция фейда ---
const internalFade = (audio: HTMLAudioElement, targetVol: number, duration: number, callback?: () => void) => {
  const startVol = audio.volume;
  const startTime = performance.now();

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Плавное изменение громкости
    audio.volume = startVol + (targetVol - startVol) * progress;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else if (callback) {
      callback();
    }
  };
  requestAnimationFrame(step);
};

// --- SILENCE HACK ---
let silencePlayer: HTMLAudioElement | null = null;
const keepAudioContextAlive = () => {
  if (!isBrowser || silencePlayer) return;
  const silentSrc = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
  silencePlayer = new Audio(silentSrc);
  silencePlayer.loop = true;
  silencePlayer.volume = 0.001;
  const start = () => silencePlayer?.play().catch(() => window.addEventListener('click', start, { once: true }));
  start();
};

export const soundEngine: SoundEngine = {
  initWatcher() {
    if (isBrowser) keepAudioContextAlive();
    // Запускаем пульс мониторинга
    setInterval(async () => {
      try {
        await fetch('/api/monitoring/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: 1, // Позже можно сделать динамическим
            status: mainAudio && !mainAudio.paused ? "online" : "paused",
            metadata: {
              sessionId: sessionId,
              channelId: mainChannelId,
              noiseId: noiseId,
              device: "Desktop-Player",
              version: "1.1.0"
            }
          })
        });
      } catch (e) {
        // Не спамим в консоль, чтобы не забивать логи браузера
      }
    }, 60000); // Раз в минуту
  },

  playChannel(id, url) {
    if (!isBrowser) return;
    if (id === mainChannelId && url === mainStreamUrl) return;

    // Кроссфейд: старый плавно гасим и удаляем
    if (mainAudio) {
      const old = mainAudio;
      internalFade(old, 0, FADE_TIME, () => {
        old.pause();
        old.src = "";
      });
    }

    mainChannelId = id;
    mainStreamUrl = url;

    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.volume = 0.001; // Почти ноль для прогрева
    mainAudio = audio;

    audio.play()
      .then(() => internalFade(audio, 0.8, FADE_TIME))
      .catch(e => console.warn("Main play blocked", e));
  },

  stopChannel() {
    if (!mainAudio) return;
    const target = mainAudio;
    internalFade(target, 0, FADE_TIME, () => {
      target.pause();
      target.src = "";
      if (mainAudio === target) {
        mainAudio = null;
        mainChannelId = null;
        mainStreamUrl = null;
      }
    });
  },

  setMainVolume(vol) {
    if (mainAudio) mainAudio.volume = Math.max(0, Math.min(1, vol));
  },

  setNoise(id, url) {
    if (!isBrowser || !url) return;
    if (id === noiseId && url === noiseStreamUrl) return;

    if (noiseAudio) {
      const old = noiseAudio;
      internalFade(old, 0, 1500, () => {
        old.pause();
        old.src = "";
      });
    }

    noiseId = id;
    noiseStreamUrl = url;

    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.volume = 0.001;
    noiseAudio = audio;

    audio.play()
      .then(() => internalFade(audio, currentNoiseVol, 2000))
      .catch(e => console.warn("Noise blocked", e));
  },

  setNoiseVolume(volume) {
    currentNoiseVol = Math.max(0, Math.min(1, volume));
    if (noiseAudio) noiseAudio.volume = currentNoiseVol;
  },

  stopNoise() {
    if (!noiseAudio) return;
    const target = noiseAudio;
    internalFade(target, 0, 1500, () => {
      target.pause();
      target.src = "";
      if (noiseAudio === target) {
        noiseAudio = null;
        noiseId = null;
        noiseStreamUrl = null;
      }
    });
  }
};
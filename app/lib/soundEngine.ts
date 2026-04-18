type ChannelId = string;
type NoiseId = string;

interface SoundEngine {
  playChannel: (id: ChannelId, streamUrl: string) => void;
  stopChannel: () => void;
  setMainVolume: (volume: number) => void;
  setNoise: (id: NoiseId | null, streamUrl?: string) => void;
  setNoiseVolume: (volume: number) => void;
  stopNoise: () => void;
  initWatcher: () => void;
}

const isBrowser = typeof window !== "undefined";

// --- STATE ---
let mainAudio: HTMLAudioElement | null = null;
let mainChannelId: string | null = null;
let mainStreamUrl: string | null = null;

let noiseAudio: HTMLAudioElement | null = null;
let noiseId: string | null = null;
let noiseStreamUrl: string | null = null;

// --- SILENCE HACK (удержание аудио-карты от засыпания) ---
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
    if (!isBrowser) return;
    keepAudioContextAlive();
    // Мониторинг и авто-рекавери удалены по запросу
  },

  playChannel(id, streamUrl) {
    if (!isBrowser) return;
    
    // Если канал тот же — не дергаем поток
    if (id === mainChannelId && streamUrl === mainStreamUrl) return;

    if (mainAudio) {
      mainAudio.pause();
      mainAudio.src = "";
    }

    mainChannelId = id;
    mainStreamUrl = streamUrl;

    const audio = new Audio(streamUrl);
    audio.crossOrigin = "anonymous";
    audio.volume = 0; // Плавный вход (fade in) делает DesktopPlayer
    mainAudio = audio;
    
    audio.play().catch(e => console.warn("Main play blocked", e));
  },

  stopChannel() {
    if (!mainAudio) return;
    mainAudio.pause();
    mainAudio.src = "";
    mainAudio = null;
    mainChannelId = null;
    mainStreamUrl = null;
  },

  setMainVolume(vol) {
    if (mainAudio) mainAudio.volume = Math.max(0, Math.min(1, vol));
  },

  setNoise(id, streamUrl) {
    if (!isBrowser || (id === noiseId && streamUrl === noiseStreamUrl)) return;
    if (noiseAudio) { noiseAudio.pause(); noiseAudio.src = ""; }
    
    if (!streamUrl) return;
    noiseId = id;
    noiseStreamUrl = streamUrl;

    const audio = new Audio(streamUrl);
    audio.crossOrigin = "anonymous";
    audio.volume = 0; // Плавный вход делает DesktopPlayer
    noiseAudio = audio;
    
    setTimeout(() => {
      audio.play().catch(e => console.warn("Noise blocked", e));
    }, 50);
  },

  setNoiseVolume(volume) {
    if (noiseAudio) noiseAudio.volume = Math.max(0, Math.min(1, volume));
  },

  stopNoise() {
    if (!noiseAudio) return;
    noiseAudio.pause();
    noiseAudio.src = "";
    noiseAudio = null;
    noiseId = null;
    noiseStreamUrl = null;
  }
};
type ChannelId = string;
type NoiseId = string;

interface SoundEngine {
  playChannel: (id: ChannelId, streamUrl: string) => void;
  stopChannel: () => void;
  setNoise: (id: NoiseId | null, streamUrl?: string) => void;
  setNoiseVolume: (volume: number) => void;
  stopNoise: () => void;
  initWatcher: () => void;
}

const isBrowser = typeof window !== "undefined";

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

// --- STATE ---
let mainAudio: HTMLAudioElement | null = null;
let mainChannelId: string | null = null;
let mainStreamUrl: string | null = null;
let noiseAudio: HTMLAudioElement | null = null;
let noiseId: string | null = null;
let noiseStreamUrl: string | null = null;

export const soundEngine: SoundEngine = {
  initWatcher() {
    if (!isBrowser) return;
    keepAudioContextAlive();
  },

  playChannel(id, streamUrl) {
    if (!isBrowser || (id === mainChannelId && streamUrl === mainStreamUrl)) return;
    if (mainAudio) { mainAudio.pause(); mainAudio.src = ""; }
    
    mainChannelId = id;
    mainStreamUrl = streamUrl;
    
    const audio = new Audio(streamUrl);
    audio.crossOrigin = "anonymous";
    audio.volume = 0.8; // Базовая громкость без фейдов
    mainAudio = audio;
    audio.play().catch(e => console.error("Main play blocked", e));
  },

  stopChannel() {
    if (!mainAudio) return;
    mainAudio.pause();
    mainAudio.src = "";
    mainAudio = null;
    mainChannelId = null;
    mainStreamUrl = null;
  },

  setNoise(id, streamUrl) {
    if (!isBrowser || (id === noiseId && streamUrl === noiseStreamUrl)) return;
    if (noiseAudio) { noiseAudio.pause(); noiseAudio.src = ""; }
    
    if (!streamUrl) return;
    noiseId = id;
    noiseStreamUrl = streamUrl;

    const audio = new Audio(streamUrl);
    audio.crossOrigin = "anonymous";
    audio.volume = 0; // Начинаем с 0, DesktopPlayer поднимет
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
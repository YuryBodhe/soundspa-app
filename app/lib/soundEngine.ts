type ChannelId = string;
type NoiseId = string;

interface SoundEngine {
  playChannel: (id: ChannelId, streamUrl: string) => void;
  stopChannel: () => void;
  setNoise: (id: NoiseId | null, streamUrl?: string) => void;
  setNoiseVolume: (volume: number) => void;
  stopNoise: () => void;
  // Добавим метод инициализации мониторинга
  initWatcher: () => void;
}

const isBrowser = typeof window !== "undefined";

// Проверка на Apple (нужна для блокировки изменений на iOS)
const isApple = isBrowser && (
  /iPhone|iPad|iPod/.test(navigator.platform) || 
  (navigator.userAgent.includes("Mac") && "ontouchend" in document)
);

// ЭТАЛОННЫЕ ЗНАЧЕНИЯ ГРОМКОСТИ
const MASTER_MAIN_VOL = 0.8;
const MASTER_NOISE_VOL = 0.5;

// Состояния основного потока
let mainAudio: HTMLAudioElement | null = null;
let mainChannelId: string | null = null; 
let mainStreamUrl: string | null = null;
let lastTimeUpdate = 0;

// Состояния шумового потока
let noiseAudio: HTMLAudioElement | null = null;
let noiseId: string | null = null;
let noiseStreamUrl: string | null = null;
let noiseVolume = MASTER_NOISE_VOL;

// --- WATCHER & RECOVERY LOGIC ---

const recoverConnection = () => {
  if (!mainChannelId || !mainStreamUrl || !mainAudio) return;

  console.warn(`SoundEngine: Попытка восстановления канала ${mainChannelId}`);
  
  // Принудительная очистка старого объекта перед реконнектом
  mainAudio.pause();
  mainAudio.src = "";
  mainAudio.load();

  // Создаем новый объект с обходом кэша
  const recoveryUrl = `${mainStreamUrl}${mainStreamUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
  mainAudio = new Audio(recoveryUrl);
  mainAudio.volume = MASTER_MAIN_VOL;
  
  mainAudio.play().catch(e => console.error("SoundEngine Recovery Error:", e));
};

const checkHealth = () => {
  if (!mainAudio || mainAudio.paused) return;

  // Если время в плеере не изменилось за цикл проверки - значит поток "встал"
  if (mainAudio.currentTime === lastTimeUpdate) {
    recoverConnection();
  }
  lastTimeUpdate = mainAudio.currentTime;
};

const checkScheduledRestart = () => {
  const now = new Date();
  // Определяем мобильное устройство
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  
  // Добавляем !isMobile в условие
  if (!isMobile && now.getHours() === 4 && now.getMinutes() === 0 && now.getSeconds() < 15) {
    console.log("SoundEngine: Плановая перезагрузка страницы для очистки памяти.");
    
    // Сохраняем состояние
    localStorage.setItem('last_active_channel', JSON.stringify({
      id: mainChannelId, 
      url: mainStreamUrl
    }));
    
    window.location.reload();
  }
};

// --- END WATCHER ---

const clampVolume = (value: number) => {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export const soundEngine: SoundEngine = {
  // Инициализация мониторинга (вызвать один раз при старте приложения)
  initWatcher() {
    if (!isBrowser) return;
    setInterval(() => {
      checkHealth();
      checkScheduledRestart();
    }, 10000); // Проверка каждые 10 секунд
  },

  playChannel(id, streamUrl) {
    if (!isBrowser) return;
    if (id === mainChannelId && streamUrl === mainStreamUrl) return;

    if (mainAudio) {
      const oldAudio = mainAudio;
      let vol = oldAudio.volume;
      const fadeOut = setInterval(() => {
        vol -= 0.05;
        if (vol <= 0) {
          clearInterval(fadeOut);
          oldAudio.pause();
          oldAudio.src = "";
        } else {
          oldAudio.volume = Math.max(0, vol);
        }
      }, 50);
    }

    if (!streamUrl) return;

    mainChannelId = id;
    mainStreamUrl = streamUrl;
    
    // При старте нового канала сбрасываем счетчик времени
    lastTimeUpdate = 0;
    
    mainAudio = new Audio(streamUrl);
    mainAudio.volume = 0;
    mainAudio.play().catch(e => console.error("Play blocked:", e));

    let fadeInVol = 0;
    const fadeIn = setInterval(() => {
      fadeInVol += 0.05;
      if (fadeInVol >= MASTER_MAIN_VOL) {
        clearInterval(fadeIn);
        if (mainAudio) mainAudio.volume = MASTER_MAIN_VOL;
      } else {
        if (mainAudio) mainAudio.volume = fadeInVol;
      }
    }, 100);
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

    // 2. Создание нового нативного Audio для шумового потока
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
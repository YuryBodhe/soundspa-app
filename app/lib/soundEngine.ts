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

// Флаг, чтобы не запускать несколько восстановлений одновременно
let isRecovering = false;

const recoverConnection = () => {
  if (isRecovering || !mainChannelId || !mainStreamUrl || !mainAudio) return;

  isRecovering = true;
  console.warn(`SoundEngine: Попытка восстановления канала ${mainChannelId}`);
  
  mainAudio.pause();
  mainAudio.src = "";
  mainAudio.load();

  setTimeout(() => {
    const url = mainStreamUrl;
    if (!url) {
      isRecovering = false;
      return;
    }

    const recoveryUrl = `${url}${url.includes('?') ? '&' : '?'}cb=${Date.now()}`;
    
    // ПРИМЕНЯЕМ ТАКТИКУ ПРОТИВ ЩЕЛЧКОВ ПРИ ВОССТАНОВЛЕНИИ
    const newAudio = new Audio();
    newAudio.volume = 0; // Начинаем с тишины
    newAudio.src = recoveryUrl;
    
    setTimeout(() => {
      newAudio.play()
        .then(() => {
          console.log("SoundEngine: Восстановление успешно");
          mainAudio = newAudio;
          isRecovering = false;
          
          // Плавный возврат громкости
          let v = 0;
          const f = setInterval(() => {
            v += 0.05;
            if (v >= MASTER_MAIN_VOL) {
              clearInterval(f);
              newAudio.volume = MASTER_MAIN_VOL;
            } else {
              newAudio.volume = v;
            }
          }, 100);
        })
        .catch(e => {
          console.error("SoundEngine Recovery Error:", e.name);
          isRecovering = false;
        });
    }, 50);
  }, 2000);
};

const checkHealth = () => {
  if (!mainAudio || mainAudio.paused || isRecovering) return;

  if (mainAudio.currentTime === lastTimeUpdate) {
    // Если поток висит в буферизации (readyState 1 или 2) больше 15-20 секунд
    // Значит, он сам уже не выберется. Нужно "толкнуть".
    
    if (mainAudio.readyState <= 2) {
      console.warn("SoundEngine: Затянувшаяся буферизация. Переподключаюсь...");
      recoverConnection(); // Force recovery
    } else {
      recoverConnection();
    }
  }
  lastTimeUpdate = mainAudio.currentTime;
};

const checkScheduledRestart = () => {
  const now = new Date();
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  
  // Перезагрузка в 4 утра только для десктопов
  if (!isMobile && now.getHours() === 4 && now.getMinutes() === 0 && now.getSeconds() < 15) {
    console.log("SoundEngine: Плановая перезагрузка страницы.");
    
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

    // --- Фейд-аут старого (без изменений) ---
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
    lastTimeUpdate = 0;
    
    // --- ИСПРАВЛЕНИЕ ДЛЯ CHROME ---
    // 1. Создаем объект БЕЗ URL (пустой)
    const audio = new Audio();
    audio.volume = 0;
    
    // 2. Только после установки громкости даем URL
    audio.src = streamUrl;
    mainAudio = audio;

    // 3. Небольшая пауза (50мс), чтобы Chrome успел "прожевать" настройки
    setTimeout(() => {
      audio.play().then(() => {
        let fadeInVol = 0;
        const fadeIn = setInterval(() => {
          fadeInVol += 0.05;
          if (fadeInVol >= MASTER_MAIN_VOL) {
            clearInterval(fadeIn);
            if (audio) audio.volume = MASTER_MAIN_VOL;
          } else {
            if (audio) audio.volume = fadeInVol;
          }
        }, 100);
      }).catch(e => console.error("Play blocked:", e));
    }, 50); 
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
    if (id === noiseId && streamUrl === noiseStreamUrl) return;

    if (noiseAudio) {
      noiseAudio.pause();
      noiseAudio.src = "";
      noiseAudio.load();
    }

    if (!streamUrl) return;

    noiseId = id;
    noiseStreamUrl = streamUrl;

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    audio.volume = 0; // Оставляем 0, DesktopPlayer сам поднимет фейдер
    audio.src = streamUrl;
    noiseAudio = audio;

    // Важно: в Chrome play() лучше вызывать через микро-паузу даже здесь
    setTimeout(() => {
        audio.play().catch(e => console.warn("Noise play blocked:", e));
    }, 50);
  },

  setNoiseVolume(volume) {
    if (!isBrowser) return;
    noiseVolume = clampVolume(volume);
    if (noiseAudio) {
      noiseAudio.volume = noiseVolume;
    }
  },

  stopNoise() {
    if (!isBrowser || !noiseAudio) return;
    
    // Мгновенный стоп (так как DesktopPlayer уже увел громкость в 0)
    noiseAudio.pause();
    noiseAudio.src = "";
    noiseAudio.load();
    
    noiseAudio = null;
    noiseId = null;
    noiseStreamUrl = null;
  },
};
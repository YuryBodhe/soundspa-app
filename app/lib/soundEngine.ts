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
  // Если уже восстанавливаемся или нет данных для канала — выходим
  if (isRecovering || !mainChannelId || !mainStreamUrl || !mainAudio) return;

  isRecovering = true;
  console.warn(`SoundEngine: Попытка восстановления канала ${mainChannelId}`);
  
  // 1. Принудительная очистка текущего объекта
  mainAudio.pause();
  mainAudio.src = "";
  mainAudio.load();

  // 2. Делаем паузу 2 секунды
  setTimeout(() => {
    // Создаем локальную переменную, чтобы TS не сомневался в её наличии
    const url = mainStreamUrl;
    if (!url) {
      isRecovering = false;
      return;
    }

    const recoveryUrl = `${url}${url.includes('?') ? '&' : '?'}cb=${Date.now()}`;
    
    const newAudio = new Audio(recoveryUrl);
    newAudio.volume = MASTER_MAIN_VOL;
    
    newAudio.play()
      .then(() => {
        console.log("SoundEngine: Восстановление успешно");
        mainAudio = newAudio;
        isRecovering = false;
      })
      .catch(e => {
        console.error("SoundEngine Recovery Error:", e.name);
        isRecovering = false;
      });
  }, 2000);
};

const checkHealth = () => {
  // Лог для отладки (потом удалим)
  // console.log(`HealthCheck: state=${mainAudio?.readyState}, paused=${mainAudio?.paused}, time=${mainAudio?.currentTime}`);

  if (!mainAudio || mainAudio.paused || isRecovering) return;

  if (mainAudio.currentTime === lastTimeUpdate) {
    console.warn("SoundEngine: Пульс не обнаружен. Проверяю readyState...");
    
    // Если поток просто буферизуется (readyState 1 или 2), дадим ему еще шанс
    if (mainAudio.readyState <= 2) {
      console.log("SoundEngine: Поток в режиме ожидания данных (буферизация).");
      // Можно не реконектить сразу, а подождать еще цикл
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
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    audio.volume = 0;
    audio.src = streamUrl;
    noiseAudio = audio;

    setTimeout(() => {
      audio.play().then(() => {
        let vol = 0;
        const fadeIn = setInterval(() => {
          if (audio !== noiseAudio) {
            clearInterval(fadeIn);
            return;
          }
          vol += 0.02;
          if (vol >= noiseVolume) {
            clearInterval(fadeIn);
            audio.volume = noiseVolume;
          } else {
            audio.volume = vol;
          }
        }, 50);
      }).catch(e => console.warn("Noise stream play blocked:", e));
    }, 50); 
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
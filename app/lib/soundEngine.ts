// soundEngine.ts
type ChannelId = string;
type NoiseId = string;

interface SoundEngine {
  playChannel: (id: ChannelId, streamUrl: string) => void;
  stopChannel: () => void;
  setNoise: (id: NoiseId | null, streamUrl?: string) => void;
  setNoiseVolume: (volume: number) => void;
  stopNoise: () => void;
  initWatcher: (tenantId: string | number) => void;
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
let reconnectTimer: any = null; 
let retryCount = 0;
let currentTenantId: string | number = 'unknown';

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
  initWatcher(tenantId) {
    if (tenantId) currentTenantId = tenantId; // Запоминаем, кто мы
    if (isBrowser) keepAudioContextAlive();
    // Запускаем пульс мониторинга
    setInterval(async () => {
      try {
        await fetch('/api/monitoring/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: currentTenantId, // Используем динамический ID
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
    // Если это тот же канал, который уже играет — ничего не делаем
    if (id === mainChannelId && url === mainStreamUrl) return;

    // Очистка старого потока
    if (mainAudio) {
      const old = mainAudio;
      internalFade(old, 0, FADE_TIME, () => {
        old.pause();
        old.src = "";
        old.load();
      });
    }

    // Сброс мониторинга при ручном переключении
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    retryCount = 0;

    mainChannelId = id;
    mainStreamUrl = url;

    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.volume = 0.001; 
    mainAudio = audio;

    // --- Функция реанимации потока ---
   const runReconnect = () => {
      if (reconnectTimer || !mainStreamUrl) return;

      // Просто уведомляем наш API, что мы в процессе восстановления
      fetch('/api/monitoring/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: 1, 
          status: "reconnecting",
          metadata: { 
            sessionId, 
            channelId: mainChannelId, 
            error: "Connection Lost" 
          }
        })
      }).catch(() => {}); 

      retryCount++;
      const delay = Math.min(1000 * Math.pow(2, retryCount), 20000); 
      
      console.warn(`[SoundEngine] Поток прерван. Попытка #${retryCount}...`);

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!mainStreamUrl) return;

        const retryUrl = mainStreamUrl.includes('?') 
          ? `${mainStreamUrl}&t=${Date.now()}` 
          : `${mainStreamUrl}?t=${Date.now()}`;
        
        audio.src = retryUrl;
        audio.load();
        audio.play()
          .then(() => {
            retryCount = 0;
            internalFade(audio, 0.8, FADE_TIME);
            console.log("[SoundEngine] Восстановлено!");

            // УВЕДОМЛЯЕМ ОБ УСПЕХЕ
            fetch('/api/monitoring/ping', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tenantId: 1, 
                status: "online", 
                metadata: { 
                  sessionId, 
                  channelId: mainChannelId, 
                  info: "Recovered successfully" 
                }
              })
            }).catch(() => {});
          })
          .catch(() => runReconnect()); 
      }, delay);
    };

    // Вешаем «слушателей» на новый объект audio
    audio.addEventListener('error', () => {
      console.error("[SoundEngine] Ошибка сети");
      runReconnect();
    });

    audio.addEventListener('stalled', () => {
      console.warn("[SoundEngine] Поток замер");
      runReconnect();
    });

    // Запуск
    audio.play()
      .then(() => {
        retryCount = 0;
        internalFade(audio, 0.8, FADE_TIME);
      })
      .catch(e => {
        console.warn("Main play blocked by browser", e);
        window.addEventListener('click', () => audio.play(), { once: true });
      });
  },

  stopChannel() {
    if (!mainAudio) return;

    // СТРАХОВКА: Останавливаем любые попытки переподключения,
    // так как пользователь сам нажал "Стоп"
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const target = mainAudio;
    internalFade(target, 0, FADE_TIME, () => {
      target.pause();
      target.src = "";
      target.load(); // Очищаем буфер
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
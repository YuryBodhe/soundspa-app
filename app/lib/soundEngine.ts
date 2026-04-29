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
  dispose: () => void;
  getState: () => {
    isPlaying: boolean;
    channelId: string | null;
    noiseId: string | null;
  };
}

const isBrowser = typeof window !== "undefined";
const FADE_TIME = 3000; 

// --- Внутреннее состояние ---
const sessionId = isBrowser ? `sess_${Math.random().toString(36).substring(2, 9)}_${Date.now()}` : 'node';
let mainAudio: HTMLAudioElement | null = null;
let mainChannelId: string | null = null;
let mainStreamUrl: string | null = null;
let isMainTransitioning = false;

let noiseAudio: HTMLAudioElement | null = null;
let noiseId: string | null = null;
let noiseStreamUrl: string | null = null;
let isNoiseTransitioning = false;
let currentNoiseVol = 0.4; // Дефолтное значение
let reconnectTimer: ReturnType<typeof setTimeout> | null = null; 
let retryCount = 0;
let currentTenantId: string | number = 'unknown';
let pingInterval: ReturnType<typeof setInterval> | null = null;
let isBuffering = false;

const getValidTenantId = (): number | null => {
  const parsedTenantId = Number(currentTenantId);
  if (!Number.isInteger(parsedTenantId) || parsedTenantId <= 0) return null;
  return parsedTenantId;
};

// --- Вспомогательные функции ---

const cleanAudio = (audio: HTMLAudioElement | null) => {
  if (!audio) return;
  try {
    audio.pause();
    // Эти три строки критичны для разгрузки процессора и сети:
    audio.src = ""; 
    audio.removeAttribute('src'); 
    audio.load(); 
    
    // Сбрасываем все обработчики, чтобы "мертвое" аудио не спамило в консоль
    audio.onplay = null;
    audio.onpause = null;
    audio.onerror = null;
    audio.onstalled = null;
    audio.onwaiting = null;
  } catch (err) {
    console.warn("[SoundEngine] cleanAudio error", err);
  }
};

// --- Вспомогательная функция фейда ---
const internalFade = (
  audio: HTMLAudioElement,
  targetVol: number,
  duration: number,
  callback?: () => void,
  onFadeStart?: () => void
) => {
  const startVol = audio.volume;
  const startTime = performance.now();
  let cancelled = false;

  if (onFadeStart) onFadeStart();

  const step = (now: number) => {
    if (cancelled) return;

    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const newVol = startVol + (targetVol - startVol) * progress;
    audio.volume = Math.max(0, Math.min(1, newVol));

    if (progress < 1) {
      requestAnimationFrame(step);
    } else if (callback && !cancelled) {
      callback();
    }
  };

  requestAnimationFrame(step);

  return () => {
    cancelled = true;
  };
};

const clearReconnect = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  retryCount = 0;
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

const detectClientType = (userAgent: string): "desktop" | "mobile" | "tablet" | "other" => {
  const ua = userAgent.toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android/.test(ua)) return "mobile";
  if (/macintosh|windows|linux/.test(ua)) return "desktop";
  return "other";
};

export const soundEngine: SoundEngine = {
  initWatcher(tenantId) {
    const parsedTenantId = Number(tenantId);
    if (Number.isInteger(parsedTenantId) && parsedTenantId > 0) {
      currentTenantId = parsedTenantId;
    }
    if (isBrowser) keepAudioContextAlive();
    if (pingInterval) {
      clearInterval(pingInterval);
    }

    // Запускаем пульс мониторинга
    pingInterval = setInterval(async () => {
      try {
        const validTenantId = getValidTenantId();
        if (validTenantId === null) return;

        const status = mainAudio && !mainAudio.paused ? "online" : "paused";
        const userAgent = isBrowser ? navigator.userAgent : "unknown";
        const clientType = detectClientType(userAgent);

        await fetch('/api/monitoring/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: validTenantId,
            status,
            metadata: {
              eventType: "player_heartbeat",
              status,
              sessionId,
              channelId: mainChannelId ?? null,
              noiseId: noiseId ?? null,
              device: "Desktop-Player",
              version: "1.2.0",
              clientType,
              userAgent,
              isBuffering,
            },
          })
        });
      } catch (e) {
        // Не спамим в консоль, чтобы не забивать логи браузера
      }
    }, 60000); // Раз в минуту
  },

  playChannel(id, url) {
    if (!isBrowser) return;

    // 1. Если уже идет переключение — не мешаем
    if (isMainTransitioning) {
      console.warn("[SoundEngine] main transition in progress");
      return;
    }

    // 2. Если нажали на тот же канал, который уже играет — просто выходим или возобновляем
    if (id === mainChannelId && url === mainStreamUrl) {
      if (mainAudio && mainAudio.paused) {
        mainAudio.play()
          .then(() => internalFade(mainAudio!, 0.8, FADE_TIME))
          .catch((e) => console.warn("[SoundEngine] resume blocked", e));
      }
      return;
    }

    isMainTransitioning = true;

    // 3. Жестко останавливаем и чистим всё старое перед запуском нового
    this.stopChannel(); 

    mainChannelId = id;
    mainStreamUrl = url;

    // 4. Создаем новый объект
    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.volume = 0.001; 
    mainAudio = audio;
    isBuffering = false;

    // 5. Минимальный набор слушателей (без циклов реконнекта!)
    audio.addEventListener('error', () => {
      console.error("[SoundEngine] Критическая ошибка потока");
      this.stopChannel(); // Просто гасим плеер, если стрим "умер"
    });

    audio.addEventListener('stalled', () => {
      console.warn("[SoundEngine] Поток замер (буферизация)");
      isBuffering = true;
      // Позволяем браузеру самому разобраться с буфером
    });

    audio.addEventListener('playing', () => {
      isBuffering = false;
    });

    audio.addEventListener('canplay', () => {
      isBuffering = false;
    });

    // 6. Запуск
    audio.play()
      .then(() => {
        isMainTransitioning = false;
        internalFade(audio, 0.8, FADE_TIME);
      })
      .catch(e => {
        isMainTransitioning = false;
        console.warn("Main play blocked by browser", e);
        // Если браузер запретил автоплей, ждем клика пользователя
        window.addEventListener('click', () => audio.play(), { once: true });
      });
  },

  stopChannel() {
    // 1. Сбрасываем флаги сразу, чтобы интерфейс мгновенно отреагировал
    isMainTransitioning = false;
    mainChannelId = null;
    mainStreamUrl = null;

    if (!mainAudio) return;

    // 2. Снимаем всех слушателей
    mainAudio.onerror = null;
    mainAudio.onstalled = null;
    mainAudio.onwaiting = null;
    mainAudio.onplaying = null;
    mainAudio.oncanplay = null;

    const target = mainAudio;
    mainAudio = null; // Отвязываем ссылку сразу
    isBuffering = false;

    // 3. Быстрый фейд и жесткая очистка
    // Используем 200мс, чтобы не было щелчка в динамиках
    internalFade(target, 0, 200, () => {
      cleanAudio(target);
    });
  },

  setMainVolume(vol) {
    if (mainAudio) mainAudio.volume = Math.max(0, Math.min(1, vol));
  },

  setNoise(id, url) {
    if (!isBrowser || !url) return;

    if (isNoiseTransitioning) {
      console.warn("[SoundEngine] noise transition in progress");
      return;
    }

    if (id === noiseId && url === noiseStreamUrl) {
      if (noiseAudio && noiseAudio.paused) {
        noiseAudio
          .play()
          .then(() => internalFade(noiseAudio!, currentNoiseVol, 2000))
          .catch((e) => console.warn("[SoundEngine] noise resume blocked", e));
      }
      return;
    }

    isNoiseTransitioning = true;

    const previous = noiseAudio;
    if (previous) {
      cleanAudio(previous);
    }
    noiseAudio = null;
    noiseId = null;
    noiseStreamUrl = null;

    noiseId = id;
    noiseStreamUrl = url;

    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.volume = 0.001;
    noiseAudio = audio;

    audio
      .play()
      .then(() => {
        isNoiseTransitioning = false;
        internalFade(audio, currentNoiseVol, 2000);
      })
      .catch((e) => {
        isNoiseTransitioning = false;
        console.warn("Noise blocked", e);
      });
  },

  setNoiseVolume(volume) {
    currentNoiseVol = Math.max(0, Math.min(1, volume));
    if (noiseAudio) noiseAudio.volume = currentNoiseVol;
  },

  stopNoise() {
    if (!noiseAudio) return;
    const target = noiseAudio;
    isNoiseTransitioning = false;
    internalFade(target, 0, 1500, () => {
      cleanAudio(target);
      if (noiseAudio === target) {
        noiseAudio = null;
        noiseId = null;
        noiseStreamUrl = null;
      }
    });
  },

  dispose() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    clearReconnect();
    cleanAudio(mainAudio);
    cleanAudio(noiseAudio);
    cleanAudio(silencePlayer);
    mainAudio = null;
    noiseAudio = null;
    silencePlayer = null;
    mainChannelId = null;
    mainStreamUrl = null;
    noiseId = null;
    noiseStreamUrl = null;
    isMainTransitioning = false;
    isNoiseTransitioning = false;
  },

  getState() {
    return {
      isPlaying: !!(mainAudio && !mainAudio.paused),
      channelId: mainChannelId,
      noiseId: noiseId,
    };
  }
};
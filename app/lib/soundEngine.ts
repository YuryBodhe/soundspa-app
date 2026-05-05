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
const sessionId = isBrowser
  ? `sess_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`
  : "node";

let mainAudio: HTMLAudioElement | null = null;
let mainChannelId: string | null = null;
let mainStreamUrl: string | null = null;
let isMainTransitioning = false;

let noiseAudio: HTMLAudioElement | null = null;
let noiseId: string | null = null;
let noiseStreamUrl: string | null = null;
let isNoiseTransitioning = false;
let currentNoiseVol = 0.4;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let currentTenantId: string | number = "unknown";
let pingInterval: ReturnType<typeof setInterval> | null = null;
let isBuffering = false;

// ---------------------------------------------------------------------------
// WATCHDOG
// ---------------------------------------------------------------------------
// Принцип: каждые WATCHDOG_INTERVAL мс смотрим, движется ли audio.currentTime.
// Для радио-стрима currentTime всегда растёт, пока играет живой поток.
// Если время не сдвинулось WATCHDOG_STALL_LIMIT мс — считаем это обрывом
// и пересоздаём Audio-элемент без каких-либо внешних уведомлений (UI не трогаем).
//
// Почему не слушаем события error/stalled/waiting?
//   — Chrome при зависшем стриме часто не шлёт ни одного из них.
//   — Если слушать их напрямую и сразу реконнектить, получаем каскад:
//     error → reconnect → error → reconnect → CPU перегрев + console spam.
//   — Watchdog срабатывает не чаще раза в WATCHDOG_STALL_LIMIT, поэтому
//     даже при полном отсутствии сети цикл реконнектов медленный и безопасный.

const WATCHDOG_INTERVAL = 3000;    // частота проверки, мс
const WATCHDOG_STALL_LIMIT = 8000; // порог зависания, мс (~8 с)

let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let lastCurrentTime = 0;
let lastCurrentTimeAt = 0;      // performance.now() последнего движения времени
let isIntentionallyPaused = false; // true = пользователь сам нажал Stop

const startWatchdog = () => {
  stopWatchdog();
  lastCurrentTime = 0;
  lastCurrentTimeAt = performance.now();

  watchdogTimer = setInterval(() => {
    if (isMainTransitioning || isIntentionallyPaused) return;
    if (!mainAudio || !mainStreamUrl || !mainChannelId) return;

    const ct = mainAudio.currentTime;
    const now = performance.now();

    if (ct !== lastCurrentTime) {
      lastCurrentTime = ct;
      lastCurrentTimeAt = now;
      return;
    }

    const stalledMs = now - lastCurrentTimeAt;
    if (stalledMs >= WATCHDOG_STALL_LIMIT) {
      console.warn(
        `[SoundEngine] Watchdog: поток завис ${Math.round(stalledMs / 1000)}с — реконнект`
      );
      lastCurrentTimeAt = now; // сбрасываем, чтобы не стрелять повторно сразу
      silentReconnect();
    }
  }, WATCHDOG_INTERVAL);
};

const stopWatchdog = () => {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
};

// Тихий реконнект: пересоздаём Audio с той же громкостью — UI не знает об этом.
const silentReconnect = () => {
  if (!mainStreamUrl || !mainChannelId) return;

  const url = mainStreamUrl;
  const vol = mainAudio ? mainAudio.volume : 0.8;

  console.info("[SoundEngine] silentReconnect", { channelId: mainChannelId, url });

  if (mainAudio) {
    const dead = mainAudio;
    mainAudio = null;
    dead.onerror = null;
    dead.onstalled = null;
    dead.onwaiting = null;
    dead.onplaying = null;
    dead.oncanplay = null;
    dead.pause();
    // Без audio.load() — не тревожим noise-поток
    setTimeout(() => {
      try { dead.src = ""; dead.removeAttribute("src"); } catch (_) {}
    }, 100);
  }

  const audio = new Audio(url);
  audio.crossOrigin = "anonymous";
  audio.volume = vol; // стартуем с текущей громкости — без щелчка
  mainAudio = audio;
  isBuffering = false;

  attachMainListeners(audio);

  audio.play().catch((e) => {
    console.warn("[SoundEngine] silentReconnect play blocked", e);
  });
};

// Слушатели для main-аудио — вынесены, чтобы не дублировать
const forceWatchdogTick = () => {
  // Считаем, что уже давно стоим: watchdog отработает при ближайшей проверке
  lastCurrentTimeAt = performance.now() - WATCHDOG_STALL_LIMIT;
};

const attachMainListeners = (audio: HTMLAudioElement) => {
  audio.addEventListener("error", () => {
    isBuffering = true;
    forceWatchdogTick();
  });
  audio.addEventListener("stalled", () => {
    isBuffering = true;
    forceWatchdogTick();
  });
  audio.addEventListener("playing", () => {
    isBuffering = false;
    // Сбрасываем checkpoint: после resume время снова начнёт двигаться
    lastCurrentTimeAt = performance.now();
  });
  audio.addEventListener("canplay", () => { isBuffering = false; });
};

// ---------------------------------------------------------------------------

const getValidTenantId = (): number | null => {
  const parsedTenantId = Number(currentTenantId);
  if (!Number.isInteger(parsedTenantId) || parsedTenantId <= 0) return null;
  return parsedTenantId;
};

// Жёсткая очистка — только для main/dispose (audio.load() OK здесь)
const cleanAudio = (audio: HTMLAudioElement | null) => {
  if (!audio) return;
  try {
    audio.pause();
    audio.src = "";
    audio.removeAttribute("src");
    audio.load();
    audio.onplay = null;
    audio.onpause = null;
    audio.onerror = null;
    audio.onstalled = null;
    audio.onwaiting = null;
  } catch (err) {
    console.warn("[SoundEngine] cleanAudio error", err);
  }
};

// Мягкая очистка — для noise, без audio.load() (не тревожит main-поток)
const softCleanAudio = (audio: HTMLAudioElement | null) => {
  if (!audio) return;
  try {
    audio.pause();
    audio.onplay = null;
    audio.onpause = null;
    audio.onerror = null;
    audio.onstalled = null;
    audio.onwaiting = null;
    setTimeout(() => {
      try { audio.src = ""; audio.removeAttribute("src"); } catch (_) {}
    }, 100);
  } catch (err) {
    console.warn("[SoundEngine] softCleanAudio error", err);
  }
};

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
    audio.volume = Math.max(0, Math.min(1, startVol + (targetVol - startVol) * progress));
    if (progress < 1) {
      requestAnimationFrame(step);
    } else if (callback && !cancelled) {
      callback();
    }
  };
  requestAnimationFrame(step);
  return () => { cancelled = true; };
};

const clearReconnect = () => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  retryCount = 0;
};

let silencePlayer: HTMLAudioElement | null = null;
const keepAudioContextAlive = () => {
  if (!isBrowser || silencePlayer) return;
  const silentSrc =
    "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
  silencePlayer = new Audio(silentSrc);
  silencePlayer.loop = true;
  silencePlayer.volume = 0.001;
  const start = () =>
    silencePlayer?.play().catch(() =>
      window.addEventListener("click", start, { once: true })
    );
  start();
};

const detectClientType = (ua: string): "desktop" | "mobile" | "tablet" | "other" => {
  const u = ua.toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(u)) return "tablet";
  if (/mobile|iphone|ipod|android/.test(u)) return "mobile";
  if (/macintosh|windows|linux/.test(u)) return "desktop";
  return "other";
};

export const soundEngine: SoundEngine = {
  initWatcher(tenantId) {
    const parsed = Number(tenantId);
    if (Number.isInteger(parsed) && parsed > 0) currentTenantId = parsed;
    if (isBrowser) keepAudioContextAlive();
    if (pingInterval) clearInterval(pingInterval);

    pingInterval = setInterval(async () => {
      try {
        const validTenantId = getValidTenantId();
        if (validTenantId === null) return;
        const status = mainAudio && !mainAudio.paused ? "online" : "paused";
        const userAgent = isBrowser ? navigator.userAgent : "unknown";
        await fetch("/api/monitoring/ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
              clientType: detectClientType(userAgent),
              userAgent,
              isBuffering,
            },
          }),
        });
      } catch (_) {}
    }, 60000);
  },

  playChannel(id, url) {
    if (!isBrowser) return;
    if (isMainTransitioning) {
      console.warn("[SoundEngine] main transition in progress");
      return;
    }
    if (id === mainChannelId && url === mainStreamUrl) {
      if (mainAudio && mainAudio.paused) {
        isIntentionallyPaused = false;
        mainAudio.play()
          .then(() => internalFade(mainAudio!, 0.8, FADE_TIME))
          .catch((e) => console.warn("[SoundEngine] resume blocked", e));
      }
      return;
    }

    isMainTransitioning = true;
    isIntentionallyPaused = false;
    this.stopChannel();

    mainChannelId = id;
    mainStreamUrl = url;

    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.volume = 0.001;
    mainAudio = audio;
    isBuffering = false;

    attachMainListeners(audio);

    audio.play()
      .then(() => {
        isMainTransitioning = false;
        internalFade(audio, 0.8, FADE_TIME);
        startWatchdog(); // только после успешного старта
      })
      .catch((e) => {
        isMainTransitioning = false;
        console.warn("Main play blocked by browser", e);
        window.addEventListener("click", () => audio.play(), { once: true });
      });
  },

  stopChannel() {
    isMainTransitioning = false;
    isIntentionallyPaused = true; // явная остановка — watchdog не реконнектит
    stopWatchdog();
    mainChannelId = null;
    mainStreamUrl = null;

    if (!mainAudio) return;
    mainAudio.onerror = null;
    mainAudio.onstalled = null;
    mainAudio.onwaiting = null;
    mainAudio.onplaying = null;
    mainAudio.oncanplay = null;

    const target = mainAudio;
    mainAudio = null;
    isBuffering = false;

    internalFade(target, 0, 200, () => cleanAudio(target));
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
        noiseAudio.play()
          .then(() => internalFade(noiseAudio!, currentNoiseVol, 2000))
          .catch((e) => console.warn("[SoundEngine] noise resume blocked", e));
      }
      return;
    }

    isNoiseTransitioning = true;
    const previous = noiseAudio;
    noiseAudio = null;
    noiseId = id;
    noiseStreamUrl = url;

    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.volume = 0.001;
    noiseAudio = audio;

    const startNew = () => {
      audio.play()
        .then(() => {
          isNoiseTransitioning = false;
          internalFade(audio, currentNoiseVol, 2000);
        })
        .catch((e) => {
          isNoiseTransitioning = false;
          console.warn("Noise blocked", e);
        });
    };

    if (previous) {
      internalFade(previous, 0, 600, () => {
        softCleanAudio(previous);
        startNew();
      });
    } else {
      startNew();
    }
  },

  setNoiseVolume(volume) {
    currentNoiseVol = Math.max(0, Math.min(1, volume));
    if (noiseAudio) noiseAudio.volume = currentNoiseVol;
  },

  stopNoise() {
    if (!noiseAudio) return;
    const target = noiseAudio;
    noiseAudio = null;
    noiseId = null;
    noiseStreamUrl = null;
    isNoiseTransitioning = false;
    internalFade(target, 0, 1500, () => softCleanAudio(target));
  },

  dispose() {
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    stopWatchdog();
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
    isIntentionallyPaused = false;
  },

  getState() {
    return {
      isPlaying: !!(mainAudio && !mainAudio.paused),
      channelId: mainChannelId,
      noiseId: noiseId,
    };
  },
};

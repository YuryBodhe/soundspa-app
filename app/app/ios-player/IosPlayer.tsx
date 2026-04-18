'use client';
// ─────────────────────────────────────────────
// IosPlayer.tsx
// Этот проект — источник бесконечного изобилия для всех людей Земли, меня, моей семьи и мира!
//
// Логика:
// - channels и promoCards приходят как пропы от Server Component (page.tsx)
// - IosPlayer не знает о Drizzle / DB — только об UI-типах
// - tenantSlug оставлен для возможного использования в будущем
// - добавлена кнопка Logout (вызывает /api/auth/logout и редиректит на /login)
// ─────────────────────────────────────────────

import Image from 'next/image';
import { useMemo, useState, useEffect } from 'react';
import { soundEngine } from '@/app/lib/soundEngine';
import {
  Channel,
  AmbientChannel,
  PromoCard,
  TenantSlug,
} from './channels';
import { useWaveCanvas } from './useWaveCanvas';
import s from './player.module.css';

const LOTUS_PATH_COLOR = '#7a9ab0';

interface IosPlayerProps {
  tenantSlug?:       TenantSlug;
  salonName?:        string;
  subscriptionDate?: string;
  subscriptionWarn?: boolean;
  dailyMessage?:    string;
  channels:          Channel[];
  noiseChannels:     AmbientChannel[]; // Ошибка 1 исправлена здесь
  promoCards?:       PromoCard[];
}

export default function IosPlayer({
  tenantSlug       = 'spaquatoria',
  salonName        = 'Spaquatoria',
  subscriptionDate = 'Until 12 April 2026',
  subscriptionWarn = false,
  dailyMessage    = "",
  channels         = [],
  noiseChannels    = [], 
  promoCards       = [],
}: IosPlayerProps) {
  const tenantChannels = channels;
  const showDailyMessage = Boolean(dailyMessage && dailyMessage.trim().length > 0);

// --- ВставляемWatcher ---
  useEffect(() => {
    // Инициализируем только мониторинг зависаний
    soundEngine.initWatcher();
    
    // На iOS мы НЕ делаем авто-плей после рестарта 4 утра, 
    // так как Safari его заблокирует.
    // Но мы оставляем мониторинг, чтобы если интернет моргнул, 
    // звук восстановился сам.
  }, []);
  
  // Состояния плеера
  const [playing,         setPlaying]         = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string>(tenantChannels[0]?.id ?? '');
  const [showIosHint,     setShowIosHint]     = useState(false);
  const [activeNoiseId,   setActiveNoiseId]   = useState<string | null>(null);
  const [targetNoiseVol,  setTargetNoiseVol]  = useState(0.4);

  // Вычисляемые данные
  const activeChannel = useMemo(() => 
    tenantChannels.find(c => c.id === activeChannelId) ?? tenantChannels[0],
    [tenantChannels, activeChannelId]
  );

  // ОСТАВЛЯЕМ ТОЛЬКО ОДИН РАЗ ЗДЕСЬ:
  const sortedNoise = useMemo(
    () => [...noiseChannels].sort((a, b) => a.order - b.order),
    [noiseChannels]
  );

  const canvasRef = useWaveCanvas(playing);

  // Хендлеры
    const handleTogglePlay = () => {
    if (!activeChannel) return;

    if (playing) {
      soundEngine.stopChannel();
      setPlaying(false);
      setShowIosHint(false);
    } else {
      try {
        soundEngine.playChannel(activeChannel.id, activeChannel.streamUrl);
        setPlaying(true);
        setShowIosHint(false);
      } catch (err) {
        console.warn('soundEngine.playChannel failed', err);
        setShowIosHint(true);
      }
    }
  };

  const handleSelectChannel = (channel: Channel) => {
    setActiveChannelId(channel.id);
    try {
      soundEngine.playChannel(channel.id, channel.streamUrl);
      setPlaying(true);
      setShowIosHint(false);
    } catch (err) {
      console.warn('soundEngine.playChannel failed on switch', err);
      setShowIosHint(true);
    }
  };

   const handleNoiseToggle = (noise: AmbientChannel) => {
  if (activeNoiseId === noise.id) {
    soundEngine.stopNoise();
    setActiveNoiseId(null);
  } else {
    soundEngine.setNoise(noise.id, noise.streamUrl);
    // Всегда 0.5 для стабильности на iOS
    soundEngine.setNoiseVolume(0.5); 
    setActiveNoiseId(noise.id);
  }
};

  /* const handleNoiseVolumeChange = (valuePercent: number) => {
    const next = valuePercent / 100;
    setTargetNoiseVol(next);
    soundEngine.setNoiseVolume(next);
  };*/

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout request failed', e);
    } finally {
      window.location.href = '/login';
    }
  };

  const tagClass: Record<string, string> = {
    promo:   s.tagPromo,
    update:  s.tagUpdate,
    tech:    s.tagTech,
    offline: s.tagOffline,
  };

  return (
    <div className={s.phone}>
      {/* ── HEADER ── */}
      <header className={s.header}>
        <div>
          <div className={s.salonName}>{salonName}</div>
          <div className={s.platformTag}>Sound Spa</div>
        </div>
        <div className={s.headerRight}>
          <div className={`${s.subBadge} ${subscriptionWarn ? s.subBadgeWarn : ''}`}>
            {subscriptionWarn ? 'Expires soon' : 'Active'}
          </div>
          <button className={s.helpBtn} onClick={handleLogout}>Logout</button>
        </div>
      </header>

      {/* ── PLAYER ZONE ── */}
      <section className={s.playerZone}>
        <div className={s.nowPlayingLabel}>Now playing</div>
        <div className={s.channelName}>{activeChannel?.title}</div>
        <div className={s.channelMood}>{activeChannel?.mood}</div>

        <div
          className={`${s.yyWrap} ${playing ? s.yyWrapPlaying : ''}`}
          onClick={handleTogglePlay}
          role="button"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <div className={s.ambient} />
          <div className={`${s.halo} ${s.h1}`} />
          <div className={`${s.halo} ${s.h2}`} />
          <div className={`${s.halo} ${s.h3}`} />
          <Image
            src="/yin-yang.png"
            alt="Play / Pause"
            width={170}
            height={170}
            className={`${s.yyImage} ${playing ? s.yyImagePlaying : ''}`}
            priority
            draggable={false}
          />
        </div>

        <div className={`${s.iosHint} ${showIosHint ? s.iosHintVisible : ''}`}>
          Tap Play in the system audio bar ↓
        </div>

        <div className={s.waveZone}>
          <canvas
            ref={canvasRef}
            className={`${s.waveCanvas} ${playing ? s.waveCanvasVisible : ''}`}
          />
        </div>

        <div className={s.statusLine}>
          <div className={`${s.sdot} ${playing ? s.sdotPlaying : ''}`} />
          <div className={`${s.stxt} ${playing ? s.stxtPlaying : ''}`}>
            {playing ? 'Streaming · Sound Spa' : 'Tap to play'}
          </div>
        </div>
      </section>

     {/* ── CAROUSEL: MAIN CHANNELS ── */}
      <section className={s.carouselSection}>
        <div className={s.sectionHeader}>
          <div className={s.sectionLabel}>Channels &amp; Updates</div>
          <div className={s.sectionCount}>{tenantChannels.length} channels</div>
        </div>

        <div className={s.carousel}>
          {tenantChannels.map(channel => (
            <div
              key={channel.id}
              className={`${s.chCard} ${activeChannelId === channel.id ? s.chCardActive : ''}`}
              onClick={() => handleSelectChannel(channel)}
              role="button"
            >
              <div className={s.cardImg}>
                {/* Используем проверку: если в базе есть channel.image — берем его. 
                   Если нет — можно подставить заглушку.
                */}
                <img
  src={channel.image || '/channel-default.jpg'} 
  alt={channel.title}
  className={s.cardImgPhoto}
  style={{ 
    position: 'absolute', 
    height: '100%', 
    width: '100%', 
    inset: 0, 
    objectFit: 'cover' 
  }}
/>
                
                <div className={s.cardImgOverlay} />
                
                {/* Индикатор проигрывания */}
                <div className={`${s.playingIndicator} ${activeChannelId === channel.id && playing ? s.playingIndicatorVisible : ''}`}>
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <rect x="0"   y="0" width="2.5" height="8" rx="0.5" fill="rgba(155,185,215,0.8)"/>
                    <rect x="5.5" y="0" width="2.5" height="8" rx="0.5" fill="rgba(155,185,215,0.8)"/>
                  </svg>
                </div>
              </div>

              <div className={s.cardBody}>
                <div className={s.cardTitle}>
                  {channel.title.replace(' Mix', '').replace(' Spa', '')}
                </div>
                <div className={s.cardMood}>
                  {(channel.mood ?? '').split(' · ')[0]}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

    {/* ── NOISE / AMBIENT BLOCK ── */}
      <section className={s.noiseSection}>
        <div className={s.sectionHeader}>
          <div className={s.sectionLabel}>Ambient noise</div>
          {/* Используем sortedNoise для корректного счетчика */}
          <div className={s.sectionCount}>{sortedNoise.length} options</div>
        </div>

        <div className={s.noiseCarousel}>
          {/* 1. Теперь итерируемся по sortedNoise */}
          {sortedNoise.map((noise) => {
            const isActive = activeNoiseId === noise.id;

            return (
              <div
                key={noise.id}
                className={`${s.chCard} ${s.noiseCard} ${isActive ? s.noiseCardActive : ''}`}
                onClick={() => handleNoiseToggle(noise)}
                role="button"
              >
                <div className={s.cardImg}>
                  {/* 2. Логика Fallback для картинок из public */}
                  <img
  src={noise.image || `/noise-${noise.slug}.jpg`}
  alt={noise.title}
  className={s.cardImgPhoto}
  style={{ 
    position: 'absolute', 
    height: '100%', 
    width: '100%', 
    inset: 0, 
    objectFit: 'cover' 
  }}
  onError={(e) => {
    (e.target as HTMLImageElement).style.opacity = '0';
  }}
/>
                  
                  <div className={s.cardImgOverlay} />
                  <div className={`${s.playingIndicator} ${isActive ? s.playingIndicatorVisible : ''}`}>
                    <svg width="8" height="8" viewBox="0 0 8 8">
                      <rect x="0"   y="0" width="2.5" height="8" rx="0.5" fill="rgba(155,185,215,0.8)"/>
                      <rect x="5.5" y="0" width="2.5" height="8" rx="0.5" fill="rgba(155,185,215,0.8)"/>
                    </svg>
                  </div>
                </div>

                <div className={s.cardBody}>
                  <div className={s.cardTitle}>{noise.title}</div>
                  <div className={s.cardMood}>Ambient noise</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className={s.subBlock}>
        <div>
          <div className={s.subStatusLabel}>
            {subscriptionWarn ? 'Subscription expires soon' : 'Subscription active'}
          </div>
          <div className={s.subDate}>{subscriptionDate}</div>
        </div>
        <button className={s.subCta}>Renew</button>
      </div>
    </div>
  );
}


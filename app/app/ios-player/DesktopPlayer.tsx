'use client';
// ─────────────────────────────────────────────
// DesktopPlayer.tsx
// ─────────────────────────────────────────────

import Image from 'next/image';
import { useMemo, useState, useEffect } from 'react';
import { soundEngine } from '@/app/lib/soundEngine';
import { 
  Channel, 
  AmbientChannel, // Используем актуальный тип
  PromoCard, 
  TenantSlug 
} from './channels';
import { useWaveCanvas } from './useWaveCanvas';
import s from './player.module.css';

interface DesktopPlayerProps {
  tenantSlug?:       TenantSlug;
  salonName?:        string;
  subscriptionDate?: string;
  subscriptionWarn?: boolean;
  dailyMessage?:    string;
  channels:          Channel[];
  noiseChannels:     AmbientChannel[]; // Обновлено здесь
  promoCards?:       PromoCard[];
}

export default function DesktopPlayer({
  tenantSlug       = 'spaquatoria',
  salonName        = 'Spaquatoria',
  subscriptionDate = '',
  subscriptionWarn = false,
  dailyMessage    = '',
  channels         = [],
  noiseChannels    = [], // Приходит пустой массив по умолчанию
  promoCards       = [],
}: DesktopPlayerProps) {
  
// 2. Вставляем инициализацию сразу после объявления стейтов
  useEffect(() => {
    soundEngine.initWatcher();
    
    const saved = localStorage.getItem('last_active_channel');
    if (saved) {
      try {
        const { id, url } = JSON.parse(saved);
        if (id && url) {
          soundEngine.playChannel(id, url);
          setPlaying(true);
          setActiveChannelId(id);
        }
      } catch (e) {
        console.error('Failed to restore channel', e);
      } finally {
        localStorage.removeItem('last_active_channel');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Пустой массив важен, чтобы не зациклить watcher

  // Сортируем шумы из базы
  const sortedNoise = useMemo(
    () => [...noiseChannels].sort((a, b) => a.order - b.order),
    [noiseChannels]
  );

  const showDailyMessage = Boolean(dailyMessage && dailyMessage.trim().length > 0);

  const [playing,         setPlaying]         = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string>(channels[0]?.id ?? '');
  const [showHint,        setShowHint]        = useState(false);
  const [activeNoiseId,   setActiveNoiseId]   = useState<string | null>(null);
  const [noiseVolume,     setNoiseVolume]     = useState(0.4);

  const activeChannel = useMemo(() => 
    channels.find(c => c.id === activeChannelId) ?? channels[0],
    [channels, activeChannelId]
  );

  const canvasRef = useWaveCanvas(playing);

// Вспомогательная функция для плавной анимации громкости шума
const animateNoiseVolume = (target: number, duration: number = 1000) => {
  const start = noiseVolume;
  const startTime = performance.now();

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Вычисляем промежуточное значение
    const current = start + (target - start) * progress;
    
    // Обновляем стейт (ползунок поедет визуально)
    setNoiseVolume(current);
    // Обновляем звук в движке
    soundEngine.setNoiseVolume(current);

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };

  requestAnimationFrame(step);
};

  const handleTogglePlay = () => {
    if (!activeChannel) return;

    if (playing) {
      soundEngine.stopChannel();
      setPlaying(false);
      setShowHint(false);
      return;
    }

    try {
      soundEngine.playChannel(activeChannel.id, activeChannel.streamUrl);
      setPlaying(true);
      setShowHint(false);
    } catch (err) {
      console.warn('soundEngine.playChannel failed', err);
      setShowHint(true);
    }
  };

  const handleSelectChannel = (channel: Channel) => {
    setActiveChannelId(channel.id);
    try {
      soundEngine.playChannel(channel.id, channel.streamUrl);
      setPlaying(true);
      setShowHint(false);
    } catch (err) {
      console.warn('soundEngine.playChannel failed on switch', err);
      setShowHint(true);
    }
  };

  const handleNoiseToggle = (noise: AmbientChannel) => {
    // 1. ВЫКЛЮЧЕНИЕ
    if (activeNoiseId === noise.id) {
      // Просто уводим фейдер в ноль и НЕ возвращаем его обратно
      animateNoiseVolume(0, 800); 

      // Ждем завершения анимации, чтобы полностью убить поток
      setTimeout(() => {
        soundEngine.stopNoise();
        setActiveNoiseId(null);
        // Теперь ползунок останется в 0 визуально — это честно.
      }, 850);
      return;
    }

    // 2. ВКЛЮЧЕНИЕ
    setActiveNoiseId(noise.id);
    
    // Сначала убеждаемся, что мы в полном нуле
    setNoiseVolume(0);
    soundEngine.setNoise(noise.id, noise.streamUrl);
    soundEngine.setNoiseVolume(0);

    // Плавно выводим на "рабочую громкость" (например, 0.4 или 0.5)
    // Можно использовать MASTER_NOISE_VOL из soundEngine или просто константу
    setTimeout(() => {
      animateNoiseVolume(0.4, 1000); 
    }, 50);
  };

  const handleNoiseVolumeChange = (valuePercent: number) => {
    const next = valuePercent / 100;
    setNoiseVolume(next);
    soundEngine.setNoiseVolume(next);
  };

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); }
    catch (e) { console.warn('Logout failed', e); }
    finally { window.location.href = '/login'; }
  };

  return (
    <div className={s.desktopShell}>
      {/* ── HEADER ── */}
      <header className={s.desktopHeader}>
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

      <main className={s.desktopMain}>
        {/* ── PLAYER ZONE ── */}
        <section className={s.playerZone} style={{ alignItems: 'center' }}>
          <div className={s.nowPlayingLabel}>Now playing</div>
          <div className={s.channelName}>{activeChannel?.title}</div>
          <div className={s.channelMood}>{activeChannel?.mood}</div>

          <div
            className={`${s.yyWrap} ${s.yyWrapDesktop} ${playing ? s.yyWrapPlaying : ''}`}
            onClick={handleTogglePlay}
            role="button"
          >
            <div className={s.ambient} />
            <div className={`${s.halo} ${s.h1}`} />
            <div className={`${s.halo} ${s.h2}`} />
            <div className={`${s.halo} ${s.h3}`} />
            <Image
              src="/yin-yang.png"
              alt="Play / Pause"
              width={240}
              height={240}
              className={`${s.yyImage} ${s.yyImageDesktop} ${playing ? s.yyImagePlaying : ''}`}
              priority
              draggable={false}
            />
          </div>

          <div className={`${s.iosHint} ${showHint ? s.iosHintVisible : ''}`}>
            Click Play in the system audio bar ↓
          </div>

          <div className={s.waveZone} style={{ maxWidth: 360, marginTop: 28 }}>
            <canvas ref={canvasRef} className={`${s.waveCanvas} ${playing ? s.waveCanvasVisible : ''}`} />
          </div>

          <div className={s.statusLine} style={{ marginTop: 14 }}>
            <div className={`${s.sdot} ${playing ? s.sdotPlaying : ''}`} />
            <div className={`${s.stxt} ${playing ? s.stxtPlaying : ''}`}>
              {playing ? 'Streaming · Sound Spa' : 'Click to play'}
            </div>
          </div>
        </section>

        {/* ── CHANNELS ── */}
        <section className={s.desktopSection} style={{ marginTop: 32 }}>
          <div className={s.sectionHeader} style={{ padding: '0 0 12px' }}>
            <div className={s.sectionLabel}>Channels &amp; Updates</div>
            <div className={s.sectionCount}>{channels.length} channels</div>
          </div>
          <div className={s.desktopCardsRow}>
            {channels.map(channel => (
              <div
                key={channel.id}
                className={`${s.chCard} ${s.chCardDesktop} ${activeChannelId === channel.id ? s.chCardActive : ''}`}
                onClick={() => handleSelectChannel(channel)}
                role="button"
              >
                <div className={s.cardImg} style={{ height: 120 }}>
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
                  {channel.isNew && <div className={s.cardBadge}>New</div>}
                  <div className={`${s.playingIndicator} ${activeChannelId === channel.id && playing ? s.playingIndicatorVisible : ''}`}>
                    <svg width="8" height="8" viewBox="0 0 8 8">
                      <rect x="0"   y="0" width="2.5" height="8" rx="0.5" fill="rgba(155,185,215,0.8)"/>
                      <rect x="5.5" y="0" width="2.5" height="8" rx="0.5" fill="rgba(155,185,215,0.8)"/>
                    </svg>
                  </div>
                </div>
                <div className={s.cardBody}>
                  <div className={s.cardTitle}>{channel.title.replace(' Mix', '').replace(' Spa', '')}</div>
                  <div className={s.cardMood}>{(channel.mood ?? '').split(' · ')[0]}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── NOISE ── */}
        <section className={s.desktopSection} style={{ marginTop: 32, marginBottom: 32 }}>
          <div className={s.sectionHeader} style={{ padding: '0 0 12px' }}>
            <div className={s.sectionLabel}>Ambient noise</div>
            <div className={s.sectionCount}>{sortedNoise.length} options</div>
          </div>

          <div className={s.noiseSliderWrap} style={{ padding: '0 0 16px' }}>
            <div className={s.noiseSliderHeader}>
              <div className={s.noiseLabel}>Noise level</div>
              <div className={s.noiseValue}>{Math.round(noiseVolume * 100)}%</div>
            </div>
            <div className={s.sliderTrackWrap}>
              <div className={s.sliderTrackBg} />
              <div className={s.sliderTrackFill} style={{ width: `${Math.round(noiseVolume * 100)}%` }} />
              <div className={s.sliderThumb} style={{ left: `${Math.round(noiseVolume * 100)}%` }}>
                <div className={s.thumbDot} />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(noiseVolume * 100)}
                onChange={(e) => handleNoiseVolumeChange(Number(e.currentTarget.value))}
                className={s.noiseRange}
              />
            </div>
          </div>

          <div className={s.desktopNoiseRow} style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto' }}>
            {sortedNoise.map((noise) => {
  const isActive = activeNoiseId === noise.id;

  return (
    <div
      key={noise.id}
      className={`${s.chCard} ${s.noiseCardDesktop} ${isActive ? s.noiseCardActive : ''}`}
      style={{ flexShrink: 0 }} // ВОТ ЭТО ЗАПРЕТИТ ИМ ПАДАТЬ ВНИЗ
      onClick={() => handleNoiseToggle(noise)}
      role="button"
    >
                  <div className={s.cardImg} style={{ height: 120 }}>
                    <img
  src={noise.image || `/noise-${noise.slug}.jpg`}
  alt={noise.title}
  className={s.cardImgPhoto}
  /* Чтобы картинка вела себя так же, как при 'fill', добавим инлайн-стили */
  style={{ 
    position: 'absolute', 
    height: '100%', 
    width: '100%', 
    left: 0, 
    top: 0, 
    right: 0, 
    bottom: 0, 
    objectFit: 'cover' 
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
      </main>

      <footer className={s.desktopFooter}>
        <div>
          <div className={s.subStatusLabel}>
            {subscriptionWarn ? 'Subscription expires soon' : 'Subscription active'}
          </div>
          <div className={s.subDate}>{subscriptionDate}</div>
        </div>
        <button className={s.subCta}>Renew</button>
      </footer>
    </div>
  );
}
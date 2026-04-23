'use client';

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

interface IosPlayerProps {
  tenantSlug?:       TenantSlug;
  salonName?:        string;
  subscriptionDate?: string;
  subscriptionWarn?: boolean;
  dailyMessage?:    string;
  channels:          Channel[];
  noiseChannels:     AmbientChannel[];
  promoCards?:       PromoCard[];
}

export default function IosPlayer({
  tenantSlug,
  salonName        = 'Spaquatoria',
  subscriptionDate = 'Until 12 April 2026',
  subscriptionWarn = false,
  channels         = [],
  noiseChannels    = [],
}: IosPlayerProps) {
  
  // ── 1. ВСЕ СОСТОЯНИЯ (Hooks) В НАЧАЛЕ ──
  const [playing,         setPlaying]         = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string>(channels[0]?.id ?? '');
  const [activeNoiseId,   setActiveNoiseId]   = useState<string | null>(null);
  const [showIosHint,     setShowIosHint]     = useState(false);

  // ── 2. ВЫЧИСЛЕНИЯ ──
  const activeChannel = useMemo(() => 
    channels.find(c => c.id === activeChannelId) ?? channels[0],
    [channels, activeChannelId]
  );

  const sortedNoise = useMemo(
    () => [...noiseChannels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [noiseChannels]
  );

  const canvasRef = useWaveCanvas(playing);

  // ── 3. ЭФФЕКТЫ (После инициализации всех стейтов) ──
  useEffect(() => {
    // Инициализация мониторинга
    if (tenantSlug) {
      soundEngine.initWatcher(tenantSlug);
    }
    
    // Восстановление сохраненного канала
    try {
      const saved = localStorage.getItem('last_active_channel');
      if (saved) {
        const { id } = JSON.parse(saved);
        // Проверяем, существует ли такой канал в текущем списке
        if (id && channels.some(c => c.id === id)) {
          setActiveChannelId(id);
        }
      }
    } catch (e) {
      console.error("Error restoring session", e);
    }

    // Cleanup: Очистка при размонтировании компонента
    return () => {
      soundEngine.stopChannel();
      soundEngine.stopNoise();
      soundEngine.dispose();
    };
  }, [tenantSlug, channels]); 

  // ── 4. ОБРАБОТЧИКИ ──
  const handleTogglePlay = () => {
    if (!activeChannel) return;

    if (playing) {
      soundEngine.stopChannel();
      setPlaying(false);
    } else {
      try {
        soundEngine.playChannel(activeChannel.id, activeChannel.streamUrl);
        setPlaying(true);
        setShowIosHint(false);
      } catch (err) {
        // Если iOS заблокировал автоплей
        setShowIosHint(true);
      }
    }
  };

  const handleSelectChannel = (channel: Channel) => {
    if (activeChannelId === channel.id && playing) return;

    setActiveChannelId(channel.id);
    soundEngine.playChannel(channel.id, channel.streamUrl);
    setPlaying(true);
    setShowIosHint(false);
    localStorage.setItem('last_active_channel', JSON.stringify({ id: channel.id, url: channel.streamUrl }));
  };

  const handleNoiseToggle = (noise: AmbientChannel) => {
    if (activeNoiseId === noise.id) {
      soundEngine.stopNoise();
      setActiveNoiseId(null);
    } else {
      setActiveNoiseId(noise.id);
      soundEngine.setNoise(noise.id, noise.streamUrl);
      soundEngine.setNoiseVolume(0.5); 
    }
  };

  const handleLogout = async () => {
    soundEngine.stopChannel();
    soundEngine.stopNoise();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout failed', e);
    } finally {
      window.location.href = '/login';
    }
  };

  // ── 5. ОТРЕНДЕРЕННЫЙ JSX (Без изменений) ──
  return (
    <div className={s.phone}>
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

      <section className={s.playerZone}>
        <div className={s.nowPlayingLabel}>Now playing</div>
        <div className={s.channelName}>{activeChannel?.title}</div>
        <div className={s.channelMood}>{activeChannel?.mood}</div>

        <div
          className={`${s.yyWrap} ${playing ? s.yyWrapPlaying : ''}`}
          onClick={handleTogglePlay}
          role="button"
        >
          <div className={s.ambient} />
          <div className={`${s.halo} ${s.h1}`} />
          <div className={`${s.halo} ${s.h2}`} />
          <div className={`${s.halo} ${s.h3}`} />
          <Image
            src="/yin-yang.png"
            alt="Play"
            width={170}
            height={170}
            className={`${s.yyImage} ${playing ? s.yyImagePlaying : ''}`}
            priority
          />
        </div>

        <div className={`${s.iosHint} ${showIosHint ? s.iosHintVisible : ''}`}>
          Tap Play in the system audio bar ↓
        </div>

        <div className={s.waveZone}>
          <canvas ref={canvasRef} className={`${s.waveCanvas} ${playing ? s.waveCanvasVisible : ''}`} />
        </div>

        <div className={s.statusLine}>
          <div className={`${s.sdot} ${playing ? s.sdotPlaying : ''}`} />
          <div className={`${s.stxt} ${playing ? s.stxtPlaying : ''}`}>
            {playing ? 'Streaming · Sound Spa' : 'Tap to play'}
          </div>
        </div>
      </section>

      <section className={s.carouselSection}>
        <div className={s.sectionHeader}>
          <div className={s.sectionLabel}>Channels</div>
          <div className={s.sectionCount}>{channels.length} options</div>
        </div>

        <div className={s.carousel}>
          {channels.map((channel: Channel) => (
            <div
              key={channel.id}
              className={`${s.chCard} ${activeChannelId === channel.id ? s.chCardActive : ''}`}
              onClick={() => handleSelectChannel(channel)}
            >
              <div className={s.cardImg}>
                <img src={channel.image || '/channel-default.jpg'} alt="" className={s.cardImgPhoto} style={{ position: 'absolute', height: '100%', width: '100%', objectFit: 'cover' }} />
                <div className={s.cardImgOverlay} />
                <div className={`${s.playingIndicator} ${activeChannelId === channel.id && playing ? s.playingIndicatorVisible : ''}`}>
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <rect x="0" y="0" width="2.5" height="8" rx="0.5" fill="rgba(155,185,215,0.8)"/>
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

      <section className={s.noiseSection} style={{ marginBottom: 40 }}>
        <div className={s.sectionHeader}>
          <div className={s.sectionLabel}>Ambient noise (50%)</div>
          <div className={s.sectionCount}>{sortedNoise.length} options</div>
        </div>

        <div className={s.noiseCarousel}>
          {sortedNoise.map((noise: AmbientChannel) => (
            <div
              key={noise.id}
              className={`${s.chCard} ${s.noiseCard} ${activeNoiseId === noise.id ? s.noiseCardActive : ''}`}
              onClick={() => handleNoiseToggle(noise)}
            >
              <div className={s.cardImg}>
                <img src={noise.image || `/noise-${noise.slug}.jpg`} alt="" className={s.cardImgPhoto} style={{ position: 'absolute', height: '100%', width: '100%', objectFit: 'cover' }} />
                <div className={s.cardImgOverlay} />
                <div className={`${s.playingIndicator} ${activeNoiseId === noise.id ? s.playingIndicatorVisible : ''}`}>
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <rect x="0" y="0" width="2.5" height="8" rx="0.5" fill="rgba(155,185,215,0.8)"/>
                    <rect x="5.5" y="0" width="2.5" height="8" rx="0.5" fill="rgba(155,185,215,0.8)"/>
                  </svg>
                </div>
              </div>
              <div className={s.cardBody}>
                <div className={s.cardTitle}>{noise.title}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className={s.subBlock}>
        <div>
          <div className={s.subStatusLabel}>{subscriptionWarn ? 'Expires soon' : 'Subscription active'}</div>
          <div className={s.subDate}>{subscriptionDate}</div>
        </div>
        <button className={s.subCta}>Renew</button>
      </div>
    </div>
  );
}
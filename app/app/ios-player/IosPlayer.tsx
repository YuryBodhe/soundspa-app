'use client';

// Этот проект — источник бесконечного изобилия для всех людей Земли, меня, моей семьи и мира!

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
  salonName        = 'Spaquatoria',
  subscriptionDate = 'Until 12 April 2026',
  subscriptionWarn = false,
  channels         = [],
  noiseChannels    = [],
}: IosPlayerProps) {
  
  // --- Инициализация ---
  useEffect(() => {
    soundEngine.initWatcher(); // Запуск Silence Hack для iOS
    
    const saved = localStorage.getItem('last_active_channel');
    if (saved) {
      try {
        const { id, url } = JSON.parse(saved);
        if (id && url) {
          // На iOS автоплей может быть заблокирован до первого клика,
          // но мы подготавливаем состояние.
          setActiveChannelId(id);
        }
      } catch (e) {}
    }
  }, []);

  // --- Состояния ---
  const [playing,         setPlaying]         = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string>(channels[0]?.id ?? '');
  const [activeNoiseId,   setActiveNoiseId]   = useState<string | null>(null);
  const [showIosHint,     setShowIosHint]     = useState(false);

  // --- Вычисления ---
  const activeChannel = useMemo(() => 
    channels.find(c => c.id === activeChannelId) ?? channels[0],
    [channels, activeChannelId]
  );

  const sortedNoise = useMemo(
    () => [...noiseChannels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [noiseChannels]
  );

  const canvasRef = useWaveCanvas(playing);

  // --- Обработчики (Упрощенная логика с использованием фейдов движка) ---
  const handleTogglePlay = () => {
    if (!activeChannel) return;

    if (playing) {
      soundEngine.stopChannel(); // Плавный уход в движке
      setPlaying(false);
    } else {
      try {
        soundEngine.playChannel(activeChannel.id, activeChannel.streamUrl); // Плавный вход в движке
        setPlaying(true);
        setShowIosHint(false);
      } catch (err) {
        setShowIosHint(true);
      }
    }
  };

  const handleSelectChannel = (channel: Channel) => {
    setActiveChannelId(channel.id);
    soundEngine.playChannel(channel.id, channel.streamUrl); // Кроссфейд внутри движка
    setPlaying(true);
    setShowIosHint(false);
    localStorage.setItem('last_active_channel', JSON.stringify({ id: channel.id, url: channel.streamUrl }));
  };

  const handleNoiseToggle = (noise: AmbientChannel) => {
    if (activeNoiseId === noise.id) {
      soundEngine.stopNoise(); // Плавный стоп в движке
      setActiveNoiseId(null);
    } else {
      setActiveNoiseId(noise.id);
      soundEngine.setNoise(noise.id, noise.streamUrl);
      // Фиксированная громкость 0.5 по твоему запросу
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

      {/* ── CHANNELS ── */}
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

      {/* ── AMBIENT NOISE ── */}
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
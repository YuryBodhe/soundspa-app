'use client';

import Image from 'next/image';
import { useMemo, useState, useEffect } from 'react';
import { soundEngine } from '@/app/lib/soundEngine';
import { 
  Channel, 
  AmbientChannel, 
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
  noiseChannels:     AmbientChannel[];
  promoCards?:       PromoCard[];
}

export default function DesktopPlayer({
  salonName        = 'Spaquatoria',
  subscriptionDate = '',
  subscriptionWarn = false,
  channels         = [],
  noiseChannels    = [],
}: DesktopPlayerProps) {
  
  const [playing,         setPlaying]         = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string>(channels[0]?.id ?? '');
  const [showHint,        setShowHint]        = useState(false);
  const [activeNoiseId,   setActiveNoiseId]   = useState<string | null>(null);
  const [noiseVolume,     setNoiseVolume]     = useState(0.4);

  // Инициализация
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
  }, []);

  const sortedNoise = useMemo(
    () => [...noiseChannels].sort((a, b) => a.order - b.order),
    [noiseChannels]
  );

  const activeChannel = useMemo(() => 
    channels.find(c => c.id === activeChannelId) ?? channels[0],
    [channels, activeChannelId]
  );

  const canvasRef = useWaveCanvas(playing);

  // --- ОБРАБОТЧИКИ (УПРОЩЕННЫЕ) ---

  const handleTogglePlay = () => {
    if (!activeChannel) return;

    if (playing) {
      soundEngine.stopChannel();
      setPlaying(false);
      setShowHint(false);
    } else {
      try {
        soundEngine.playChannel(activeChannel.id, activeChannel.streamUrl);
        setPlaying(true);
        setShowHint(false);
      } catch (err) {
        setShowHint(true);
      }
    }
  };

  const handleSelectChannel = (channel: Channel) => {
    setActiveChannelId(channel.id);
    soundEngine.playChannel(channel.id, channel.streamUrl);
    setPlaying(true);
    setShowHint(false);
  };

  const handleNoiseToggle = (noise: AmbientChannel) => {
    if (activeNoiseId === noise.id) {
      // Мгновенное выключение без анимации
      soundEngine.stopNoise();
      setActiveNoiseId(null);
    } else {
      // Мгновенное включение
      setActiveNoiseId(noise.id);
      soundEngine.setNoise(noise.id, noise.streamUrl);
      // Устанавливаем громкость из текущего стейта ползунка
      soundEngine.setNoiseVolume(noiseVolume);
    }
  };

  const handleNoiseVolumeChange = (valuePercent: number) => {
    const next = valuePercent / 100;
    setNoiseVolume(next);
    soundEngine.setNoiseVolume(next);
  };

  const handleLogout = async () => {
    soundEngine.stopChannel();
    soundEngine.stopNoise();
    try { await fetch('/api/auth/logout', { method: 'POST' }); }
    finally { window.location.href = '/login'; }
  };

  // --- ВЕРСТКА БЕЗ ИЗМЕНЕНИЙ ---
  return (
    <div className={s.desktopShell}>
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
        <section className={s.playerZone}>
          <div className={s.nowPlayingLabel}>Now playing</div>
          <div className={s.channelName}>{activeChannel?.title}</div>
          <div className={s.channelMood}>{activeChannel?.mood}</div>

          <div
            className={`${s.yyWrap} ${s.yyWrapDesktop} ${playing ? s.yyWrapPlaying : ''}`}
            onClick={handleTogglePlay}
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
            />
          </div>

          <div className={`${s.iosHint} ${showHint ? s.iosHintVisible : ''}`}>
            Click Play in the system audio bar ↓
          </div>

          <div className={s.waveZone}>
            <canvas ref={canvasRef} className={`${s.waveCanvas} ${playing ? s.waveCanvasVisible : ''}`} />
          </div>

          <div className={s.statusLine}>
            <div className={`${s.sdot} ${playing ? s.sdotPlaying : ''}`} />
            <div className={`${s.stxt} ${playing ? s.stxtPlaying : ''}`}>
              {playing ? 'Streaming · Sound Spa' : 'Click to play'}
            </div>
          </div>
        </section>

        {/* Channels */}
        <section className={s.desktopSection}>
          <div className={s.sectionHeader}>
            <div className={s.sectionLabel}>Channels</div>
            <div className={s.sectionCount}>{channels.length} options</div>
          </div>
          <div className={s.desktopCardsRow}>
            {channels.map(channel => (
              <div
                key={channel.id}
                className={`${s.chCard} ${activeChannelId === channel.id ? s.chCardActive : ''}`}
                onClick={() => handleSelectChannel(channel)}
              >
                <div className={s.cardImg}>
                  <img src={channel.image || '/channel-default.jpg'} alt={channel.title} className={s.cardImgPhoto} />
                  <div className={s.cardImgOverlay} />
                  <div className={`${s.playingIndicator} ${activeChannelId === channel.id && playing ? s.playingIndicatorVisible : ''}`}>
                    <div className={s.bar} />
                  </div>
                </div>
                <div className={s.cardBody}>
                  <div className={s.cardTitle}>{channel.title}</div>
                  <div className={s.cardMood}>{channel.mood}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Ambient Noise */}
        <section className={s.desktopSection}>
          <div className={s.sectionHeader}>
            <div className={s.sectionLabel}>Ambient noise</div>
          </div>

          <div className={s.noiseSliderWrap}>
            <div className={s.noiseSliderHeader}>
              <div className={s.noiseLabel}>Noise level</div>
              <div className={s.noiseValue}>{Math.round(noiseVolume * 100)}%</div>
            </div>
            <div className={s.sliderTrackWrap}>
              <div className={s.sliderTrackBg} />
              <div className={s.sliderTrackFill} style={{ width: `${noiseVolume * 100}%` }} />
              <input
                type="range"
                min={0} max={100} value={noiseVolume * 100}
                onChange={(e) => handleNoiseVolumeChange(Number(e.target.value))}
                className={s.noiseRange}
              />
            </div>
          </div>

          <div className={s.desktopNoiseRow}>
            {sortedNoise.map((noise) => (
              <div
                key={noise.id}
                className={`${s.chCard} ${s.noiseCardDesktop} ${activeNoiseId === noise.id ? s.noiseCardActive : ''}`}
                onClick={() => handleNoiseToggle(noise)}
              >
                <div className={s.cardImg}>
                  <img src={noise.image || `/noise-${noise.slug}.jpg`} alt={noise.title} className={s.cardImgPhoto} />
                  <div className={s.cardImgOverlay} />
                </div>
                <div className={s.cardBody}>
                  <div className={s.cardTitle}>{noise.title}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className={s.desktopFooter}>
        <div>
          <div className={s.subStatusLabel}>Subscription active</div>
          <div className={s.subDate}>{subscriptionDate}</div>
        </div>
        <button className={s.subCta}>Renew</button>
      </footer>
    </div>
  );
}
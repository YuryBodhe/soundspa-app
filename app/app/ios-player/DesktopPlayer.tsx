'use client';

import Image from 'next/image';
import { useMemo, useState, useEffect } from 'react';
import { soundEngine } from '@/app/lib/soundEngine';
import { Channel, AmbientChannel, TenantSlug, PromoCard } from './channels';
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
}: any) {
  
// Генерируем уникальный ID сессии при загрузке компонента
  const [sessionId] = useState(() => `desktop_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`);

  const [playing,         setPlaying]         = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string>(channels[0]?.id ?? '');
  const [activeNoiseId,   setActiveNoiseId]   = useState<string | null>(null);
  const [noiseVolume,     setNoiseVolume]     = useState(0.4);

  const activeChannel = useMemo(() => 
    channels.find((c: any) => c.id === activeChannelId) ?? channels[0],
    [channels, activeChannelId]
  );

  const canvasRef = useWaveCanvas(playing);

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
      } catch (e) {}
    }
  }, []);

  const handleTogglePlay = () => {
    if (playing) {
      soundEngine.stopChannel();
      setPlaying(false);
    } else {
      soundEngine.playChannel(activeChannel.id, activeChannel.streamUrl);
      setPlaying(true);
    }
  };

  const handleSelectChannel = (channel: Channel) => {
    setActiveChannelId(channel.id);
    soundEngine.playChannel(channel.id, channel.streamUrl);
    setPlaying(true);
  };

  const handleNoiseToggle = (noise: AmbientChannel) => {
    if (activeNoiseId === noise.id) {
      soundEngine.stopNoise();
      setActiveNoiseId(null);
    } else {
      setActiveNoiseId(noise.id);
      soundEngine.setNoise(noise.id, noise.streamUrl);
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
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout failed', e);
    } finally {
      window.location.href = '/login';
    }
  };

  const sortedNoise = useMemo(
    () => [...noiseChannels].sort((a, b) => a.order - b.order),
    [noiseChannels]
  );

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
            />
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
            {channels.map((channel: Channel) => (
              <div
                key={channel.id}
                className={`${s.chCard} ${s.chCardDesktop} ${activeChannelId === channel.id ? s.chCardActive : ''}`}
                onClick={() => handleSelectChannel(channel)}
                role="button"
              >
                <div className={s.cardImg} style={{ height: 120 }}>
                  <img src={channel.image || '/channel-default.jpg'} alt={channel.title} className={s.cardImgPhoto} style={{ position: 'absolute', height: '100%', width: '100%', inset: 0, objectFit: 'cover' }} />
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

        {/* ── NOISE ── */}
        <section className={s.desktopSection} style={{ marginTop: 32, marginBottom: 32 }}>
          <div className={s.sectionHeader} style={{ padding: '0 0 12px' }}>
            <div className={s.sectionLabel}>Ambient noise</div>
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
                type="range" min={0} max={100} step={1}
                value={Math.round(noiseVolume * 100)}
                onChange={(e) => handleNoiseVolumeChange(Number(e.currentTarget.value))}
                className={s.noiseRange}
              />
            </div>
          </div>

          <div className={s.desktopNoiseRow} style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto' }}>
            {sortedNoise.map((noise: AmbientChannel) => (
              <div
                key={noise.id}
                className={`${s.chCard} ${s.noiseCardDesktop} ${activeNoiseId === noise.id ? s.noiseCardActive : ''}`}
                style={{ flexShrink: 0 }}
                onClick={() => handleNoiseToggle(noise)}
                role="button"
              >
                <div className={s.cardImg} style={{ height: 120 }}>
                  <img src={noise.image || `/noise-${noise.slug}.jpg`} alt={noise.title} className={s.cardImgPhoto} style={{ position: 'absolute', height: '100%', width: '100%', inset: 0, objectFit: 'cover' }} />
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
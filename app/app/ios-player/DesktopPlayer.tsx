'use client';
// ─────────────────────────────────────────────
// DesktopPlayer.tsx
// ─────────────────────────────────────────────

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { soundEngine } from '@/app/lib/soundEngine';
import { Channel, PromoCard, TenantSlug } from './channels';
import { NOISE_CHANNELS, NoiseChannelConfig } from './noiseConfig';
import { useWaveCanvas } from './useWaveCanvas';
import s from './player.module.css';

interface DesktopPlayerProps {
  tenantSlug?:       TenantSlug;
  salonName?:        string;
  subscriptionDate?: string;
  subscriptionWarn?: boolean;
  dailyMessage?:    string;
  channels:          Channel[];
  promoCards?:       PromoCard[];
}

export default function DesktopPlayer({
  tenantSlug       = 'spaquatoria',
  salonName        = 'Spaquatoria',
  subscriptionDate = '',
  subscriptionWarn = false,
  dailyMessage    = '',
  channels         = [],
  promoCards       = [],
}: DesktopPlayerProps) {
  const noiseChannels: NoiseChannelConfig[] = useMemo(
    () => [...NOISE_CHANNELS].sort((a, b) => a.order - b.order),
    []
  );

  const showDailyMessage = Boolean(dailyMessage && dailyMessage.trim().length > 0);

  const [playing,         setPlaying]         = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string>(channels[0]?.id ?? '');
  const [showHint,        setShowHint]        = useState(false);
  const [activeNoiseId,   setActiveNoiseId]   = useState<string | null>(null);
  const [noiseVolume,     setNoiseVolume]     = useState(0.4);

  const activeChannel = channels.find(c => c.id === activeChannelId) ?? channels[0];

  const canvasRef = useWaveCanvas(playing);

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

  const handleNoiseToggle = (noise: NoiseChannelConfig) => {
    if (activeNoiseId === noise.id) {
      soundEngine.stopNoise();
      setActiveNoiseId(null);
      return;
    }

    soundEngine.setNoise(noise.id, noise.src);
    soundEngine.setNoiseVolume(noiseVolume);
    setActiveNoiseId(noise.id);
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

  const tagClass: Record<string, string> = {
    promo: s.tagPromo, update: s.tagUpdate, tech: s.tagTech, offline: s.tagOffline,
  };

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
        <section className={s.playerZone} style={{ alignItems: 'center' }}>
          <div className={s.nowPlayingLabel}>Now playing</div>
          <div className={s.channelName}>{activeChannel?.title}</div>
          <div className={s.channelMood}>{activeChannel?.mood}</div>

          <div
            className={`${s.yyWrap} ${s.yyWrapDesktop} ${playing ? s.yyWrapPlaying : ''}`}
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
            <canvas
              ref={canvasRef}
              className={`${s.waveCanvas} ${playing ? s.waveCanvasVisible : ''}`}
            />
          </div>

          <div className={s.statusLine} style={{ marginTop: 14 }}>
            <div className={`${s.sdot} ${playing ? s.sdotPlaying : ''}`} />
            <div className={`${s.stxt} ${playing ? s.stxtPlaying : ''}`}>
              {playing ? 'Streaming · AzuraCast' : 'Click to play'}
            </div>
          </div>
        </section>

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
                aria-label={`Play ${channel.title}`}
              >
                <div className={s.cardImg} style={{ height: 120 }}>
                  {channel.image && (
                    <Image
                      src={channel.image}
                      alt={channel.title}
                      fill
                      className={s.cardImgPhoto}
                      sizes="180px"
                    />
                  )}
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

        <section className={s.desktopSection} style={{ marginTop: 32, marginBottom: 32 }}>
          <div className={s.sectionHeader} style={{ padding: '0 0 12px' }}>
            <div className={s.sectionLabel}>Ambient noise</div>
            <div className={s.sectionCount}>{noiseChannels.length} options</div>
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

          <div className={s.desktopNoiseRow}>
            {noiseChannels.map((noise) => {
              const isActive = activeNoiseId === noise.id;

              return (
                <div
                  key={noise.id}
                  className={`${s.chCard} ${s.noiseCard} ${s.noiseCardDesktop} ${isActive ? s.noiseCardActive : ''}`}
                  onClick={() => handleNoiseToggle(noise)}
                  role="button"
                  aria-label={`Toggle ${noise.title}`}
                >
                  <div className={s.cardImg} style={{ height: 120 }}>
                    {noise.image && (
                      <Image
                        src={noise.image}
                        alt={noise.title}
                        fill
                        className={s.cardImgPhoto}
                        sizes="180px"
                      />
                    )}
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

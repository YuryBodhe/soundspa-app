"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import s from "./v2.module.css";
import { useWaveCanvas } from "./useWaveCanvas";
import { AMBIENT_CHANNELS, MUSIC_CHANNELS, type V2AmbientChannel, type V2MusicChannel } from "./mockData";

function MusicCard({ channel, active, playing, onSelect }: { channel: V2MusicChannel; active: boolean; playing: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`${s.card} ${active ? s.musicCardActive : ""}`} onClick={onSelect} aria-pressed={active}>
      <span className={s.cardImage}>
        <img src={channel.image} alt="" />
        <span className={s.cardOverlay} />
        <span className={`${s.playingIndicator} ${active && playing ? s.playingIndicatorVisible : ""}`}><i /><i /><i /><i /></span>
      </span>
      <span className={s.cardBody}><span className={s.cardTitle}>{channel.title}</span><span className={s.cardMood}>{channel.mood}</span></span>
    </button>
  );
}

function AmbientCard({ channel, active, onSelect }: { channel: V2AmbientChannel; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`${s.card} ${s.ambientCard} ${active ? s.ambientCardActive : ""}`} onClick={onSelect} aria-pressed={active}>
      <span className={s.cardImage}>
        <img src={channel.image} alt="" />
        <span className={s.cardOverlay} />
        <span className={`${s.playingIndicator} ${active ? s.playingIndicatorVisible : ""}`}><i /><i /><i /><i /></span>
      </span>
      <span className={s.cardBody}><span className={s.cardTitle}>{channel.title}</span></span>
    </button>
  );
}

function WaveVisualization({ playing }: { playing: boolean }) {
  const canvasRef = useWaveCanvas(playing);
  return <div className={s.waveZone} aria-hidden="true"><canvas ref={canvasRef} className={`${s.waveCanvas} ${playing ? s.waveCanvasVisible : ""}`} /></div>;
}

export default function V2Player() {
  const [playing, setPlaying] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState(MUSIC_CHANNELS[0].id);
  const [activeAmbientId, setActiveAmbientId] = useState<string | null>(null);
  const [ambientVolume, setAmbientVolume] = useState(40);
  const activeChannel = useMemo(() => MUSIC_CHANNELS.find((channel) => channel.id === activeChannelId) ?? MUSIC_CHANNELS[0], [activeChannelId]);

  const selectMusic = (channel: V2MusicChannel) => {
    setActiveChannelId(channel.id);
    setPlaying(true);
  };

  const toggleAmbient = (channel: V2AmbientChannel) => {
    setActiveAmbientId((current) => current === channel.id ? null : channel.id);
  };

  return (
    <div className={s.shell} data-testid="v2-player">
      <header className={s.header}>
        <div><div className={s.brand}>Sound Spa 2</div><div className={s.platformTag}>Local prototype</div></div>
        <div className={s.badge}>Test mode</div>
      </header>

      <main className={s.main}>
        <section className={s.hero}>
          <div className={s.nowPlayingLabel}>Now selected</div>
          <h1 className={s.channelName}>{activeChannel.title}</h1>
          <div className={s.channelMood}>{activeChannel.mood}</div>
          <button type="button" className={`${s.yinYangButton} ${playing ? s.yinYangPlaying : ""}`} onClick={() => setPlaying((current) => !current)} aria-label={playing ? "Pause preview" : "Play preview"} aria-pressed={playing}>
            <span className={s.ambientGlow} />
            <span className={`${s.halo} ${s.haloOne}`} /><span className={`${s.halo} ${s.haloTwo}`} /><span className={`${s.halo} ${s.haloThree}`} />
            <Image src="/yin-yang.png" alt="Play / Pause" width={240} height={240} className={s.yinYangImage} priority />
          </button>
          <WaveVisualization playing={playing} />
          <div className={s.statusLine}><span className={`${s.statusDot} ${playing ? s.statusDotPlaying : ""}`} /><span className={playing ? s.statusPlaying : ""}>{playing ? "Preview active" : "Preview paused"}</span></div>
        </section>

        <section className={s.section}>
          <div className={s.sectionHeader}><div className={s.sectionLabel}>Music channels</div><div className={s.sectionCount}>{MUSIC_CHANNELS.length} channels</div></div>
          <div className={s.cardsRow} data-testid="music-row">
            {MUSIC_CHANNELS.map((channel) => <MusicCard key={channel.id} channel={channel} active={channel.id === activeChannelId} playing={playing} onSelect={() => selectMusic(channel)} />)}
          </div>
        </section>

        <section className={`${s.section} ${s.ambientSection}`}>
          <div className={s.sectionHeader}><div className={s.sectionLabel}>Ambient</div><div className={s.ambientValue}>{ambientVolume}%</div></div>
          <div className={s.sliderWrap}>
            <div className={s.sliderTrack} /><div className={s.sliderFill} style={{ width: `${ambientVolume}%` }} />
            <div className={s.sliderThumb} style={{ left: `${ambientVolume}%` }}><span /></div>
            <input type="range" min="0" max="100" step="1" value={ambientVolume} onChange={(event) => setAmbientVolume(Number(event.currentTarget.value))} className={s.sliderInput} aria-label="Ambient volume" />
          </div>
          <div className={s.cardsRow} data-testid="ambient-row">
            {AMBIENT_CHANNELS.map((channel) => <AmbientCard key={channel.id} channel={channel} active={channel.id === activeAmbientId} onSelect={() => toggleAmbient(channel)} />)}
          </div>
        </section>
      </main>

      <footer className={s.footer}><div><div className={s.footerLabel}>Prototype access</div><div className={s.footerText}>Local test · no account required</div></div></footer>
    </div>
  );
}

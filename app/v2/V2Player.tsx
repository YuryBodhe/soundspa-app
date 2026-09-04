"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmbientEngine, type AmbientEngineState } from "../lib/audio/ambientEngine";
import { Mp3Engine, type Mp3EngineState } from "../lib/audio/mp3Engine";
import { DIVNITSA_PLAYLIST, MUSIC_PLAYLISTS } from "./divnitsaPlaylist";
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
  const engineRef = useRef<Mp3Engine | null>(null);
  const engineChannelIdRef = useRef<string | null>(null);
  const engineUnsubscribeRef = useRef<(() => void) | null>(null);
  const ambientEngineRef = useRef<AmbientEngine | null>(null);
  const [playback, setPlayback] = useState<Mp3EngineState>({ status: "idle", currentTrackIndex: 0, preparedTrackIndex: null, sourceKind: null, currentTime: 0, error: null });
  const [ambientPlayback, setAmbientPlayback] = useState<AmbientEngineState>({ status: "idle", activeTrackId: null, sourceKind: null, volume: 0.4, currentTime: 0, error: null });
  const [activeChannelId, setActiveChannelId] = useState(MUSIC_CHANNELS[0].id);
  const activeChannel = useMemo(() => MUSIC_CHANNELS.find((channel) => channel.id === activeChannelId) ?? MUSIC_CHANNELS[0], [activeChannelId]);
  const playing = engineChannelIdRef.current === activeChannelId && playback.status === "playing";
  const ambientVolume = Math.round(ambientPlayback.volume * 100);

  const replaceMusicEngine = useCallback((channelId: string, playlist: ConstructorParameters<typeof Mp3Engine>[0]) => {
    engineUnsubscribeRef.current?.();
    engineUnsubscribeRef.current = null;
    engineRef.current?.dispose();
    const engine = new Mp3Engine(playlist);
    engineRef.current = engine;
    engineChannelIdRef.current = channelId;
    setPlayback(engine.getSnapshot());
    engineUnsubscribeRef.current = engine.subscribe(() => setPlayback(engine.getSnapshot()));
    return engine;
  }, []);

  useEffect(() => {
    replaceMusicEngine("divnitsa", DIVNITSA_PLAYLIST);
    return () => {
      engineUnsubscribeRef.current?.();
      engineUnsubscribeRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
      engineChannelIdRef.current = null;
    };
  }, [replaceMusicEngine]);

  useEffect(() => {
    const engine = new AmbientEngine();
    ambientEngineRef.current = engine;
    const unsubscribe = engine.subscribe(() => setAmbientPlayback(engine.getSnapshot()));
    return () => {
      unsubscribe();
      engine.dispose();
      if (ambientEngineRef.current === engine) ambientEngineRef.current = null;
    };
  }, []);

  const toggleMusicPlayback = () => {
    if (playback.status === "playing" || playback.status === "loading") engineRef.current?.pause();
    else void engineRef.current?.play();
  };

  const selectMusic = (channel: V2MusicChannel) => {
    const playlist = MUSIC_PLAYLISTS[channel.id];
    if (channel.id === activeChannelId) {
      if (playlist) toggleMusicPlayback();
      return;
    }
    const shouldContinuePlaying = playback.status === "playing" || playback.status === "loading";
    setActiveChannelId(channel.id);
    if (!playlist) {
      engineRef.current?.pause();
      return;
    }
    const engine = engineChannelIdRef.current === channel.id
      ? engineRef.current
      : replaceMusicEngine(channel.id, playlist);
    if (shouldContinuePlaying) void engine?.play();
  };

  const togglePlayback = () => {
    if (MUSIC_PLAYLISTS[activeChannelId] && engineChannelIdRef.current === activeChannelId) toggleMusicPlayback();
  };

  const playbackLabel = !MUSIC_PLAYLISTS[activeChannelId]
    ? "Planned channel"
    : playback.status === "loading"
      ? "Buffering"
      : playback.status === "error"
        ? "Playback error"
        : playing
          ? `Playing track ${playback.currentTrackIndex + 1}`
          : playback.status === "paused"
            ? "Preview paused"
            : "Ready to play";

  const toggleAmbient = (channel: V2AmbientChannel) => {
    void ambientEngineRef.current?.toggle({ id: channel.id, url: `/noise/${channel.id}.mp3` });
  };

  return (
    <div
      className={s.shell}
      data-testid="v2-player"
      data-playback-status={playback.status}
      data-source-kind={playback.sourceKind ?? "none"}
      data-track-index={playback.currentTrackIndex}
      data-prepared-track-index={playback.preparedTrackIndex ?? "none"}
      data-current-time={playback.currentTime}
      data-ambient-status={ambientPlayback.status}
      data-ambient-source-kind={ambientPlayback.sourceKind ?? "none"}
      data-ambient-track-id={ambientPlayback.activeTrackId ?? "none"}
      data-ambient-volume={ambientPlayback.volume}
      data-ambient-current-time={ambientPlayback.currentTime}
    >
      <header className={s.header}>
        <div><div className={s.brand}>Sound Spa 2</div><div className={s.platformTag}>Local prototype</div></div>
        <div className={s.badge}>Test mode</div>
      </header>

      <main className={s.main}>
        <section className={s.hero}>
          <div className={s.nowPlayingLabel}>Now selected</div>
          <h1 className={s.channelName}>{activeChannel.title}</h1>
          <div className={s.channelMood}>{activeChannel.mood}</div>
          <button type="button" className={`${s.yinYangButton} ${playing ? s.yinYangPlaying : ""}`} onClick={togglePlayback} aria-label={playing ? `Pause ${activeChannel.title}` : `Play ${activeChannel.title}`} aria-pressed={playing}>
            <span className={s.ambientGlow} />
            <span className={`${s.halo} ${s.haloOne}`} /><span className={`${s.halo} ${s.haloTwo}`} /><span className={`${s.halo} ${s.haloThree}`} />
            <Image src="/yin-yang.png" alt="Play / Pause" width={240} height={240} className={s.yinYangImage} priority />
          </button>
          <WaveVisualization playing={playing} />
          <div className={s.statusLine} title={playback.error ?? undefined}><span className={`${s.statusDot} ${playing ? s.statusDotPlaying : ""}`} /><span className={playing ? s.statusPlaying : ""}>{playbackLabel}</span></div>
        </section>

        <section className={s.section}>
          <div className={s.sectionHeader}><div className={s.sectionLabel}>Music channels</div><div className={s.sectionCount}>{MUSIC_CHANNELS.length} channels</div></div>
          <div className={s.cardsRow} data-testid="music-row">
            {MUSIC_CHANNELS.map((channel) => <MusicCard key={channel.id} channel={channel} active={channel.id === activeChannelId} playing={playing} onSelect={() => selectMusic(channel)} />)}
          </div>
        </section>

        <section className={`${s.section} ${s.ambientSection}`} title={ambientPlayback.error ?? undefined}>
          <div className={s.sectionHeader}><div className={s.sectionLabel}>Ambient</div><div className={s.ambientValue}>{ambientVolume}%</div></div>
          <div className={s.sliderWrap}>
            <div className={s.sliderTrack} /><div className={s.sliderFill} style={{ width: `${ambientVolume}%` }} />
            <div className={s.sliderThumb} style={{ left: `${ambientVolume}%` }}><span /></div>
            <input type="range" min="0" max="100" step="1" value={ambientVolume} onChange={(event) => ambientEngineRef.current?.setVolume(Number(event.currentTarget.value) / 100)} className={s.sliderInput} aria-label="Ambient volume" />
          </div>
          <div className={s.cardsRow} data-testid="ambient-row">
            {AMBIENT_CHANNELS.map((channel) => <AmbientCard key={channel.id} channel={channel} active={channel.id === ambientPlayback.activeTrackId} onSelect={() => toggleAmbient(channel)} />)}
          </div>
        </section>
      </main>

      <footer className={s.footer}><div><div className={s.footerLabel}>Prototype access</div><div className={s.footerText}>Local test · no account required</div></div></footer>
    </div>
  );
}

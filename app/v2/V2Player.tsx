"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmbientEngine, type AmbientEngineState } from "../lib/audio/ambientEngine";
import { Mp3Engine, type Mp3EngineState, type PlaybackMode } from "../lib/audio/mp3Engine";
import s from "./v2.module.css";
import { useWaveCanvas } from "./useWaveCanvas";
import type { PlayerChannel } from "./catalog";
import { MusicPlaybackIntent } from "./musicPlaybackIntent";
import { clearMusicDiagnostics, exportMusicDiagnostics, musicDiagnosticsEnabled, recordMusicDiagnostic } from "../lib/audio/musicDiagnostics";

function MusicDiagnosticPanel({ capture }: { capture: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [trace, setTrace] = useState("");
  const [result, setResult] = useState("");
  useEffect(() => { setEnabled(musicDiagnosticsEnabled()); }, []);
  if (!enabled) return null;
  const copy = async () => {
    capture();
    const text = exportMusicDiagnostics();
    setTrace(text);
    try { await navigator.clipboard.writeText(text); setResult("Copied. Send this trace to support."); }
    catch { setResult("Copy unavailable: select and copy the trace below."); }
  };
  return <details style={{ maxWidth: "100%", marginTop: 12, fontSize: 12 }}>
    <summary>Music diagnostics · staging only</summary>
    <button type="button" onClick={() => void copy()}>Copy music diagnostics</button>{" "}
    <button type="button" onClick={() => { clearMusicDiagnostics(); setTrace(""); setResult("Trace cleared; now reproduce the issue."); }}>Clear trace</button>
    <p role="status">{result || "Rolling in-memory trace. Copy before refresh or Stop/Play."}</p>
    {trace && <textarea readOnly aria-label="Music diagnostic trace" value={trace} onFocus={event => event.currentTarget.select()} style={{ boxSizing: "border-box", width: "100%", height: 150 }} />}
  </details>;
}

function MusicCard({ channel, active, playing, onSelect }: { channel: PlayerChannel; active: boolean; playing: boolean; onSelect: () => void }) {
  return (
    <button type="button" disabled={channel.playable === false} className={`${s.card} ${channel.playable === false ? s.cardLocked : ""} ${active ? s.musicCardActive : ""}`} onClick={onSelect} aria-pressed={active}>
      <span className={s.cardImage}>
        {channel.image && <img src={channel.image} alt="" />}
        <span className={s.cardOverlay} />
        <span className={`${s.playingIndicator} ${active && playing ? s.playingIndicatorVisible : ""}`}><i /><i /><i /><i /></span>
      </span>
      <span className={s.cardBody}><span className={s.cardTitle}>{channel.title}</span><span className={s.cardMood}>{channel.playable === false ? "Locked" : channel.mood}</span></span>
    </button>
  );
}

function AmbientCard({ channel, active, onSelect }: { channel: PlayerChannel; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" disabled={channel.playable === false} className={`${s.card} ${channel.playable === false ? s.cardLocked : ""} ${s.ambientCard} ${active ? s.ambientCardActive : ""}`} onClick={onSelect} aria-pressed={active}>
      <span className={s.cardImage}>
        {channel.image && <img src={channel.image} alt="" />}
        <span className={s.cardOverlay} />
        <span className={`${s.playingIndicator} ${active ? s.playingIndicatorVisible : ""}`}><i /><i /><i /><i /></span>
      </span>
      <span className={s.cardBody}><span className={s.cardTitle}>{channel.title}</span>{channel.playable === false && <span className={s.cardMood}>Locked</span>}</span>
    </button>
  );
}

function WaveVisualization({ playing }: { playing: boolean }) {
  const canvasRef = useWaveCanvas(playing);
  return <div className={s.waveZone} aria-hidden="true"><canvas ref={canvasRef} className={`${s.waveCanvas} ${playing ? s.waveCanvasVisible : ""}`} /></div>;
}

export default function V2Player({ catalog }: { catalog: PlayerChannel[] }) {
  const musicChannels = useMemo(() => catalog.filter((c) => c.kind === "music"), [catalog]);
  const playableMusicChannels = useMemo(() => musicChannels.filter((c) => c.playable !== false && c.tracks.length), [musicChannels]);
  const ambientChannels = useMemo(() => catalog.filter((c) => c.kind === "ambient"), [catalog]);
  const engineRef = useRef<Mp3Engine | null>(null);
  const engineChannelIdRef = useRef<string | null>(null);
  const engineUnsubscribeRef = useRef<(() => void) | null>(null);
  const musicWantsPlaybackRef = useRef(new MusicPlaybackIntent());
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("normal");
  const playbackModeRef = useRef<PlaybackMode>("normal");
  const ambientEngineRef = useRef<AmbientEngine | null>(null);
  const [playback, setPlayback] = useState<Mp3EngineState>({ status: "idle", currentTrackIndex: 0, preparedTrackIndex: null, sourceKind: null, currentTime: 0, error: null });
  const [ambientPlayback, setAmbientPlayback] = useState<AmbientEngineState>({ status: "idle", activeTrackId: null, sourceKind: null, volume: 0.4, currentTime: 0, error: null });
  const [activeChannelId, setActiveChannelId] = useState<string | null>(playableMusicChannels[0]?.id ?? null);
  const activeChannel = useMemo(() => musicChannels.find((channel) => channel.id === activeChannelId) ?? playableMusicChannels[0], [activeChannelId, musicChannels, playableMusicChannels]);
  const playing = engineChannelIdRef.current === activeChannelId && playback.status === "playing";
  const buffering = engineChannelIdRef.current === activeChannelId && playback.status === "loading";
  const ambientVolume = Math.round(ambientPlayback.volume * 100);

  const replaceMusicEngine = useCallback((channelId: string, playlist: ConstructorParameters<typeof Mp3Engine>[0]) => {
    engineUnsubscribeRef.current?.();
    engineUnsubscribeRef.current = null;
    engineRef.current?.dispose();
    const engine = new Mp3Engine(playlist,undefined,{channelId});
    engine.setPlaybackMode(playbackModeRef.current);
    engineRef.current = engine;
    engineChannelIdRef.current = channelId;
    setPlayback(engine.getSnapshot());
    engineUnsubscribeRef.current = engine.subscribe(() => setPlayback(engine.getSnapshot()));
    return engine;
  }, []);

  useEffect(() => {
    const initial = playableMusicChannels[0];
    if (initial.tracks.length) replaceMusicEngine(initial.id, initial.tracks);
    return () => {
      engineUnsubscribeRef.current?.();
      engineUnsubscribeRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
      engineChannelIdRef.current = null;
    };
  }, [replaceMusicEngine, playableMusicChannels]);

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
    recordMusicDiagnostic("ui-play-pause", { channelId: activeChannelId, status: playback.status, intent: musicWantsPlaybackRef.current });
    if (playback.status === "playing" || playback.status === "loading") {
      musicWantsPlaybackRef.current.stop();
      engineRef.current?.pause();
    } else {
      musicWantsPlaybackRef.current.start();
      void engineRef.current?.play();
    }
  };

  const selectMusic = (channel: PlayerChannel) => {
    recordMusicDiagnostic("ui-channel-select", { fromChannelId: activeChannelId, toChannelId: channel.id, title: channel.title, status: playback.status, intent: musicWantsPlaybackRef.current });
    const playlist = channel.tracks.length ? channel.tracks : null;
    if (channel.playable === false || !channel.tracks.length) return;
    if (channel.id === activeChannelId) {
      if (playlist) toggleMusicPlayback();
      return;
    }
    const shouldContinuePlaying = musicWantsPlaybackRef.current.wantsPlayback;
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
    if (activeChannel.tracks.length && engineChannelIdRef.current === activeChannelId) toggleMusicPlayback();
  };

  const nextMusicTrack = () => {
    recordMusicDiagnostic("ui-next-track", { channelId: activeChannelId, status: playback.status, intent: musicWantsPlaybackRef.current });
    engineRef.current?.next();
  };

  const previousMusicTrack = () => {
    recordMusicDiagnostic("ui-previous-track", { channelId: activeChannelId, status: playback.status, intent: musicWantsPlaybackRef.current });
    engineRef.current?.previous();
  };

  const cyclePlaybackMode = () => {
    const nextMode: PlaybackMode = playbackMode === "normal" ? "shuffle" : playbackMode === "shuffle" ? "repeat-one" : "normal";
    playbackModeRef.current = nextMode;
    setPlaybackMode(nextMode);
    engineRef.current?.setPlaybackMode(nextMode);
  };

  const playbackModeLabel = playbackMode === "repeat-one" ? "Repeat one" : playbackMode[0].toUpperCase() + playbackMode.slice(1);

  const currentTrackName = activeChannel.tracks[playback.currentTrackIndex]?.originalFilename?.replace(/\.mp3$/i, "") ?? null;
  const playbackLabel = !activeChannel.tracks.length
    ? "Planned channel"
    : playback.status === "loading"
      ? currentTrackName ? `Buffering: ${currentTrackName}` : "Buffering"
      : playback.status === "error"
        ? "Playback error"
        : playing
          ? currentTrackName ? `Playing: ${currentTrackName}` : "Playing track"
          : playback.status === "paused"
            ? currentTrackName ? `Paused: ${currentTrackName}` : "Preview paused"
            : currentTrackName ? `Ready: ${currentTrackName}` : "Ready to play";

  const toggleAmbient = (channel: PlayerChannel) => {
    if (channel.playable !== false && channel.tracks.length) void ambientEngineRef.current?.togglePlaylist(channel.id, channel.tracks);
  };

  if (!activeChannel) return <div className={s.shell}><main className={s.main}><section className={s.hero} role="alert"><h1 className={s.channelName}>No playable channels</h1><p>There are no playable music channels for this device.</p></section></main></div>;

  return (
    <div
      className={s.shell}
      data-testid="v2-player"
      data-catalog-source="v2-db"
      data-channel-slug={activeChannel.slug}
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
          <button type="button" className={`${s.yinYangButton} ${playing ? s.yinYangPlaying : ""} ${buffering ? s.yinYangBuffering : ""}`} onClick={togglePlayback} aria-label={buffering ? `Pause buffering ${activeChannel.title}` : playing ? `Pause ${activeChannel.title}` : `Play ${activeChannel.title}`} aria-pressed={playing} aria-busy={buffering}>
            <span className={s.ambientGlow} />
            <span className={`${s.halo} ${s.haloOne}`} /><span className={`${s.halo} ${s.haloTwo}`} /><span className={`${s.halo} ${s.haloThree}`} />
            <Image src="/yin-yang.png" alt="Play / Pause" width={240} height={240} className={s.yinYangImage} priority />
          </button>
          <WaveVisualization playing={playing} />
          <div className={s.statusLine} title={currentTrackName ?? playback.error ?? undefined}><span className={`${s.statusDot} ${playing ? s.statusDotPlaying : ""} ${buffering ? s.statusDotBuffering : ""}`} /><span className={`${playing ? s.statusPlaying : buffering ? s.statusBuffering : ""} ${s.statusText}`}>{playbackLabel}</span></div>
          <div className={s.trackControls} aria-label="Music track controls">
            <button type="button" className={s.trackButton} onClick={previousMusicTrack} disabled={activeChannel.tracks.length < 2} aria-label="Previous track"><span className={s.skipIcon} aria-hidden="true"><i /><i /></span><span>Previous</span></button>
            <button type="button" className={`${s.trackButton} ${s.modeButton}`} onClick={cyclePlaybackMode} aria-label={`Playback mode: ${playbackModeLabel}`} title={`Playback mode: ${playbackModeLabel}`}>
              {playbackModeLabel}
            </button>
            <button type="button" className={s.trackButton} onClick={nextMusicTrack} disabled={activeChannel.tracks.length < 2} aria-label="Next track"><span>Next</span><span className={`${s.skipIcon} ${s.skipIconNext}`} aria-hidden="true"><i /><i /></span></button>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionHeader}><div className={s.sectionLabel}>Music channels</div><div className={s.sectionCount}>{musicChannels.length} channels</div></div>
          <div className={s.cardsRow} data-testid="music-row">
            {musicChannels.map((channel) => <MusicCard key={channel.id} channel={channel} active={channel.id === activeChannelId} playing={playing} onSelect={() => selectMusic(channel)} />)}
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
            {ambientChannels.map((channel) => <AmbientCard key={channel.id} channel={channel} active={channel.tracks.some((track) => track.id === ambientPlayback.activeTrackId)} onSelect={() => toggleAmbient(channel)} />)}
          </div>
        </section>
      </main>

      <footer className={s.footer}><div><div className={s.footerLabel}>Prototype access</div><div className={s.footerText}>Local test · no account required</div><MusicDiagnosticPanel capture={() => engineRef.current?.captureDiagnostics()} /></div></footer>
    </div>
  );
}

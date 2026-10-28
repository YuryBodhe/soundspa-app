"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AmbientEngine, type AmbientEngineState } from "../lib/audio/ambientEngine";
import { Mp3Engine, type Mp3EngineState, type PlaybackMode } from "../lib/audio/mp3Engine";
import s from "./v2.module.css";
import { useWaveCanvas } from "./useWaveCanvas";
import { playerUpgradeAccountHref, type PlayerChannel } from "./catalog";
import { MusicPlaybackIntent } from "./musicPlaybackIntent";
import { clearMusicDiagnostics, exportMusicDiagnostics, musicDiagnosticsEnabled, recordMusicDiagnostic } from "../lib/audio/musicDiagnostics";
import { advanceFailureEpisode, observeLaneProgress, PlayerMonitoringSidecar, reportPlaybackFailure, type MonitoringConnectionState, type MonitoringSnapshot, type ProgressTracker } from "./playerMonitoring";
import { useI18n } from "../i18n/useI18n";
import { resolveChannelTitle } from "./channelTitle";
import { Tooltip } from "./Tooltip";
import { activatePlayerChannelCard } from "@/lib/v2/playerChannelInteraction";
import { accountSectionHref } from "@/app/account/accountNavigation";
import { canStartPlayerAudio, DevicePlayerOwnership, type PlayerOwnershipState } from "./playerOwnership";
import { playerStatusMessageKey } from "./playerStatusMessage";

function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  return <label className={s.languageSelector} title={t("selectLanguage")}><span className={s.srOnly}>{t("language")}</span><select value={locale} onChange={(event) => setLocale(event.target.value as typeof locale)} aria-label={t("selectLanguage")}><option value="en">EN</option><option value="ru">RU</option><option value="vi">VI</option><option value="th">TH</option></select></label>;
}

function PlayerManagementMenu() {
  const { t } = useI18n();
  return <details className={s.managementMenu}>
    <summary>{t("playerManagement")}</summary>
    <nav className={s.managementMenuPanel} aria-label={t("playerManagement")}>
      <a href={accountSectionHref("salons")} target="_blank" rel="noopener noreferrer">{t("playerManagementSalons")}</a>
      <a href={accountSectionHref("devices")} target="_blank" rel="noopener noreferrer">{t("playerManagementDevices")}</a>
      <a href={accountSectionHref("subscriptions")} target="_blank" rel="noopener noreferrer">{t("playerManagementSubscription")}</a>
    </nav>
  </details>;
}

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

function MusicCard({ channel, active, playing, onSelect, onLocked, standby }: { channel: PlayerChannel; active: boolean; playing: boolean; onSelect: () => void; onLocked: (trigger: HTMLButtonElement) => void; standby: boolean }) {
  const { t, locale } = useI18n(); const title = resolveChannelTitle(channel.title, channel.localizedTitles, locale);
  const locked = channel.playable === false;
  const card = (
    <button type="button" disabled={!locked && standby} className={`${s.card} ${locked ? s.cardLocked : ""} ${active ? s.musicCardActive : ""}`} onClick={(event) => activatePlayerChannelCard(channel, onSelect, () => onLocked(event.currentTarget))} aria-label={locked ? `${title}. ${t("locked")}` : undefined} aria-haspopup={locked ? "dialog" : undefined} aria-pressed={locked ? undefined : active}>
      <span className={s.cardImage}>
        {channel.image && <img src={channel.image} alt="" />}
        <span className={s.cardOverlay} />
        <span className={`${s.playingIndicator} ${active && playing ? s.playingIndicatorVisible : ""}`}><i /><i /><i /><i /></span>
      </span>
      <span className={s.cardBody}><span className={s.cardTitle}>{title}</span><span className={s.cardMood}>{locked ? t("locked") : channel.mood}</span></span>
    </button>
  );
  return locked ? <Tooltip content={t("lockedChannelTooltip")}>{card}</Tooltip> : card;
}

function AmbientCard({ channel, active, onSelect, onLocked, standby }: { channel: PlayerChannel; active: boolean; onSelect: () => void; onLocked: (trigger: HTMLButtonElement) => void; standby: boolean }) {
  const { t, locale } = useI18n(); const title = resolveChannelTitle(channel.title, channel.localizedTitles, locale);
  const locked = channel.playable === false;
  const card = (
    <button type="button" disabled={!locked && standby && !active} className={`${s.card} ${locked ? s.cardLocked : ""} ${s.ambientCard} ${active ? s.ambientCardActive : ""}`} onClick={(event) => activatePlayerChannelCard(channel, onSelect, () => onLocked(event.currentTarget))} aria-label={locked ? `${title}. ${t("locked")}` : undefined} aria-haspopup={locked ? "dialog" : undefined} aria-pressed={locked ? undefined : active}>
      <span className={s.cardImage}>
        {channel.image && <img src={channel.image} alt="" />}
        <span className={s.cardOverlay} />
        <span className={`${s.playingIndicator} ${active ? s.playingIndicatorVisible : ""}`}><i /><i /><i /><i /></span>
      </span>
      <span className={s.cardBody}><span className={s.cardTitle}>{title}</span>{locked && <span className={s.cardMood}>{t("locked")}</span>}</span>
    </button>
  );
  return locked ? <Tooltip content={t("lockedChannelTooltip")}>{card}</Tooltip> : card;
}

function WaveVisualization({ playing }: { playing: boolean }) {
  const canvasRef = useWaveCanvas(playing);
  return <div className={s.waveZone} aria-hidden="true"><canvas ref={canvasRef} className={`${s.waveCanvas} ${playing ? s.waveCanvasVisible : ""}`} /></div>;
}

function PlayerHeader({ organizationName, locationName }: { organizationName?: string; locationName?: string }) {
  const { t } = useI18n();
  return <header className={s.header}>
    <div><div className={s.brand}>{organizationName || t("brand")}</div><div className={s.platformTag}>{organizationName && locationName ? locationName : t("localPrototype")}</div></div>
    <div className={s.headerOverlay}><LanguageSelector /><div className={s.badge}>{t("testMode")}</div><PlayerManagementMenu /></div>
  </header>;
}

export default function V2Player({ catalog, deviceId, locationId, organizationName, locationName, monitoringEnabled = false }: { catalog: PlayerChannel[]; deviceId?: string; locationId?: string; organizationName?: string; locationName?: string; monitoringEnabled?: boolean }) {
  const { t, locale } = useI18n();
  const dialogTitleId = useId();
  const dialogChannelNameId = useId();
  const dialogDescriptionId = useId();
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
  const ownershipRef = useRef<DevicePlayerOwnership | null>(null);
  const monitoringSidecarRef = useRef<PlayerMonitoringSidecar | null>(null);
  const samplerRef = useRef<number | null>(null);
  const [ownershipState, setOwnershipState] = useState<PlayerOwnershipState>(monitoringEnabled ? (deviceId ? "waiting" : "unsupported") : "owned");
  const [monitoringState, setMonitoringState] = useState<MonitoringConnectionState>(monitoringEnabled ? "idle" : "connected");
  const [monitoringReady, setMonitoringReady] = useState(!monitoringEnabled);
  const ownsPlayback = !monitoringEnabled || ownershipState === "owned";
  const canStartAudio = canStartPlayerAudio({ monitoringEnabled, lockOwned: ownsPlayback, monitoringReady, monitoringConnected: monitoringState === "connected" });
  const activeAmbientChannelRef = useRef<string | null>(null);
  const musicProgressRef = useRef<ProgressTracker>({ key: null, position: null, sampledAt: null, progressedAt: -Infinity });
  const ambientProgressRef = useRef<ProgressTracker>({ key: null, position: null, sampledAt: null, progressedAt: -Infinity });
  const musicErrorEpisodeRef = useRef<string | null>(null);
  const ambientErrorEpisodeRef = useRef<string | null>(null);
  const [playback, setPlayback] = useState<Mp3EngineState>({ status: "idle", currentTrackIndex: 0, preparedTrackIndex: null, sourceKind: null, currentTime: 0, error: null });
  const [ambientPlayback, setAmbientPlayback] = useState<AmbientEngineState>({ status: "idle", activeTrackId: null, sourceKind: null, volume: 0.4, currentTime: 0, error: null });
  const [activeChannelId, setActiveChannelId] = useState<string | null>(playableMusicChannels[0]?.id ?? null);
  const [lockedChannel, setLockedChannel] = useState<PlayerChannel | null>(null);
  const lockedDialogRef = useRef<HTMLDialogElement | null>(null);
  const lockedDialogCloseRef = useRef<HTMLButtonElement | null>(null);
  const lockedChannelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeChannel = useMemo(() => musicChannels.find((channel) => channel.id === activeChannelId && channel.playable !== false && channel.tracks.length) ?? playableMusicChannels[0], [activeChannelId, musicChannels, playableMusicChannels]);
  const playing = engineChannelIdRef.current === activeChannelId && playback.status === "playing";
  const buffering = engineChannelIdRef.current === activeChannelId && playback.status === "loading";
  const ambientVolume = Math.round(ambientPlayback.volume * 100);

  useEffect(() => {
    if (!lockedChannel) return;
    const dialog = lockedDialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    lockedDialogCloseRef.current?.focus();
  }, [lockedChannel]);

  const showLockedChannelInfo = (channel: PlayerChannel, trigger: HTMLButtonElement) => {
    lockedChannelTriggerRef.current = trigger;
    setLockedChannel(channel);
  };

  const restoreLockedChannelFocus = () => {
    setLockedChannel(null);
    const trigger = lockedChannelTriggerRef.current;
    lockedChannelTriggerRef.current = null;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const lockedProductNames = (lockedChannel?.catalogProducts ?? []).filter((product) => product.id && product.name.trim());
  const subscriptionHref = playerUpgradeAccountHref(locationId, lockedProductNames.map((product) => product.id));

  const monitoringContextRef = useRef({ playback, ambientPlayback, activeChannelId, activeAmbientChannelId: null as string | null, musicChannelId: null as string | null, musicTrackId: null as string | null });
  monitoringContextRef.current = {
    playback,
    ambientPlayback,
    activeChannelId,
    activeAmbientChannelId: activeAmbientChannelRef.current,
    musicChannelId: activeChannel?.id ?? null,
    musicTrackId: activeChannel?.tracks[playback.currentTrackIndex]?.id ?? null,
  };

  const readMonitoringSnapshot = useCallback((): MonitoringSnapshot => {
    const context = monitoringContextRef.current;
    const musicChannelId = engineChannelIdRef.current === context.activeChannelId ? context.musicChannelId : null;
    const musicPosition = engineRef.current?.getMonitoringPosition() ?? { currentTime: context.playback.currentTime, paused: true, seeking: false };
    const musicStatus = engineChannelIdRef.current === context.activeChannelId ? context.playback.status : "loading";
    const music = observeLaneProgress({
      status: musicStatus,
      channelId: musicChannelId,
      key: musicChannelId ? `${musicChannelId}/${context.musicTrackId ?? "unknown"}` : null,
      ...musicPosition,
    }, musicProgressRef.current, performance.now());

    const ambientPosition = ambientEngineRef.current?.getMonitoringPosition() ?? { currentTime: context.ambientPlayback.currentTime, paused: true, seeking: false };
    const ambient = observeLaneProgress({
      status: context.ambientPlayback.status,
      channelId: context.activeAmbientChannelId,
      key: context.activeAmbientChannelId ? `${context.activeAmbientChannelId}/${context.ambientPlayback.activeTrackId ?? "unknown"}` : null,
      ...ambientPosition,
    }, ambientProgressRef.current, performance.now());
    return { music, ambient };
  }, []);

  useEffect(() => {
    if (!monitoringEnabled) return;
    if (!deviceId) return;
    const playbackIntent = musicWantsPlaybackRef.current;
    let mounted = true;
    let sidecar: PlayerMonitoringSidecar | null = null;
    const onPageHide = () => sidecar?.releaseForPageExit();
    const onPageShow = () => sidecar?.resumeAfterPageShow();
    window.addEventListener("pagehide", onPageHide);
    const owner = new DevicePlayerOwnership(deviceId, state => {
      if (!mounted) return;
      setOwnershipState(state);
      if (state !== "owned" || sidecar) return;
      sidecar = new PlayerMonitoringSidecar(readMonitoringSnapshot, { onConnectionStateChange: connection => {
        if (!mounted) return;
        setMonitoringState(connection);
        if (connection === "connected") setMonitoringReady(true);
        if (connection === "unauthorized") {
          playbackIntent.stop();
          engineRef.current?.pause();
          ambientEngineRef.current?.stop();
          activeAmbientChannelRef.current = null;
          const stoppedSidecar = sidecar;
          sidecar = null;
          monitoringSidecarRef.current = null;
          if (samplerRef.current !== null) window.clearInterval(samplerRef.current);
          samplerRef.current = null;
          void owner.release(stoppedSidecar?.dispose());
        }
      } });
      monitoringSidecarRef.current = sidecar;
      void sidecar.start();
      samplerRef.current = window.setInterval(() => sidecar?.update(readMonitoringSnapshot()), 1_000);
      window.addEventListener("pageshow", onPageShow);
    });
    ownershipRef.current = owner;
    owner.start();
    return () => {
      mounted = false;
      if (samplerRef.current !== null) window.clearInterval(samplerRef.current);
      samplerRef.current = null;
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      if (sidecar) {
        playbackIntent.stop();
        engineRef.current?.pause();
        ambientEngineRef.current?.stop();
        activeAmbientChannelRef.current = null;
      }
      const oldSidecar = sidecar;
      sidecar = null;
      monitoringSidecarRef.current = null;
      if (ownershipRef.current === owner) ownershipRef.current = null;
      void owner.release(oldSidecar?.dispose());
    };
  }, [deviceId, monitoringEnabled, readMonitoringSnapshot]);

  useEffect(() => {
    if (playback.status !== "error") {
      musicErrorEpisodeRef.current = null;
      return;
    }
    if (!monitoringEnabled || engineChannelIdRef.current !== activeChannelId) return;
    const trackId = activeChannel?.tracks[playback.currentTrackIndex]?.id ?? "unknown";
    const episode = `${activeChannelId ?? "none"}/${trackId}`;
    const next = advanceFailureEpisode(musicErrorEpisodeRef.current, playback.status, episode);
    musicErrorEpisodeRef.current = next.key;
    if (!next.shouldReport) return;
    void reportPlaybackFailure("music");
  }, [monitoringEnabled, playback.status, playback.currentTrackIndex, activeChannelId, activeChannel]);

  useEffect(() => {
    if (ambientPlayback.status !== "error") {
      ambientErrorEpisodeRef.current = null;
      return;
    }
    if (!monitoringEnabled || !activeAmbientChannelRef.current) return;
    const episode = `${activeAmbientChannelRef.current}/${ambientPlayback.activeTrackId ?? "unknown"}`;
    const next = advanceFailureEpisode(ambientErrorEpisodeRef.current, ambientPlayback.status, episode);
    ambientErrorEpisodeRef.current = next.key;
    if (!next.shouldReport) return;
    void reportPlaybackFailure("ambient");
  }, [monitoringEnabled, ambientPlayback.status, ambientPlayback.activeTrackId]);

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
    if (initial?.tracks.length) replaceMusicEngine(initial.id, initial.tracks);
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
      if (!canStartAudio) return;
      musicWantsPlaybackRef.current.start();
      void engineRef.current?.play();
    }
  };

  const selectMusic = (channel: PlayerChannel) => {
    recordMusicDiagnostic("ui-channel-select", { fromChannelId: activeChannelId, toChannelId: channel.id, title: channel.title, status: playback.status, intent: musicWantsPlaybackRef.current });
    const playlist = channel.tracks.length ? channel.tracks : null;
    if (channel.playable === false || !channel.tracks.length) return;
    if (channel.id === activeChannelId) {
      if (playlist && (canStartAudio || playing || buffering)) toggleMusicPlayback();
      return;
    }
    if (!canStartAudio && musicWantsPlaybackRef.current.wantsPlayback) return;
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
    if (activeChannel?.tracks.length && engineChannelIdRef.current === activeChannelId) toggleMusicPlayback();
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

  const playbackModeLabel = playbackMode === "repeat-one" ? t("repeatOne") : playbackMode === "shuffle" ? t("shuffle") : t("standard");

  const currentTrackName = activeChannel?.tracks[playback.currentTrackIndex]?.originalFilename?.replace(/\.mp3$/i, "") ?? null;
  const activeChannelTitle = activeChannel ? resolveChannelTitle(activeChannel.title, activeChannel.localizedTitles, locale) : null;
  const playbackLabel = !activeChannel?.tracks.length
      ? t("plannedChannel")
      : playback.status === "loading"
      ? currentTrackName ? `${t("buffering")}: ${currentTrackName}` : t("buffering")
      : playback.status === "error"
        ? t("playbackError")
        : playing
          ? currentTrackName ? `${t("playing")}: ${currentTrackName}` : t("playingTrack")
          : playback.status === "paused"
            ? currentTrackName ? `${t("paused")}: ${currentTrackName}` : `${t("paused")}`
            : currentTrackName ? `${t("ready")}: ${currentTrackName}` : t("readyToPlay");

  const toggleAmbient = (channel: PlayerChannel) => {
    if (channel.playable === false || !channel.tracks.length) return;
    const isCurrentAmbient = activeAmbientChannelRef.current === channel.id;
    if (!canStartAudio && !isCurrentAmbient) return;
    activeAmbientChannelRef.current = activeAmbientChannelRef.current === channel.id ? null : channel.id;
    void ambientEngineRef.current?.togglePlaylist(channel.id, channel.tracks);
  };

  const standbyMessageKey = playerStatusMessageKey({ monitoringEnabled, ownershipState, monitoringState });
  const standbyMessage = standbyMessageKey ? t(standbyMessageKey) : null;
  const canStartNewLane = canStartAudio;

  return (
    <div
      className={s.shell}
      data-testid="v2-player"
      data-catalog-source="v2-db"
      data-channel-slug={activeChannel?.slug ?? "none"}
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
      <PlayerHeader organizationName={organizationName} locationName={locationName} />

      <main className={s.main}>
        {standbyMessage && <p className={s.playerOwnershipStatus} role="status" aria-live="polite">{standbyMessage}</p>}
        <section className={s.hero}>
          {activeChannel ? <>
          <div className={s.nowPlayingLabel}>{t("nowSelected")}</div>
          <h1 className={s.channelName}>{activeChannelTitle}</h1>
          <div className={s.channelMood}>{activeChannel.mood}</div>
          <button type="button" disabled={!canStartNewLane && !playing && !buffering} className={`${s.yinYangButton} ${playing ? s.yinYangPlaying : ""} ${buffering ? s.yinYangBuffering : ""}`} onClick={togglePlayback} aria-label={buffering ? `Pause buffering ${activeChannelTitle}` : playing ? `Pause ${activeChannelTitle}` : `Play ${activeChannelTitle}`} aria-pressed={playing} aria-busy={buffering}>
            <span className={s.ambientGlow} />
            <span className={`${s.halo} ${s.haloOne}`} /><span className={`${s.halo} ${s.haloTwo}`} /><span className={`${s.halo} ${s.haloThree}`} />
            <Image src="/yin-yang.png" alt="Play / Pause" width={240} height={240} className={s.yinYangImage} priority />
          </button>
          <WaveVisualization playing={playing} />
          <div className={s.statusLine} title={currentTrackName ?? playback.error ?? undefined}><span className={`${s.statusDot} ${playing ? s.statusDotPlaying : ""} ${buffering ? s.statusDotBuffering : ""}`} /><span className={`${playing ? s.statusPlaying : buffering ? s.statusBuffering : ""} ${s.statusText}`}>{playbackLabel}</span></div>
          <div className={s.trackControls} aria-label={t("musicChannels")}>
            <button type="button" className={s.trackButton} onClick={previousMusicTrack} disabled={!canStartNewLane || activeChannel.tracks.length < 2} aria-label={t("previousTrack")}><span className={s.skipIcon} aria-hidden="true"><i /><i /></span><span>{t("previous")}</span></button>
            <button type="button" className={`${s.trackButton} ${s.modeButton}`} onClick={cyclePlaybackMode} disabled={!canStartNewLane} aria-label={`${t("playbackMode")}: ${playbackModeLabel}`} title={`${t("playbackMode")}: ${playbackModeLabel}`}>
              {playbackModeLabel}
            </button>
            <button type="button" className={s.trackButton} onClick={nextMusicTrack} disabled={!canStartNewLane || activeChannel.tracks.length < 2} aria-label={t("nextTrack")}><span>{t("next")}</span><span className={`${s.skipIcon} ${s.skipIconNext}`} aria-hidden="true"><i /><i /></span></button>
          </div></> : <>
            <div className={s.nowPlayingLabel}>{t("player")}</div>
            <h1 className={s.channelName}>{t("noChannels")}</h1>
            <p className={s.channelMood}>{t("noPlayableChannels")}</p>
          </>}
        </section>

        <section className={s.section}>
          <div className={s.sectionHeader}><div className={s.sectionLabel}>{t("musicChannels")}</div><div className={s.sectionCount}>{musicChannels.length} {t("channels")}</div></div>
          <div className={s.cardsRow} data-testid="music-row">
            {musicChannels.map((channel) => <MusicCard key={channel.id} channel={channel} active={channel.id === activeChannelId} playing={playing} standby={!canStartNewLane} onSelect={() => selectMusic(channel)} onLocked={(trigger) => showLockedChannelInfo(channel, trigger)} />)}
          </div>
        </section>

        <section className={`${s.section} ${s.ambientSection}`} title={ambientPlayback.error ?? undefined}>
          <div className={s.sectionHeader}><div className={s.sectionLabel}>{t("ambient")}</div><div className={s.ambientValue}>{ambientVolume}%</div></div>
          <div className={s.sliderWrap}>
            <div className={s.sliderTrack} /><div className={s.sliderFill} style={{ width: `${ambientVolume}%` }} />
            <div className={s.sliderThumb} style={{ left: `${ambientVolume}%` }}><span /></div>
            <input type="range" min="0" max="100" step="1" value={ambientVolume} disabled={!canStartNewLane} onChange={(event) => ambientEngineRef.current?.setVolume(Number(event.currentTarget.value) / 100)} className={s.sliderInput} aria-label={t("ambientVolume")} />
          </div>
          <div className={s.cardsRow} data-testid="ambient-row">
            {ambientChannels.map((channel) => <AmbientCard key={channel.id} channel={channel} active={channel.tracks.some((track) => track.id === ambientPlayback.activeTrackId)} standby={!canStartNewLane} onSelect={() => toggleAmbient(channel)} onLocked={(trigger) => showLockedChannelInfo(channel, trigger)} />)}
          </div>
        </section>
      </main>

      <dialog
        ref={lockedDialogRef}
        className={s.lockedDialog}
        aria-labelledby={`${dialogTitleId} ${dialogChannelNameId}`}
        aria-describedby={dialogDescriptionId}
        onClose={restoreLockedChannelFocus}
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      >
        {lockedChannel && <>
          <div className={s.lockedDialogHeader}>
            <div>
              <h2 id={dialogTitleId} className={s.lockedDialogTitle}>{t("lockedChannelDialogTitle")}</h2>
              <p id={dialogChannelNameId} className={s.lockedDialogChannel}>{resolveChannelTitle(lockedChannel.title, lockedChannel.localizedTitles, locale)}</p>
            </div>
            <button ref={lockedDialogCloseRef} type="button" className={s.lockedDialogClose} onClick={() => lockedDialogRef.current?.close()} aria-label={t("lockedChannelDialogClose")}>×</button>
          </div>
          <p id={dialogDescriptionId} className={s.lockedDialogDescription}>{t("lockedChannelDialogSubscriptionRequired")}</p>
          {lockedProductNames.length > 0 ? <>
            <p className={s.lockedDialogProductsLabel}>{t("lockedChannelDialogProductsLabel")}</p>
            <ul className={s.lockedDialogProducts}>{lockedProductNames.map((product) => <li key={product.id}>{product.name}</li>)}</ul>
          </> : <p className={s.lockedDialogFallback}>{t("lockedChannelDialogNoProducts")}</p>}
          <div className={s.lockedDialogActions}>
            {subscriptionHref && <a className={`${s.lockedDialogContinue} ${s.lockedDialogSubscription}`} href={subscriptionHref} target="_blank" rel="noopener noreferrer">{t("lockedChannelDialogViewSubscription")}</a>}
            <button type="button" className={s.lockedDialogContinue} onClick={() => lockedDialogRef.current?.close()}>{t("lockedChannelDialogContinueListening")}</button>
          </div>
        </>}
      </dialog>

      <footer className={s.footer}><div><div className={s.footerLabel}>{t("prototypeAccess")}</div><div className={s.footerText}>{t("noAccount")}</div><MusicDiagnosticPanel capture={() => engineRef.current?.captureDiagnostics()} /></div></footer>
    </div>
  );
}

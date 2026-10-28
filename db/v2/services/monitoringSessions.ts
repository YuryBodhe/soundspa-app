import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db } from "../client";
import { deviceCurrentState, hourlyChannelPlayback, hourlyDevicePlayback } from "../schema";
import { calculatePlaybackAccountingCredit, type PlaybackAccountingBaseline } from "./playbackAccounting";

export type MonitoringLane = "music" | "ambient";
// Heartbeats are 120–135 seconds apart. 240 seconds allows a delayed heartbeat
// while leaving 60 seconds before the dashboard's 300-second offline threshold.
export const MONITORING_LEASE_MS = 240_000;
export type MonitoringPlaybackState = "idle" | "playing" | "paused" | "buffering" | "error";
type MonitoringTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

export type MonitoringLaneSignal = {
  sequence: number;
  state: MonitoringPlaybackState;
  channelId: string | null;
};

type ServerClock = (tx: MonitoringTx) => Promise<Date>;

async function readDatabaseClock(tx: MonitoringTx): Promise<Date> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS accepted_at`);
  const value = result.rows[0]?.accepted_at;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Database clock returned an invalid timestamp");
  return date;
}

/** Accept a dual-lane snapshot while serializing against session replacement and other signals. */
export async function acceptMonitoringSnapshot(input: {
  deviceId: string;
  generation: number;
  sessionId: string;
  music: MonitoringLaneSignal;
  ambient: MonitoringLaneSignal;
}, readServerTime: ServerClock = readDatabaseClock) {
  return v2Db.transaction(async (tx) => {
    const [current] = await tx.select({
      generation: deviceCurrentState.monitoringGeneration,
      lastSeenAt: deviceCurrentState.lastSeenAt,
      musicSessionId: deviceCurrentState.musicSessionId,
      musicSequence: deviceCurrentState.musicSequence,
      musicPlaybackState: deviceCurrentState.musicPlaybackState,
      musicCurrentChannelId: deviceCurrentState.musicCurrentChannelId,
      ambientSessionId: deviceCurrentState.ambientSessionId,
      ambientSequence: deviceCurrentState.ambientSequence,
      ambientPlaybackState: deviceCurrentState.ambientPlaybackState,
      ambientCurrentChannelId: deviceCurrentState.ambientCurrentChannelId,
    }).from(deviceCurrentState)
      .where(eq(deviceCurrentState.deviceId, input.deviceId))
      .for("update");

    if (!current || current.generation !== input.generation) {
      return { accepted: { music: false, ambient: false } };
    }
    const musicAccepted = current.musicSessionId === input.sessionId
      && current.musicSequence !== null
      && Number.isSafeInteger(input.music.sequence)
      && input.music.sequence > current.musicSequence;
    const ambientAccepted = current.ambientSessionId === input.sessionId
      && current.ambientSequence !== null
      && Number.isSafeInteger(input.ambient.sequence)
      && input.ambient.sequence > current.ambientSequence;

    if (!musicAccepted && !ambientAccepted) {
      return { accepted: { music: false, ambient: false } };
    }

    // Read the DB clock only after acquiring the per-device row lock. This keeps
    // concurrently accepted signals ordered by the same serialized baseline.
    const acceptedAt = await readServerTime(tx);
    const previous: PlaybackAccountingBaseline = {
      lastSeenAt: current.lastSeenAt,
      music: {
        sessionId: current.musicSessionId,
        sequence: current.musicSequence,
        playbackState: current.musicPlaybackState,
        channelId: current.musicCurrentChannelId,
      },
      ambient: {
        sessionId: current.ambientSessionId,
        sequence: current.ambientSequence,
        playbackState: current.ambientPlaybackState,
        channelId: current.ambientCurrentChannelId,
      },
    };
    const credit = calculatePlaybackAccountingCredit(previous, input.sessionId, acceptedAt);

    for (const bucket of credit.active) {
      await tx.insert(hourlyDevicePlayback).values({
        bucketStart: bucket.bucketStart,
        deviceId: input.deviceId,
        activePlaybackSeconds: bucket.playedSeconds,
      }).onConflictDoUpdate({
        target: [hourlyDevicePlayback.bucketStart, hourlyDevicePlayback.deviceId],
        set: {
          activePlaybackSeconds: sql`${hourlyDevicePlayback.activePlaybackSeconds} + EXCLUDED.active_playback_seconds`,
        },
      });
    }
    for (const bucket of credit.channels) {
      await tx.insert(hourlyChannelPlayback).values({
        bucketStart: bucket.bucketStart,
        deviceId: input.deviceId,
        channelId: bucket.channelId,
        lane: bucket.lane,
        playedSeconds: bucket.playedSeconds,
      }).onConflictDoUpdate({
        target: [hourlyChannelPlayback.bucketStart, hourlyChannelPlayback.deviceId, hourlyChannelPlayback.channelId, hourlyChannelPlayback.lane],
        set: {
          playedSeconds: sql`${hourlyChannelPlayback.playedSeconds} + EXCLUDED.played_seconds`,
        },
      });
    }

    const resultingMusicState = musicAccepted ? input.music.state : current.musicPlaybackState;
    const resultingAmbientState = ambientAccepted ? input.ambient.state : current.ambientPlaybackState;
    await tx.update(deviceCurrentState).set({
      ...(musicAccepted ? {
        musicSessionId: input.sessionId,
        musicSequence: input.music.sequence,
        musicPlaybackState: input.music.state,
        musicCurrentChannelId: input.music.channelId,
      } : {}),
      ...(ambientAccepted ? {
        ambientSessionId: input.sessionId,
        ambientSequence: input.ambient.sequence,
        ambientPlaybackState: input.ambient.state,
        ambientCurrentChannelId: input.ambient.channelId,
      } : {}),
      lastSeenAt: acceptedAt,
      updatedAt: acceptedAt,
      ...(resultingMusicState === "playing" || resultingAmbientState === "playing"
        ? { lastPlaybackAt: acceptedAt }
        : {}),
    }).where(eq(deviceCurrentState.deviceId, input.deviceId));

    return { accepted: { music: musicAccepted, ambient: ambientAccepted } };
  });
}

/** Claim only a released or stale per-device lease, serialized by its row lock. */
export async function beginMonitoringSession(deviceId: string) {
  const sessionId = randomUUID();
  return v2Db.transaction(async (tx) => {
    await tx.insert(deviceCurrentState).values({ deviceId }).onConflictDoNothing();
    const [current] = await tx.select({
      generation: deviceCurrentState.monitoringGeneration,
      musicSessionId: deviceCurrentState.musicSessionId,
      ambientSessionId: deviceCurrentState.ambientSessionId,
      updatedAt: deviceCurrentState.updatedAt,
    }).from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, deviceId)).for("update");
    if (!current) throw new Error("Monitoring state unavailable");
    const now = await readDatabaseClock(tx);
    const remaining = MONITORING_LEASE_MS - (now.getTime() - current.updatedAt.getTime());
    if ((current.musicSessionId || current.ambientSessionId) && remaining > 0) {
      return { status: "owner_active" as const, retryAfterMs: Math.max(1_000, Math.ceil(remaining)) };
    }
    const [claimed] = await tx.update(deviceCurrentState).set({
      monitoringGeneration: current.generation + 1,
      musicSessionId: sessionId, musicSequence: 0,
      ambientSessionId: sessionId, ambientSequence: 0,
      updatedAt: now,
    }).where(eq(deviceCurrentState.deviceId, deviceId))
      .returning({ generation: deviceCurrentState.monitoringGeneration });
    return { status: "acquired" as const, sessionId, generation: claimed.generation };
  });
}

/** Late exits cannot release a newer generation. Historical lane values remain intact. */
export async function releaseMonitoringSession(input: { deviceId: string; sessionId: string; generation: number }) {
  return v2Db.transaction(async (tx) => {
    const [current] = await tx.select({
      generation: deviceCurrentState.monitoringGeneration,
      musicSessionId: deviceCurrentState.musicSessionId,
      ambientSessionId: deviceCurrentState.ambientSessionId,
    }).from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, input.deviceId)).for("update");
    if (!current || current.generation !== input.generation
      || current.musicSessionId !== input.sessionId || current.ambientSessionId !== input.sessionId) return false;
    await tx.update(deviceCurrentState).set({
      musicSessionId: null, musicSequence: null,
      ambientSessionId: null, ambientSequence: null,
      updatedAt: await readDatabaseClock(tx),
    }).where(eq(deviceCurrentState.deviceId, input.deviceId));
    return true;
  });
}

/**
 * Check a lane signal while holding the current-state row lock. Call inside a
 * transaction and apply the accepted lane update before that transaction ends.
 */
export async function isCurrentMonitoringSignal(tx: MonitoringTx, input: {
  deviceId: string;
  generation: number;
  sessionId: string;
  lane: MonitoringLane;
  sequence: number;
}): Promise<boolean> {
  const [state] = await tx.select({
    generation: deviceCurrentState.monitoringGeneration,
    musicSessionId: deviceCurrentState.musicSessionId,
    musicSequence: deviceCurrentState.musicSequence,
    ambientSessionId: deviceCurrentState.ambientSessionId,
    ambientSequence: deviceCurrentState.ambientSequence,
  }).from(deviceCurrentState)
    .where(eq(deviceCurrentState.deviceId, input.deviceId))
    .for("update");

  if (!state || state.generation !== input.generation) return false;
  const laneSessionId = input.lane === "music" ? state.musicSessionId : state.ambientSessionId;
  const laneSequence = input.lane === "music" ? state.musicSequence : state.ambientSequence;
  return laneSessionId === input.sessionId
    && laneSequence !== null
    && Number.isSafeInteger(input.sequence)
    && input.sequence > laneSequence;
}

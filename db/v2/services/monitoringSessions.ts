import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db } from "../client";
import { deviceCurrentState } from "../schema";

export type MonitoringLane = "music" | "ambient";
type MonitoringTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

/** Atomically supersede the device's prior Player session and both lane sequence baselines. */
export async function beginMonitoringSession(deviceId: string) {
  const sessionId = randomUUID();
  const [row] = await v2Db.insert(deviceCurrentState).values({
    deviceId,
    monitoringGeneration: 1,
    musicSessionId: sessionId,
    musicSequence: 0,
    ambientSessionId: sessionId,
    ambientSequence: 0,
  }).onConflictDoUpdate({
    target: deviceCurrentState.deviceId,
    set: {
      monitoringGeneration: sql`${deviceCurrentState.monitoringGeneration} + 1`,
      musicSessionId: sessionId,
      musicSequence: 0,
      ambientSessionId: sessionId,
      ambientSequence: 0,
      updatedAt: sql`now()`,
    },
  }).returning({ generation: deviceCurrentState.monitoringGeneration });

  return { sessionId, generation: row.generation };
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

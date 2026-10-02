export const MAX_CREDITABLE_GAP_SECONDS = 180;

const SECOND_MS = 1_000;
const UTC_HOUR_MS = 3_600 * SECOND_MS;

export type AccountingLaneState = {
  sessionId: string | null;
  sequence: number | null;
  playbackState: string;
  channelId: string | null;
};

export type PlaybackAccountingBaseline = {
  lastSeenAt: Date;
  music: AccountingLaneState;
  ambient: AccountingLaneState;
};

export type ChannelPlaybackCredit = {
  bucketStart: Date;
  lane: "music" | "ambient";
  channelId: string;
  playedSeconds: number;
};

export type PlaybackAccountingCredit = {
  active: Array<{ bucketStart: Date; playedSeconds: number }>;
  channels: ChannelPlaybackCredit[];
};

function splitWholeSecondsIntoUtcHours(startMs: number, endMs: number) {
  const result: Array<{ bucketStart: Date; playedSeconds: number }> = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const bucketMs = Math.floor(cursor / UTC_HOUR_MS) * UTC_HOUR_MS;
    const segmentEnd = Math.min(endMs, bucketMs + UTC_HOUR_MS);
    const playedSeconds = Math.floor((segmentEnd - cursor) / SECOND_MS);
    if (playedSeconds > 0) result.push({ bucketStart: new Date(bucketMs), playedSeconds });
    cursor = segmentEnd;
  }

  return result;
}

/**
 * Attribute only the previous accepted state, and only for the bounded interval
 * since its server receipt time. Sequence zero marks a new-session lane whose
 * first state has not yet established an accounting baseline.
 */
export function calculatePlaybackAccountingCredit(
  previous: PlaybackAccountingBaseline,
  currentSessionId: string,
  acceptedAt: Date,
): PlaybackAccountingCredit {
  const startMs = previous.lastSeenAt.getTime();
  const acceptedMs = acceptedAt.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(acceptedMs) || acceptedMs <= startMs) {
    return { active: [], channels: [] };
  }

  const musicKnown = previous.music.sessionId === currentSessionId
    && previous.music.sequence !== null && previous.music.sequence > 0;
  const ambientKnown = previous.ambient.sessionId === currentSessionId
    && previous.ambient.sequence !== null && previous.ambient.sequence > 0;
  const musicPlaying = musicKnown && previous.music.playbackState === "playing";
  const ambientPlaying = ambientKnown && previous.ambient.playbackState === "playing";
  if (!musicPlaying && !ambientPlaying) return { active: [], channels: [] };

  const boundedEndMs = Math.min(acceptedMs, startMs + MAX_CREDITABLE_GAP_SECONDS * SECOND_MS);
  const active = splitWholeSecondsIntoUtcHours(startMs, boundedEndMs);
  const channels: ChannelPlaybackCredit[] = [];

  for (const [lane, isPlaying, state] of [
    ["music", musicPlaying, previous.music],
    ["ambient", ambientPlaying, previous.ambient],
  ] as const) {
    if (!isPlaying || !state.channelId) continue;
    for (const bucket of active) {
      channels.push({ ...bucket, lane, channelId: state.channelId });
    }
  }

  return { active, channels };
}

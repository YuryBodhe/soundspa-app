import assert from "node:assert/strict";
import {
  calculatePlaybackAccountingCredit,
  MAX_CREDITABLE_GAP_SECONDS,
  type PlaybackAccountingBaseline,
} from "../../db/v2/services/playbackAccounting";

const session = "10000000-0000-4000-8000-000000000001";
const music = "20000000-0000-4000-8000-000000000001";
const musicNext = "20000000-0000-4000-8000-000000000002";
const ambient = "30000000-0000-4000-8000-000000000001";
const utc = (value: string) => new Date(value);

function baseline(input: {
  at?: Date;
  musicState?: string;
  musicChannel?: string | null;
  musicSession?: string | null;
  musicSequence?: number | null;
  ambientState?: string;
  ambientChannel?: string | null;
  ambientSession?: string | null;
  ambientSequence?: number | null;
} = {}): PlaybackAccountingBaseline {
  return {
    lastSeenAt: input.at ?? utc("2026-01-01T10:00:00.000Z"),
    music: {
      sessionId: input.musicSession === undefined ? session : input.musicSession,
      sequence: input.musicSequence === undefined ? 1 : input.musicSequence,
      playbackState: input.musicState ?? "paused",
      channelId: input.musicChannel === undefined ? music : input.musicChannel,
    },
    ambient: {
      sessionId: input.ambientSession === undefined ? session : input.ambientSession,
      sequence: input.ambientSequence === undefined ? 1 : input.ambientSequence,
      playbackState: input.ambientState ?? "idle",
      channelId: input.ambientChannel === undefined ? ambient : input.ambientChannel,
    },
  };
}

function credit(previous: PlaybackAccountingBaseline, seconds: number, currentSession = session) {
  return calculatePlaybackAccountingCredit(
    previous,
    currentSession,
    new Date(previous.lastSeenAt.getTime() + seconds * 1_000),
  );
}

function total(rows: Array<{ playedSeconds: number }>) {
  return rows.reduce((sum, row) => sum + row.playedSeconds, 0);
}

const musicOnly = credit(baseline({ musicState: "playing" }), 120);
assert.equal(total(musicOnly.active), 120, "Music-only playback counts once as Player Active");
assert.equal(total(musicOnly.channels.filter((row) => row.lane === "music")), 120);
assert.equal(musicOnly.channels.some((row) => row.lane === "ambient"), false);

const ambientOnly = credit(baseline({ ambientState: "playing" }), 120);
assert.equal(total(ambientOnly.active), 120, "Ambient-only playback counts once as Player Active");
assert.equal(total(ambientOnly.channels.filter((row) => row.lane === "ambient")), 120);
assert.equal(ambientOnly.channels.some((row) => row.lane === "music"), false);

const both = credit(baseline({ musicState: "playing", ambientState: "playing" }), 120);
assert.equal(total(both.active), 120, "simultaneous lanes count Player Active only once");
assert.equal(total(both.channels.filter((row) => row.lane === "music")), 120);
assert.equal(total(both.channels.filter((row) => row.lane === "ambient")), 120);

const stopped = credit(baseline({ musicState: "paused", ambientState: "idle" }), 120);
assert.deepEqual(stopped, { active: [], channels: [] }, "stopped lanes accrue nothing");

const pausedToPlaying = credit(baseline({ musicState: "paused" }), 120);
assert.deepEqual(pausedToPlaying, { active: [], channels: [] }, "new playing state does not back-credit time");
const playingToPaused = credit(baseline({ musicState: "playing" }), 120);
assert.equal(total(playingToPaused.active), 120, "previous playing state is credited through the pause signal");

const channelSwitch = credit(baseline({ musicState: "playing", musicChannel: music }), 120);
assert.deepEqual(channelSwitch.channels.map((row) => row.channelId), [music], "switch interval belongs to the previous channel only");
assert.notEqual(music, musicNext);

const capped = calculatePlaybackAccountingCredit(
  baseline({ musicState: "playing" }),
  session,
  utc("2026-01-01T10:10:00.000Z"),
);
assert.equal(total(capped.active), MAX_CREDITABLE_GAP_SECONDS, "long gaps credit only the 180-second freshness cap");
const stoppedLongGap = calculatePlaybackAccountingCredit(
  baseline({ musicState: "paused" }), session, utc("2026-01-01T10:10:00.000Z"),
);
assert.equal(total(stoppedLongGap.active), 0, "long stopped gaps remain zero");

const sessionBoundary = credit(baseline({
  musicState: "playing", musicSession: session, musicSequence: 0,
  ambientState: "playing", ambientSession: session, ambientSequence: 0,
}), 120);
assert.deepEqual(sessionBoundary, { active: [], channels: [] }, "sequence-zero new session establishes a baseline, not a bridge");
const oldSession = credit(baseline({ musicState: "playing", musicSession: "old-session" }), 120);
assert.deepEqual(oldSession, { active: [], channels: [] }, "old session state cannot be credited under a new session");

const split = calculatePlaybackAccountingCredit(
  baseline({ at: utc("2026-01-01T10:59:30.000Z"), musicState: "playing", ambientState: "playing" }),
  session,
  utc("2026-01-01T11:00:30.000Z"),
);
assert.deepEqual(split.active.map((row) => [row.bucketStart.toISOString(), row.playedSeconds]), [
  ["2026-01-01T10:00:00.000Z", 30], ["2026-01-01T11:00:00.000Z", 30],
]);
assert.deepEqual(split.channels.map((row) => [row.lane, row.bucketStart.toISOString(), row.playedSeconds]), [
  ["music", "2026-01-01T10:00:00.000Z", 30],
  ["music", "2026-01-01T11:00:00.000Z", 30],
  ["ambient", "2026-01-01T10:00:00.000Z", 30],
  ["ambient", "2026-01-01T11:00:00.000Z", 30],
]);

const exactBoundary = calculatePlaybackAccountingCredit(
  baseline({ at: utc("2026-01-01T10:59:00.000Z"), musicState: "playing" }),
  session,
  utc("2026-01-01T11:00:00.000Z"),
);
assert.deepEqual(exactBoundary.active.map((row) => [row.bucketStart.toISOString(), row.playedSeconds]), [
  ["2026-01-01T10:00:00.000Z", 60],
], "an interval ending exactly at the boundary does not create a next-hour row");

const noChannel = credit(baseline({ musicState: "playing", musicChannel: null }), 120);
assert.equal(total(noChannel.active), 120, "playing without a channel still counts Player Active");
assert.equal(noChannel.channels.length, 0, "playing without a valid channel has no channel usage");
const timeWentBackwards = calculatePlaybackAccountingCredit(
  baseline({ musicState: "playing" }), session, utc("2026-01-01T09:59:59.000Z"),
);
assert.deepEqual(timeWentBackwards, { active: [], channels: [] }, "non-forward server time cannot generate credit");

console.info("PASS: lane accounting, Player Active OR, transitions, freshness cap, session boundary, channel switch, UTC splits, exact boundary, invalid channel, and conservative clock handling.");

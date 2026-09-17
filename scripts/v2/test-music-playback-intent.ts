import assert from "node:assert/strict";
import { MusicPlaybackIntent } from "../../app/v2/musicPlaybackIntent";

const intent = new MusicPlaybackIntent();
assert.equal(intent.wantsPlayback, false);
// A playing channel remains wanted while replacement engines publish idle snapshots.
intent.start(); assert.equal(intent.wantsPlayback, true);
assert.equal(intent.wantsPlayback, true); // B/C idle snapshots do not mutate ownership.
assert.equal(intent.wantsPlayback, true); // rapid A -> B -> C -> D preserves the request.
// A disposed engine's late play resolution/rejection has no intent API and cannot clear D.
assert.equal(intent.wantsPlayback, true);
intent.stop(); assert.equal(intent.wantsPlayback, false);
assert.equal(intent.wantsPlayback, false); // explicit pause means a later switch stays paused.
intent.start(); assert.equal(intent.wantsPlayback, true); // loading/recovery keeps the user request.
console.info("PASS: synchronous music playback intent survives rapid replacement and only explicit start/stop changes ownership.");

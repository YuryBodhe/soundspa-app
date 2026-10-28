import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "@/app/i18n/dictionaries/en";
import { ru } from "@/app/i18n/dictionaries/ru";
import { vi } from "@/app/i18n/dictionaries/vi";
import { th } from "@/app/i18n/dictionaries/th";
import { ambientChannelCardAction, mainPlayerAction, musicChannelCardAction, playerActionTranslationKey } from "./playerActionTooltip";

test("main moon action tooltip follows play, stop, and unavailable state", () => {
  assert.equal(mainPlayerAction({ hasTrack: true, canStart: true, playing: false, buffering: false }), "play");
  assert.equal(mainPlayerAction({ hasTrack: true, canStart: false, playing: true, buffering: false }), "stop");
  assert.equal(mainPlayerAction({ hasTrack: true, canStart: false, playing: false, buffering: true }), "stop");
  assert.equal(mainPlayerAction({ hasTrack: true, canStart: false, playing: false, buffering: false }), null);
  assert.equal(mainPlayerAction({ hasTrack: false, canStart: true, playing: false, buffering: false }), null);
});

test("every available music card offers play unless its active channel is already playing", () => {
  const available = { locked: false, standby: false, hasTracks: true, active: false, playing: false, buffering: false };
  assert.equal(musicChannelCardAction(available), "play");
  assert.equal(musicChannelCardAction({ ...available, active: true }), "play");
  assert.equal(musicChannelCardAction({ ...available, active: true, playing: true }), "stop");
  assert.equal(musicChannelCardAction({ ...available, active: true, buffering: true }), "stop");
  assert.equal(musicChannelCardAction({ ...available, locked: true }), null);
  assert.equal(musicChannelCardAction({ ...available, standby: true }), null);
  assert.equal(musicChannelCardAction({ ...available, hasTracks: false }), null);
});

test("one-click channel selection plays a new channel through the existing engine path", async () => {
  const source = await readFile(new URL("./V2Player.tsx", import.meta.url), "utf8");
  const selection = source.match(/const selectMusic = \(channel: PlayerChannel\) => \{([\s\S]*?)\n  \};/)?.[1] ?? "";
  assert.ok(selection);
  assert.match(selection, /channel\.playable === false \|\| !channel\.tracks\.length\) return/);
  const sameChannel = selection.match(/if \(channel\.id === activeChannelId\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(sameChannel, /toggleMusicPlayback\(\)/);
  assert.doesNotMatch(sameChannel, /replaceMusicEngine|\.play\(/);
  assert.match(selection, /if \(!canStartAudio\) return/);
  assert.match(selection, /replaceMusicEngine\(channel\.id, playlist\)/);
  assert.match(selection, /setActiveChannelId\(channel\.id\);[\s\S]*?musicWantsPlaybackRef\.current\.start\(\);\s*void engine\?\.play\(\);/);
});

test("initial player setup does not autoplay and card action matches the localized play label", async () => {
  const source = await readFile(new URL("./V2Player.tsx", import.meta.url), "utf8");
  const setup = source.match(/useEffect\(\(\) => \{\s*const initial = playableMusicChannels\[0\];([\s\S]*?)\n  \}, \[replaceMusicEngine, playableMusicChannels\]\);/)?.[1] ?? "";
  assert.ok(setup);
  assert.match(setup, /replaceMusicEngine\(initial\.id, initial\.tracks\)/);
  assert.doesNotMatch(setup, /\.play\(/);
  assert.match(source, /musicChannelCardAction\(\{ locked, standby, hasTracks: channel\.tracks\.length > 0, active, playing, buffering \}\)/);
  assert.match(source, /const togglePlayback = \(\) => \{\s*if \(activeChannel\?\.tracks\.length && engineChannelIdRef\.current === activeChannelId\) toggleMusicPlayback\(\);/);
  assert.equal(ru[playerActionTranslationKey("play")], "Воспроизвести");
  for (const dictionary of [en, ru, vi, th]) assert.ok(dictionary[playerActionTranslationKey("play")].trim());
});

test("ambient card action toggles only available playable lanes", () => {
  const available = { locked: false, standby: false, hasTracks: true, active: false };
  assert.equal(ambientChannelCardAction(available), "play");
  assert.equal(ambientChannelCardAction({ ...available, active: true }), "stop");
  assert.equal(ambientChannelCardAction({ ...available, locked: true }), null);
  assert.equal(ambientChannelCardAction({ ...available, hasTracks: false }), null);
  assert.equal(ambientChannelCardAction({ ...available, standby: true }), null);
  assert.equal(ambientChannelCardAction({ ...available, standby: true, active: true }), "stop");
});

test("play, stop, and select actions have localized labels in every player locale", () => {
  const dictionaries = [en, ru, vi, th];
  for (const dictionary of dictionaries) {
    assert.ok(dictionary[playerActionTranslationKey("play")].trim());
    assert.ok(dictionary[playerActionTranslationKey("stop")].trim());
    assert.ok(dictionary[playerActionTranslationKey("select")].trim());
  }
  assert.equal(ru.playerActionPlay, "Воспроизвести");
  assert.equal(ru.playerActionStop, "Остановить");
});

test("tooltips wait 400ms, ignore touch hover, and describe the keyboard-focusable trigger", async () => {
  const source = await readFile(new URL("./Tooltip.tsx", import.meta.url), "utf8");
  assert.match(source, /setTimeout\(\(\) => setHovered\(true\), 400\)/);
  assert.match(source, /event\.pointerType !== "touch"/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /role="tooltip"/);
});

test("player uses action-specific tooltips while locked and unavailable cards never receive play labels", async () => {
  const source = await readFile(new URL("./V2Player.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(locked\) return <Tooltip content=\{t\("lockedChannelTooltip"\)\}>\{card\}<\/Tooltip>/);
  assert.match(source, /return action \? <Tooltip content=\{t\(playerActionTranslationKey\(action\)\)\}>\{card\}<\/Tooltip> : card/);
  assert.match(source, /aria-label=\{locked \? `\$\{title\}\. \$\{t\("locked"\)\}` : action \? `\$\{t\(playerActionTranslationKey\(action\)\)\}: \$\{title\}` : title\}/);
});

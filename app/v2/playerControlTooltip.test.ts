import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../i18n/dictionaries/en";
import { ru } from "../i18n/dictionaries/ru";
import { th } from "../i18n/dictionaries/th";
import { vi } from "../i18n/dictionaries/vi";
import { ambientVolumePercent, ambientVolumeTooltipText, playbackModeTooltipKey } from "./playerControlTooltip";

const dictionaries = [en, ru, vi, th];

test("ambient volume tooltip uses the rounded slider percentage", () => {
  assert.equal(ambientVolumePercent(0.65), 65);
  assert.equal(ambientVolumePercent(0.649), 65);
  assert.equal(ambientVolumePercent(0), 0);
  assert.equal(ambientVolumePercent(1), 100);
  assert.equal(ambientVolumeTooltipText("Громкость фона", 65), "Громкость фона: 65%");
});

test("playback mode tooltips cover normal, repeat-one, and shuffle without changing mode values", () => {
  assert.equal(playbackModeTooltipKey("normal"), "playbackModeNormalTooltip");
  assert.equal(playbackModeTooltipKey("repeat-one"), "playbackModeRepeatTooltip");
  assert.equal(playbackModeTooltipKey("shuffle"), "playbackModeShuffleTooltip");
});

test("all control tooltip copy is localized in EN, RU, VI, and TH", () => {
  for (const dictionary of dictionaries) {
    for (const key of ["ambientVolumeTooltip", "playbackModeNormalTooltip", "playbackModeRepeatTooltip", "playbackModeShuffleTooltip", "playerManagementTooltip"] as const) {
      assert.ok(dictionary[key].trim(), `${key} is translated`);
    }
  }
  assert.equal(ru.ambientVolumeTooltip, "Громкость фона");
  assert.equal(ru.playbackModeNormalTooltip, "Обычный порядок");
  assert.equal(ru.playbackModeRepeatTooltip, "Повтор трека");
  assert.equal(ru.playbackModeShuffleTooltip, "Случайный порядок");
  assert.equal(ru.playerManagementTooltip, "Салоны, устройства и подписка");
});

test("player control tooltips wrap the controls and remove the duplicate playback-mode title", async () => {
  const source = await readFile(new URL("./V2Player.tsx", import.meta.url), "utf8");
  assert.match(source, /<Tooltip content=\{t\("playerManagementTooltip"\)\}>[\s\S]*?className=\{s\.managementMenuToggle\}/);
  assert.match(source, /<div className=\{s\.sliderWrap\}>[\s\S]*?<Tooltip content=\{ambientVolumeTooltipText\(t\("ambientVolumeTooltip"\), ambientVolume\)\} rootClassName=\{s\.tooltipRootContents\}>[\s\S]*?type="range"/);
  const modeTooltip = source.match(/<Tooltip content=\{t\(playbackModeTooltipKey\(playbackMode\)\)\}>[\s\S]*?<\/Tooltip>/)?.[0] ?? "";
  assert.ok(modeTooltip);
  assert.doesNotMatch(modeTooltip, /\btitle=/);
  assert.match(modeTooltip, /aria-label=\{`\$\{t\("playbackMode"\)\}: \$\{playbackModeLabel\}`\}/);
});

test("range tooltip wrapper preserves the slider positioning context", async () => {
  const stylesheet = await readFile(new URL("./v2.module.css", import.meta.url), "utf8");
  assert.match(stylesheet, /\.tooltipRootContents \{ position: static; display: contents; \}/);
  assert.match(stylesheet, /\.sliderWrap \{\s+position: relative;/);
});

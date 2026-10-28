import type { PlaybackMode } from "../lib/audio/mp3Engine";
import type { TranslationKey } from "../i18n/types";

export function playbackModeTooltipKey(mode: PlaybackMode): TranslationKey {
  if (mode === "repeat-one") return "playbackModeRepeatTooltip";
  if (mode === "shuffle") return "playbackModeShuffleTooltip";
  return "playbackModeNormalTooltip";
}

export function ambientVolumePercent(volume: number): number {
  return Math.round(volume * 100);
}

export function ambientVolumeTooltipText(label: string, percent: number): string {
  return `${label}: ${percent}%`;
}

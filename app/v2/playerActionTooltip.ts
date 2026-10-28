export type PlayerAction = "play" | "stop" | "select";

export function playerActionTranslationKey(action: PlayerAction) {
  if (action === "play") return "playerActionPlay" as const;
  if (action === "stop") return "playerActionStop" as const;
  return "playerActionSelect" as const;
}

export function mainPlayerAction(input: { hasTrack: boolean; canStart: boolean; playing: boolean; buffering: boolean }): PlayerAction | null {
  if (!input.hasTrack || (!input.canStart && !input.playing && !input.buffering)) return null;
  return input.playing || input.buffering ? "stop" : "play";
}

export function musicChannelCardAction(input: {
  locked: boolean;
  standby: boolean;
  hasTracks: boolean;
  active: boolean;
  playing: boolean;
  buffering: boolean;
}): PlayerAction | null {
  if (input.locked || input.standby || !input.hasTracks) return null;
  if (input.active && (input.playing || input.buffering)) return "stop";
  return "play";
}

export function ambientChannelCardAction(input: { locked: boolean; standby: boolean; hasTracks: boolean; active: boolean }): PlayerAction | null {
  if (input.locked || !input.hasTracks || (input.standby && !input.active)) return null;
  return input.active ? "stop" : "play";
}

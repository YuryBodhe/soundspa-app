import type { Mp3Track } from "../lib/audio/mp3Engine";

const DIVNITSA_BASE_URL = "/music/divnitsa";
const RELAX_BASE_URL = "/music/relax";

export const DIVNITSA_PLAYLIST: readonly Mp3Track[] = [
  { id: "divnitsa-01", url: `${DIVNITSA_BASE_URL}/divnitsa-mix-01.mp3` },
  { id: "divnitsa-02", url: `${DIVNITSA_BASE_URL}/divnitsa-mix-02.mp3` },
  { id: "divnitsa-03", url: `${DIVNITSA_BASE_URL}/divnitsa-mix-03.mp3` },
];

export const RELAX_PLAYLIST: readonly Mp3Track[] = [
  { id: "relax-01", url: `${RELAX_BASE_URL}/relax-mix-01.mp3` },
];

export const MUSIC_PLAYLISTS: Readonly<Partial<Record<string, readonly Mp3Track[]>>> = {
  divnitsa: DIVNITSA_PLAYLIST,
  relax: RELAX_PLAYLIST,
};

import type { Mp3Track } from "../lib/audio/mp3Engine";

const DIVNITSA_BASE_URL = "/music/divnitsa";

export const DIVNITSA_PLAYLIST: readonly Mp3Track[] = [
  { id: "divnitsa-01", url: `${DIVNITSA_BASE_URL}/divnitsa-mix-01.mp3` },
  { id: "divnitsa-02", url: `${DIVNITSA_BASE_URL}/divnitsa-mix-02.mp3` },
  { id: "divnitsa-03", url: `${DIVNITSA_BASE_URL}/divnitsa-mix-03.mp3` },
];

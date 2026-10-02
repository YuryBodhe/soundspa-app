const FALLBACK_TIME_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Moscow",
  "Africa/Johannesburg",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const REQUIRED_TIME_ZONES = ["UTC", "Asia/Ho_Chi_Minh", "Europe/Moscow", "Asia/Bangkok"];

/** Canonical IANA identifiers supported by this server's Intl implementation. */
export function getTimeZoneOptions(): string[] {
  try {
    const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
    if (supportedValuesOf) {
      return [...new Set([...supportedValuesOf("timeZone"), ...REQUIRED_TIME_ZONES])].sort((a, b) => a.localeCompare(b));
    }
  } catch {
    // Older runtimes may not expose the IANA list; use the compact international fallback.
  }
  return [...FALLBACK_TIME_ZONES];
}

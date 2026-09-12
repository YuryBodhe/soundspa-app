export function getV2DatabaseUrl(): string {
  const value = process.env.V2_DATABASE_URL;
  if (!value) throw new Error("V2_DATABASE_URL is required; DATABASE_URL is never used for V2.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("V2_DATABASE_URL must be a valid Postgres URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      decodeURIComponent(url.pathname) !== "/soundspa_v2") {
    throw new Error("V2_DATABASE_URL must target the soundspa_v2 Postgres database.");
  }
  return value;
}

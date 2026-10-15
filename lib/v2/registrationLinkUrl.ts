export function buildRegistrationLinkUrl(publicOrigin: string, token: string): string {
  const url = new URL("/register", publicOrigin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export function registrationTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get("token");
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

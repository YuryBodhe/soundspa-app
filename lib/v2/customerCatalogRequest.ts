type AuthorizedDevice = { deviceId: string; locationId: string; organizationName: string; locationName: string };

/** Device-gated catalog boundary shared by the API route and focused tests. */
export async function getCustomerCatalogForDevice<T>(
  credential: string | undefined,
  authenticate: (credential: string) => Promise<AuthorizedDevice | null>,
  loadCatalog: (locationId: string) => Promise<T>,
): Promise<{ status: number; body: Record<string, unknown>; failedDeviceId?: string }> {
  if (!credential) return { status: 401, body: { error: "Device authentication required." } };
  const device = await authenticate(credential);
  if (!device) return { status: 401, body: { error: "Device authentication failed." } };
  try {
    const channels = await loadCatalog(device.locationId);
    return { status: 200, body: { organizationName: device.organizationName, locationName: device.locationName, channels } };
  } catch {
    return { status: 503, body: { error: "Customer catalog unavailable." }, failedDeviceId: device.deviceId };
  }
}

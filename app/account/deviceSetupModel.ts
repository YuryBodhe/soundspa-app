export type DeviceSetupLocation = {
  id: string;
  devices: Array<{ state: "active" | "revoked"; activationState: "awaiting" | "activated" | "expired" | "revoked" }>;
};

export function hasActivatedDevice(locations: readonly DeviceSetupLocation[]): boolean {
  return locations.some((location) => location.devices.some((device) => device.state === "active" && device.activationState === "activated"));
}

export function selectedDeviceSetupLocationId(locations: readonly Pick<DeviceSetupLocation, "id">[], selectedId: string): string {
  return locations.some((location) => location.id === selectedId) ? selectedId : locations[0]?.id ?? "";
}

export function shouldSelectDeviceSetupLocation(locationCount: number): boolean {
  return locationCount > 1;
}

export function initialFirstDeviceName(currentName: string, localizedDefault: string): string {
  return currentName || localizedDefault;
}

export function suggestedFirstSalonName(companyName: string, currentSalonName: string, manuallyEdited: boolean): string {
  return manuallyEdited ? currentSalonName : companyName;
}

const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function currentBrowserOperationStorageKey(locationId: string): string {
  return `soundspa-v2:current-browser-device-operation:${locationId}`;
}

export function getOrCreateCurrentBrowserOperationId(
  locationId: string,
  storage: Pick<Storage, "getItem" | "setItem">,
  createId: () => string,
): string {
  const key = currentBrowserOperationStorageKey(locationId);
  const existing = storage.getItem(key);
  if (existing && OPERATION_ID_PATTERN.test(existing)) return existing;
  const operationId = createId();
  if (!OPERATION_ID_PATTERN.test(operationId)) throw new Error("Operation ID generator must return a UUID v4.");
  storage.setItem(key, operationId);
  return operationId;
}

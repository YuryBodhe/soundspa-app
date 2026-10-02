export const MONITORING_ONLINE_THRESHOLD_SECONDS = 300;

export type MonitoringLaneState = "idle" | "playing" | "paused" | "buffering" | "error";
export type MonitoringDeviceStatus = "active" | "revoked";
export type MonitoringActivationState = "pending" | "activated" | "revoked";

export interface MonitoringLaneInput {
  state: MonitoringLaneState | null;
  channelId: string | null;
  channelName: string | null;
}

export interface MonitoringDeviceInput {
  id: string;
  label: string | null;
  status: MonitoringDeviceStatus;
  activationState: MonitoringActivationState;
  lastSeenAt: Date | null;
  lastPlaybackObservedAt: Date | null;
  music: MonitoringLaneInput;
  ambient: MonitoringLaneInput;
}

export interface MonitoringLocationInput {
  id: string;
  name: string;
  archived: boolean;
  devices: MonitoringDeviceInput[];
}

export interface MonitoringOrganizationInput {
  id: string;
  name: string;
  archived: boolean;
  locations: MonitoringLocationInput[];
}

export interface MonitoringSnapshotV1 {
  asOf: string;
  onlineThresholdSeconds: 300;
  summary: {
    organizationCount: number;
    locationCount: number;
    deviceCount: number;
    onlineDeviceCount: number;
    playingDeviceCount: number;
  };
  organizations: Array<{
    id: string;
    name: string;
    archived: boolean;
    locations: Array<{
      id: string;
      name: string;
      archived: boolean;
      devices: Array<{
        id: string;
        label: string;
        status: MonitoringDeviceStatus;
        activationState: MonitoringActivationState;
        online: boolean;
        lastSeenAt: string | null;
        /** Last accepted signal reporting at least one playing lane, not a start/stop timestamp. */
        lastPlaybackObservedAt: string | null;
        playerActiveNow: boolean;
        music: MonitoringLaneInput;
        ambient: MonitoringLaneInput;
      }>;
    }>;
  }>;
}

const EMPTY_LANE: MonitoringLaneInput = { state: null, channelId: null, channelName: null };
const asIso = (value: Date | null) => value?.toISOString() ?? null;

export function resolveMonitoringChannelName(channelId: string | null, channelName: string | null): string | null {
  if (!channelId) return null;
  return channelName?.trim() || "Unknown / deleted channel";
}

export function buildMonitoringSnapshot(asOf: Date, organizations: MonitoringOrganizationInput[]): MonitoringSnapshotV1 {
  if (!Number.isFinite(asOf.getTime())) throw new TypeError("Invalid monitoring as-of timestamp");
  let locationCount = 0;
  let deviceCount = 0;
  let onlineDeviceCount = 0;
  let playingDeviceCount = 0;

  const outputOrganizations = [...organizations]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((organization) => ({
      id: organization.id,
      name: organization.name,
      archived: organization.archived,
      locations: [...organization.locations]
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((location) => {
          locationCount++;
          return {
            id: location.id,
            name: location.name,
            archived: location.archived,
            devices: [...location.devices]
              .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? "") || a.id.localeCompare(b.id))
              .map((device) => {
                deviceCount++;
                const online = device.lastSeenAt !== null
                  && asOf.getTime() - device.lastSeenAt.getTime() <= MONITORING_ONLINE_THRESHOLD_SECONDS * 1000;
                const playerActiveNow = device.music.state === "playing" || device.ambient.state === "playing";
                if (online) onlineDeviceCount++;
                if (playerActiveNow) playingDeviceCount++;
                return {
                  id: device.id,
                  label: device.label?.trim() || "Unnamed device",
                  status: device.status,
                  activationState: device.activationState,
                  online,
                  lastSeenAt: asIso(device.lastSeenAt),
                  lastPlaybackObservedAt: asIso(device.lastPlaybackObservedAt),
                  playerActiveNow,
                  music: device.music ?? EMPTY_LANE,
                  ambient: device.ambient ?? EMPTY_LANE,
                };
              }),
          };
        }),
    }));

  return {
    asOf: asOf.toISOString(),
    onlineThresholdSeconds: MONITORING_ONLINE_THRESHOLD_SECONDS,
    summary: {
      organizationCount: organizations.length,
      locationCount,
      deviceCount,
      onlineDeviceCount,
      playingDeviceCount,
    },
    organizations: outputOrganizations,
  };
}

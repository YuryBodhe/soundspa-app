import { asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { v2Db } from "../client";
import { channels, deviceCurrentState, devices, locations, organizations } from "../schema";
import { buildMonitoringSnapshot, resolveMonitoringChannelName, type MonitoringDeviceInput, type MonitoringOrganizationInput, type MonitoringSnapshotV1 } from "../monitoringSnapshotModel";

const musicChannel = alias(channels, "music_channel");
const ambientChannel = alias(channels, "ambient_channel");
type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

/** Current state only: one DB timestamp and one set-based hierarchy query. */
async function queryMonitoringSnapshot(tx: V2Transaction): Promise<MonitoringSnapshotV1> {
  const clock = await tx.execute(sql`SELECT transaction_timestamp() AS as_of`);
  const clockValue = clock.rows[0]?.as_of;
  const asOf = clockValue instanceof Date ? clockValue : new Date(String(clockValue));
  if (!Number.isFinite(asOf.getTime())) throw new Error("Monitoring clock unavailable");

  const rows = await tx.select({
    organizationId: organizations.id,
    organizationName: organizations.name,
    organizationArchivedAt: organizations.archivedAt,
    locationId: locations.id,
    locationName: locations.name,
    locationArchivedAt: locations.archivedAt,
    deviceId: devices.id,
    deviceLabel: devices.label,
    deviceStatus: devices.status,
    deviceRevokedAt: devices.revokedAt,
    credentialConfigured: sql<boolean>`${devices.credentialHash} IS NOT NULL`,
    lastSeenAt: deviceCurrentState.lastSeenAt,
    lastPlaybackObservedAt: deviceCurrentState.lastPlaybackAt,
    musicState: deviceCurrentState.musicPlaybackState,
    musicChannelId: deviceCurrentState.musicCurrentChannelId,
    musicChannelName: musicChannel.displayName,
    ambientState: deviceCurrentState.ambientPlaybackState,
    ambientChannelId: deviceCurrentState.ambientCurrentChannelId,
    ambientChannelName: ambientChannel.displayName,
  }).from(organizations)
    .leftJoin(locations, eq(locations.organizationId, organizations.id))
    .leftJoin(devices, eq(devices.locationId, locations.id))
    .leftJoin(deviceCurrentState, eq(deviceCurrentState.deviceId, devices.id))
    .leftJoin(musicChannel, eq(musicChannel.id, deviceCurrentState.musicCurrentChannelId))
    .leftJoin(ambientChannel, eq(ambientChannel.id, deviceCurrentState.ambientCurrentChannelId))
    .orderBy(asc(organizations.name), asc(organizations.id), asc(locations.name), asc(locations.id), asc(devices.label), asc(devices.id));

  const organizationMap = new Map<string, MonitoringOrganizationInput>();
  const locationMaps = new Map<string, Map<string, MonitoringOrganizationInput["locations"][number]>>();
  for (const row of rows) {
    let organization = organizationMap.get(row.organizationId);
    if (!organization) {
      organization = { id: row.organizationId, name: row.organizationName, archived: row.organizationArchivedAt !== null, locations: [] };
      organizationMap.set(organization.id, organization);
      locationMaps.set(organization.id, new Map());
    }
    if (!row.locationId) continue;
    const locationMap = locationMaps.get(organization.id)!;
    let location = locationMap.get(row.locationId);
    if (!location) {
      location = { id: row.locationId, name: row.locationName!, archived: row.locationArchivedAt !== null, devices: [] };
      locationMap.set(location.id, location);
      organization.locations.push(location);
    }
    if (!row.deviceId) continue;

    const device: MonitoringDeviceInput = {
      id: row.deviceId,
      label: row.deviceLabel,
      status: row.deviceRevokedAt || row.deviceStatus === "revoked" ? "revoked" : "active",
      activationState: row.deviceRevokedAt || row.deviceStatus === "revoked" ? "revoked" : row.credentialConfigured ? "activated" : "pending",
      lastSeenAt: row.lastSeenAt,
      lastPlaybackObservedAt: row.lastPlaybackObservedAt,
      music: {
        state: row.musicState,
        channelId: row.musicChannelId,
        channelName: resolveMonitoringChannelName(row.musicChannelId, row.musicChannelName),
      },
      ambient: {
        state: row.ambientState,
        channelId: row.ambientChannelId,
        channelName: resolveMonitoringChannelName(row.ambientChannelId, row.ambientChannelName),
      },
    };
    location.devices.push(device);
  }

  return buildMonitoringSnapshot(asOf, [...organizationMap.values()]);
}

export async function getMonitoringSnapshot(): Promise<MonitoringSnapshotV1> {
  return v2Db.transaction(queryMonitoringSnapshot, { isolationLevel: "repeatable read", accessMode: "read only" });
}

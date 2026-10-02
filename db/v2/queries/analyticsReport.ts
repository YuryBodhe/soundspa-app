import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { v2Db } from "../client";
import {
  channels,
  deviceCurrentState,
  devices,
  hourlyChannelPlayback,
  hourlyDevicePlayback,
  hourlyErrorAggregates,
  locations,
  monitoringLifecycleEvents,
  organizations,
} from "../schema";
import {
  AnalyticsReportNotFoundError,
  buildAnalyticsReport,
  calculateAnalyticsPeriod,
  validateAnalyticsScope,
  type AnalyticsPeriod,
  type AnalyticsScope,
  type AnalyticsReportV1,
  type DeviceDimension,
  type DeletedDeviceSnapshot,
  type LifecycleRecord,
} from "../analyticsReportModel";

export { AnalyticsReportNotFoundError } from "../analyticsReportModel";
export type { AnalyticsPeriod, AnalyticsScope, AnalyticsReportV1 } from "../analyticsReportModel";

const WRITTEN_LIFECYCLE_TYPES = [
  "organization_created", "organization_deleted", "location_created", "location_deleted",
  "device_created", "device_activated", "device_deleted",
] as const;
const musicChannel = alias(channels, "music_channel");
const ambientChannel = alias(channels, "ambient_channel");
type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

async function queryAnalyticsReport(tx: V2Transaction, options: { scope: AnalyticsScope; period: AnalyticsPeriod }): Promise<AnalyticsReportV1> {
  const clock = await tx.execute(sql`SELECT transaction_timestamp() AS as_of`);
  const clockValue = clock.rows[0]?.as_of;
  const asOf = clockValue instanceof Date ? clockValue : new Date(String(clockValue));
  if (!Number.isFinite(asOf.getTime())) throw new Error("Analytics report clock unavailable");
  const periodWindow = calculateAnalyticsPeriod(asOf, options.period);
  const start = new Date(periodWindow.effectiveStart);
  const end = new Date(periodWindow.effectiveEnd);

  const [organizationRows, locationRows] = await Promise.all([
    tx.select({ id: organizations.id, name: organizations.name, archivedAt: organizations.archivedAt }).from(organizations),
    tx.select({ id: locations.id, organizationId: locations.organizationId, name: locations.name, archivedAt: locations.archivedAt }).from(locations),
  ]);
  let organizationsForScope = organizationRows;
  let locationsForScope = locationRows;
  if (options.scope.type === "organization") {
    const organizationId = options.scope.organizationId;
    organizationsForScope = organizationRows.filter((organization) => organization.id === organizationId);
    locationsForScope = locationRows.filter((location) => location.organizationId === organizationId);
  } else if (options.scope.type === "location") {
    const locationId = options.scope.locationId;
    locationsForScope = locationRows.filter((location) => location.id === locationId);
    const organizationIdsForLocation = new Set(locationsForScope.map((location) => location.organizationId));
    organizationsForScope = organizationRows.filter((organization) => organizationIdsForLocation.has(organization.id));
  }

  if (options.scope.type === "organization" && organizationsForScope.length === 0) {
    throw new AnalyticsReportNotFoundError("ORGANIZATION_NOT_FOUND");
  }
  if (options.scope.type === "location" && locationsForScope.length === 0) {
    throw new AnalyticsReportNotFoundError("LOCATION_NOT_FOUND");
  }

  const locationIds = locationsForScope.map((location) => location.id);
  const currentRows = locationIds.length ? await tx.select({
    id: devices.id,
    locationId: devices.locationId,
    label: devices.label,
    status: devices.status,
    revokedAt: devices.revokedAt,
    credentialConfigured: sql<boolean>`${devices.credentialHash} IS NOT NULL`,
    lastSeenAt: deviceCurrentState.lastSeenAt,
    lastPlaybackObservedAt: deviceCurrentState.lastPlaybackAt,
    musicState: deviceCurrentState.musicPlaybackState,
    musicChannelId: deviceCurrentState.musicCurrentChannelId,
    musicChannelName: musicChannel.displayName,
    ambientState: deviceCurrentState.ambientPlaybackState,
    ambientChannelId: deviceCurrentState.ambientCurrentChannelId,
    ambientChannelName: ambientChannel.displayName,
  }).from(devices)
    .innerJoin(locations, eq(locations.id, devices.locationId))
    .leftJoin(deviceCurrentState, eq(deviceCurrentState.deviceId, devices.id))
    .leftJoin(musicChannel, eq(musicChannel.id, deviceCurrentState.musicCurrentChannelId))
    .leftJoin(ambientChannel, eq(ambientChannel.id, deviceCurrentState.ambientCurrentChannelId))
    .where(inArray(devices.locationId, locationIds)) : [];

  const deletedQuery = tx.select({
    id: monitoringLifecycleEvents.deviceId,
    deviceLabel: monitoringLifecycleEvents.deviceLabel,
    organizationId: monitoringLifecycleEvents.organizationId,
    organizationName: monitoringLifecycleEvents.organizationName,
    locationId: monitoringLifecycleEvents.locationId,
    locationName: monitoringLifecycleEvents.locationName,
    occurredAt: monitoringLifecycleEvents.occurredAt,
  }).from(monitoringLifecycleEvents).where(options.scope.type === "all"
    ? eq(monitoringLifecycleEvents.eventType, "device_deleted")
    : options.scope.type === "organization"
      ? and(eq(monitoringLifecycleEvents.eventType, "device_deleted"), eq(monitoringLifecycleEvents.organizationId, options.scope.organizationId))
      : and(eq(monitoringLifecycleEvents.eventType, "device_deleted"), eq(monitoringLifecycleEvents.locationId, options.scope.locationId)));
  const deletedRows = await deletedQuery;
  const deletedDevices: DeletedDeviceSnapshot[] = deletedRows.flatMap((row) => row.id ? [{ ...row, id: row.id }] : []);
  const currentDevices: DeviceDimension[] = currentRows.map((row) => ({
    id: row.id,
    locationId: row.locationId,
    label: row.label,
    status: row.revokedAt || row.status === "revoked" ? "revoked" : "active",
    activationState: row.revokedAt || row.status === "revoked" ? "revoked" : row.credentialConfigured ? "activated" : "pending",
    current: true,
    lastSeenAt: row.lastSeenAt,
    lastPlaybackObservedAt: row.lastPlaybackObservedAt,
    music: { state: row.musicState, channelId: row.musicChannelId, channelName: row.musicChannelName },
    ambient: { state: row.ambientState, channelId: row.ambientChannelId, channelName: row.ambientChannelName },
  }));
  const deviceIds = [...new Set([...currentDevices.map((device) => device.id), ...deletedDevices.map((device) => device.id)])];
  const scopeDeviceFilter = options.scope.type === "all" ? undefined : deviceIds.length ? inArray(hourlyDevicePlayback.deviceId, deviceIds) : null;
  const activeRows = scopeDeviceFilter === null ? [] : await tx.select().from(hourlyDevicePlayback).where(and(
    gte(hourlyDevicePlayback.bucketStart, start), lt(hourlyDevicePlayback.bucketStart, end), ...(scopeDeviceFilter ? [scopeDeviceFilter] : []),
  ));
  const channelDeviceFilter = options.scope.type === "all" ? undefined : deviceIds.length ? inArray(hourlyChannelPlayback.deviceId, deviceIds) : null;
  const channelRows = channelDeviceFilter === null ? [] : await tx.select({
    bucketStart: hourlyChannelPlayback.bucketStart,
    deviceId: hourlyChannelPlayback.deviceId,
    channelId: hourlyChannelPlayback.channelId,
    channelName: channels.displayName,
    lane: hourlyChannelPlayback.lane,
    playedSeconds: hourlyChannelPlayback.playedSeconds,
  }).from(hourlyChannelPlayback)
    .leftJoin(channels, eq(channels.id, hourlyChannelPlayback.channelId))
    .where(and(
      gte(hourlyChannelPlayback.bucketStart, start), lt(hourlyChannelPlayback.bucketStart, end), ...(channelDeviceFilter ? [channelDeviceFilter] : []),
    ));

  // Global errors have no safe customer attribution and are included only in All scope.
  const errors = options.scope.type !== "all" && deviceIds.length === 0 ? [] : await tx.select({
    bucketStart: hourlyErrorAggregates.bucketStart,
    category: hourlyErrorAggregates.category,
    code: hourlyErrorAggregates.errorCode,
    deviceId: hourlyErrorAggregates.deviceId,
    count: hourlyErrorAggregates.eventCount,
    firstSeenAt: hourlyErrorAggregates.firstSeenAt,
    lastSeenAt: hourlyErrorAggregates.lastSeenAt,
  }).from(hourlyErrorAggregates).where(and(
    gte(hourlyErrorAggregates.bucketStart, start), lt(hourlyErrorAggregates.bucketStart, end),
    ...(options.scope.type === "all" ? [] : [inArray(hourlyErrorAggregates.deviceId, deviceIds)]),
  ));
  const lifecycleScopeFilter = options.scope.type === "all" ? undefined
    : options.scope.type === "organization" ? eq(monitoringLifecycleEvents.organizationId, options.scope.organizationId)
      : eq(monitoringLifecycleEvents.locationId, options.scope.locationId);
  const lifecycleQuery = tx.select({
    eventType: monitoringLifecycleEvents.eventType,
    occurredAt: monitoringLifecycleEvents.occurredAt,
    organizationId: monitoringLifecycleEvents.organizationId,
    organizationName: monitoringLifecycleEvents.organizationName,
    locationId: monitoringLifecycleEvents.locationId,
    locationName: monitoringLifecycleEvents.locationName,
    deviceId: monitoringLifecycleEvents.deviceId,
    deviceLabel: monitoringLifecycleEvents.deviceLabel,
  }).from(monitoringLifecycleEvents).where(and(
    gte(monitoringLifecycleEvents.occurredAt, start), lt(monitoringLifecycleEvents.occurredAt, end),
    inArray(monitoringLifecycleEvents.eventType, [...WRITTEN_LIFECYCLE_TYPES]),
    ...(lifecycleScopeFilter ? [lifecycleScopeFilter] : []),
  ));
  const lifecycleRows = await lifecycleQuery;

  const lifecycleRecords: LifecycleRecord[] = lifecycleRows.map((row) => ({ ...row, eventType: row.eventType }));
  const organizationDimensions = organizationsForScope.map(({ id, name, archivedAt }) => ({ id, name, archivedAt }));
  const locationDimensions = locationsForScope.map(({ id, organizationId, name, archivedAt }) => ({ id, organizationId, name, archivedAt }));

  return buildAnalyticsReport({
    asOf,
    period: options.period,
    scope: options.scope,
    organizations: organizationDimensions,
    locations: locationDimensions,
    devices: currentDevices,
    deletedDevices,
    playerActiveBuckets: activeRows,
    channelPlaybackBuckets: channelRows,
    errorAggregates: errors,
    lifecycleRecords,
  });
}

/** Canonical read-only Gate 4E.1 report query. All timestamps use one DB clock sample. */
export async function getAnalyticsReport(options: { scope: AnalyticsScope; period: AnalyticsPeriod }): Promise<AnalyticsReportV1> {
  validateAnalyticsScope(options.scope);
  return v2Db.transaction((tx) => queryAnalyticsReport(tx, options), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

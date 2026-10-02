/** Canonical, storage-independent AnalyticsReportV1 model and materializer. */
export const ANALYTICS_PERIOD_BUCKETS = {
  "1h": 1,
  "24h": 24,
  "7d": 168,
  "30d": 720,
} as const;

export type AnalyticsPeriod = keyof typeof ANALYTICS_PERIOD_BUCKETS;
export type AnalyticsScope =
  | { type: "all" }
  | { type: "organization"; organizationId: string }
  | { type: "location"; locationId: string };

export class AnalyticsReportNotFoundError extends Error {
  readonly code: "ORGANIZATION_NOT_FOUND" | "LOCATION_NOT_FOUND";

  constructor(code: AnalyticsReportNotFoundError["code"]) {
    super(code === "ORGANIZATION_NOT_FOUND" ? "Organization not found" : "Location not found");
    this.name = "AnalyticsReportNotFoundError";
    this.code = code;
  }
}

export interface AnalyticsPeriodWindow {
  generatedAt: string;
  effectiveStart: string;
  effectiveEnd: string;
  bucketCount: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAnalyticsScope(scope: AnalyticsScope): void {
  if (scope.type === "organization" && !UUID_PATTERN.test(scope.organizationId)) {
    throw new TypeError("Invalid organization UUID");
  }
  if (scope.type === "location" && !UUID_PATTERN.test(scope.locationId)) {
    throw new TypeError("Invalid location UUID");
  }
}

export function calculateAnalyticsPeriod(asOf: Date, period: AnalyticsPeriod): AnalyticsPeriodWindow {
  if (!Number.isFinite(asOf.getTime())) throw new TypeError("Invalid report as-of time");
  const bucketCount = ANALYTICS_PERIOD_BUCKETS[period];
  if (!bucketCount) throw new TypeError("Unsupported analytics period");
  const end = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), asOf.getUTCHours());
  return {
    generatedAt: asOf.toISOString(),
    effectiveStart: new Date(end - bucketCount * 60 * 60 * 1000).toISOString(),
    effectiveEnd: new Date(end).toISOString(),
    bucketCount,
  };
}

export function isWithinAnalyticsPeriod(value: Date | string, window: Pick<AnalyticsPeriodWindow, "effectiveStart" | "effectiveEnd">): boolean {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) && time >= Date.parse(window.effectiveStart) && time < Date.parse(window.effectiveEnd);
}

export interface OrganizationDimension { id: string; name: string; archivedAt: Date | null; }
export interface LocationDimension { id: string; organizationId: string; name: string; archivedAt: Date | null; }
export interface LaneCurrentState {
  state: string | null;
  channelId: string | null;
  channelName: string | null;
}
export interface DeviceDimension {
  id: string;
  locationId: string;
  label: string | null;
  status: "active" | "revoked" | "deleted" | "unknown";
  activationState: "pending" | "activated" | "revoked" | "deleted" | "unknown";
  current: boolean;
  lastSeenAt: Date | null;
  lastPlaybackObservedAt: Date | null;
  music: LaneCurrentState;
  ambient: LaneCurrentState;
}
export interface DeletedDeviceSnapshot {
  id: string;
  deviceLabel: string | null;
  organizationId: string | null;
  organizationName: string | null;
  locationId: string | null;
  locationName: string | null;
  occurredAt: Date;
}
export interface PlayerActiveBucket { bucketStart: Date; deviceId: string; activePlaybackSeconds: number; }
export interface ChannelPlaybackBucket {
  bucketStart: Date;
  deviceId: string;
  channelId: string;
  channelName: string | null;
  lane: "music" | "ambient";
  playedSeconds: number;
}
export interface ErrorAggregate {
  bucketStart: Date;
  category: string;
  code: string;
  deviceId: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
export interface LifecycleRecord {
  eventType: string;
  occurredAt: Date;
  organizationId: string | null;
  organizationName: string | null;
  locationId: string | null;
  locationName: string | null;
  deviceId: string | null;
  deviceLabel: string | null;
}

export interface AnalyticsReportInput {
  asOf: Date;
  period: AnalyticsPeriod;
  scope: AnalyticsScope;
  organizations: OrganizationDimension[];
  locations: LocationDimension[];
  devices: DeviceDimension[];
  deletedDevices: DeletedDeviceSnapshot[];
  playerActiveBuckets: PlayerActiveBucket[];
  channelPlaybackBuckets: ChannelPlaybackBucket[];
  errorAggregates: ErrorAggregate[];
  lifecycleRecords: LifecycleRecord[];
}

export interface AnalyticsReportV1 {
  metadata: {
    version: 1;
    generatedAt: string;
    scope: AnalyticsScope;
    requestedPeriod: AnalyticsPeriod;
    effectiveStart: string;
    effectiveEnd: string;
    timezone: "UTC";
    granularity: "hour";
    interval: "[effectiveStart, effectiveEnd)";
  };
  summary: {
    organizationCount: number;
    locationCount: number;
    deviceCount: number;
    onlineDeviceCount: number;
    playerActiveSeconds: number;
    musicSeconds: number;
    ambientSeconds: number;
    errorCount: number;
  };
  locations: Array<{
    organizationId: string | null;
    organizationName: string | null;
    locationId: string;
    locationName: string;
    status: "current" | "archived" | "deleted" | "unknown";
    playerActiveSeconds: number;
    musicSeconds: number;
    ambientSeconds: number;
    deviceCount: number;
    onlineDeviceCount: number;
    lastSeen: string | null;
    lastPlaybackObserved: string | null;
  }>;
  musicUsage: Array<{ channelId: string; channelName: string; playedSeconds: number }>;
  ambientUsage: Array<{ channelId: string; channelName: string; playedSeconds: number }>;
  devices: Array<{
    organizationId: string | null;
    organizationName: string | null;
    locationId: string | null;
    locationName: string | null;
    deviceId: string;
    deviceLabel: string;
    deviceStatus: DeviceDimension["status"];
    activationState: DeviceDimension["activationState"];
    online: boolean;
    lastSeen: string | null;
    lastPlaybackObserved: string | null;
    currentMusic: { state: string | null; channelId: string | null; channelName: string | null };
    currentAmbient: { state: string | null; channelId: string | null; channelName: string | null };
    playerActiveSeconds: number;
  }>;
  reliability: {
    totalErrors: number;
    affectedDeviceCount: number;
    byCode: Array<{ category: string; code: string; count: number; firstSeen: string; lastSeen: string; affectedDeviceCount: number }>;
  };
  lifecycle: { byType: Array<{ eventType: string; count: number }> };
  dataQuality: {
    hourlyGranularity: string;
    accountingCaveat: string;
    channelTimelineCaveat: string;
    unattributedPlayerActiveSeconds: number;
    unattributedChannelSeconds: number;
    notes: string[];
  };
}

const WRITTEN_LIFECYCLE_TYPES = [
  "organization_created", "organization_deleted", "location_created", "location_deleted",
  "device_created", "device_activated", "device_deleted",
] as const;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const iso = (date: Date | null | undefined) => date ? date.toISOString() : null;
const emptyLane: LaneCurrentState = { state: null, channelId: null, channelName: null };
const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);

export function buildAnalyticsReport(input: AnalyticsReportInput): AnalyticsReportV1 {
  validateAnalyticsScope(input.scope);
  const window = calculateAnalyticsPeriod(input.asOf, input.period);
  const orgById = new Map(input.organizations.map((org) => [org.id, org]));
  const locationById = new Map(input.locations.map((location) => [location.id, location]));

  let scopedOrganizations: OrganizationDimension[];
  let scopedLocations: LocationDimension[];
  if (input.scope.type === "all") {
    scopedOrganizations = [...input.organizations];
    scopedLocations = [...input.locations];
  } else if (input.scope.type === "organization") {
    const organization = orgById.get(input.scope.organizationId);
    if (!organization) throw new AnalyticsReportNotFoundError("ORGANIZATION_NOT_FOUND");
    scopedOrganizations = [organization];
    scopedLocations = input.locations.filter((location) => location.organizationId === organization.id);
  } else {
    const location = locationById.get(input.scope.locationId);
    if (!location) throw new AnalyticsReportNotFoundError("LOCATION_NOT_FOUND");
    const organization = orgById.get(location.organizationId);
    if (!organization) throw new AnalyticsReportNotFoundError("LOCATION_NOT_FOUND");
    scopedOrganizations = [organization];
    scopedLocations = [location];
  }

  const scopedOrgIds = new Set(scopedOrganizations.map((org) => org.id));
  const scopedLocationIds = new Set(scopedLocations.map((location) => location.id));
  const currentDevices = input.devices.filter((device) => scopedLocationIds.has(device.locationId));
  const deviceById = new Map(currentDevices.map((device) => [device.id, device]));
  const deletedById = new Map<string, DeletedDeviceSnapshot>();
  for (const snapshot of input.deletedDevices) {
    const belongs = input.scope.type === "all"
      || (input.scope.type === "organization" && snapshot.organizationId === input.scope.organizationId)
      || (input.scope.type === "location" && snapshot.locationId === input.scope.locationId);
    if (belongs && !deviceById.has(snapshot.id)) {
      const previous = deletedById.get(snapshot.id);
      if (!previous || snapshot.occurredAt > previous.occurredAt) deletedById.set(snapshot.id, snapshot);
    }
  }

  const includeDevice = (id: string) => input.scope.type === "all" || deviceById.has(id) || deletedById.has(id);
  const activeByDevice = new Map<string, number>();
  for (const row of input.playerActiveBuckets) {
    if (isWithinAnalyticsPeriod(row.bucketStart, window) && includeDevice(row.deviceId)) {
      add(activeByDevice, row.deviceId, row.activePlaybackSeconds);
    }
  }
  const channelsByKey = new Map<string, { channelId: string; channelName: string; lane: "music" | "ambient"; seconds: number }>();
  const channelByDeviceLane = new Map<string, number>();
  for (const row of input.channelPlaybackBuckets) {
    if (!isWithinAnalyticsPeriod(row.bucketStart, window) || !includeDevice(row.deviceId)) continue;
    const key = `${row.lane}:${row.channelId}`;
    const current = channelsByKey.get(key) ?? {
      channelId: row.channelId,
      channelName: row.channelName?.trim() || "Unknown / deleted channel",
      lane: row.lane,
      seconds: 0,
    };
    current.seconds += row.playedSeconds;
    channelsByKey.set(key, current);
    add(channelByDeviceLane, `${row.deviceId}:${row.lane}`, row.playedSeconds);
  }

  const unknownIds = new Set<string>();
  for (const id of [...activeByDevice.keys(), ...[...channelByDeviceLane.keys()].map((key) => key.slice(0, key.lastIndexOf(":")))]) {
    if (!deviceById.has(id) && !deletedById.has(id)) unknownIds.add(id);
  }

  const deletedWithActivity = new Map([...deletedById].filter(([id]) => activeByDevice.has(id)
    || channelByDeviceLane.has(`${id}:music`) || channelByDeviceLane.has(`${id}:ambient`)));
  const reportDeviceIds = new Set([...currentDevices.map((device) => device.id), ...deletedWithActivity.keys(), ...unknownIds]);
  const locationSnapshots = new Map<string, { id: string; organizationId: string | null; name: string; deleted: boolean }>();
  for (const location of scopedLocations) locationSnapshots.set(location.id, { id: location.id, organizationId: location.organizationId, name: location.name, deleted: false });
  const orgSnapshotNames = new Map(scopedOrganizations.map((org) => [org.id, org.name]));
  for (const snapshot of deletedWithActivity.values()) {
    if (snapshot.locationId && !locationSnapshots.has(snapshot.locationId)) {
      locationSnapshots.set(snapshot.locationId, { id: snapshot.locationId, organizationId: snapshot.organizationId, name: snapshot.locationName || "Deleted location", deleted: true });
    }
    if (snapshot.organizationId && snapshot.organizationName && !orgSnapshotNames.has(snapshot.organizationId)) {
      orgSnapshotNames.set(snapshot.organizationId, snapshot.organizationName);
    }
  }

  const locationActive = new Map<string, number>();
  const locationChannel = new Map<string, number>();
  for (const [deviceId, seconds] of activeByDevice) {
    const locationId = deviceById.get(deviceId)?.locationId ?? deletedById.get(deviceId)?.locationId ?? null;
    if (locationId) add(locationActive, locationId, seconds);
  }
  for (const [deviceLane, seconds] of channelByDeviceLane) {
    const deviceId = deviceLane.slice(0, deviceLane.lastIndexOf(":"));
    const locationId = deviceById.get(deviceId)?.locationId ?? deletedById.get(deviceId)?.locationId ?? null;
    if (locationId) add(locationChannel, `${locationId}:${deviceLane.slice(deviceLane.lastIndexOf(":") + 1)}`, seconds);
  }

  const locationCurrentDevices = new Map<string, DeviceDimension[]>();
  for (const device of currentDevices) {
    const list = locationCurrentDevices.get(device.locationId) ?? [];
    list.push(device);
    locationCurrentDevices.set(device.locationId, list);
  }
  const locationAttributedDeviceIds = new Map<string, Set<string>>();
  for (const id of reportDeviceIds) {
    const locationId = deviceById.get(id)?.locationId ?? deletedById.get(id)?.locationId;
    if (!locationId) continue;
    const ids = locationAttributedDeviceIds.get(locationId) ?? new Set<string>();
    ids.add(id);
    locationAttributedDeviceIds.set(locationId, ids);
  }

  const onlineAt = (lastSeen: Date | null) => {
    if (!lastSeen) return false;
    const age = input.asOf.getTime() - lastSeen.getTime();
    return age >= 0 && age <= ONLINE_WINDOW_MS;
  };
  const dateMax = (dates: Array<Date | null>) => dates.filter((date): date is Date => Boolean(date)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const devices = [...reportDeviceIds].map((id) => {
    const current = deviceById.get(id);
    const deleted = deletedById.get(id);
    const unknown = !current && !deleted;
    const locationId = current?.locationId ?? deleted?.locationId ?? null;
    const location = locationId ? locationSnapshots.get(locationId) ?? locationById.get(locationId) : undefined;
    const orgId = location?.organizationId ?? deleted?.organizationId ?? null;
    const organizationName = orgId ? orgSnapshotNames.get(orgId) ?? orgById.get(orgId)?.name ?? deleted?.organizationName ?? null : null;
    return {
      organizationId: orgId,
      organizationName,
      locationId,
      locationName: location?.name ?? deleted?.locationName ?? null,
      deviceId: id,
      deviceLabel: current?.label?.trim() || deleted?.deviceLabel?.trim() || (unknown ? "Unknown / deleted Device" : "Unnamed device"),
      deviceStatus: current?.status ?? (deleted ? "deleted" as const : "unknown" as const),
      activationState: current?.activationState ?? (deleted ? "deleted" as const : "unknown" as const),
      online: current ? onlineAt(current.lastSeenAt) : false,
      lastSeen: iso(current?.lastSeenAt),
      lastPlaybackObserved: iso(current?.lastPlaybackObservedAt),
      currentMusic: current?.music ?? emptyLane,
      currentAmbient: current?.ambient ?? emptyLane,
      playerActiveSeconds: activeByDevice.get(id) ?? 0,
    };
  }).sort((a, b) => (a.organizationName ?? "").localeCompare(b.organizationName ?? "") || (a.locationName ?? "").localeCompare(b.locationName ?? "") || a.deviceLabel.localeCompare(b.deviceLabel) || a.deviceId.localeCompare(b.deviceId));

  const locations = [...locationSnapshots.values()].map((location) => {
    const attributedIds = locationAttributedDeviceIds.get(location.id) ?? new Set<string>();
    const current = locationCurrentDevices.get(location.id) ?? [];
    const orgId = location.organizationId;
    return {
      organizationId: orgId,
      organizationName: orgId ? orgSnapshotNames.get(orgId) ?? orgById.get(orgId)?.name ?? null : null,
      locationId: location.id,
      locationName: location.name,
      status: location.deleted ? "deleted" as const : locationById.get(location.id)?.archivedAt ? "archived" as const : locationById.has(location.id) ? "current" as const : "unknown" as const,
      playerActiveSeconds: locationActive.get(location.id) ?? 0,
      musicSeconds: locationChannel.get(`${location.id}:music`) ?? 0,
      ambientSeconds: locationChannel.get(`${location.id}:ambient`) ?? 0,
      deviceCount: new Set([...current.map((device) => device.id), ...attributedIds]).size,
      onlineDeviceCount: current.filter((device) => onlineAt(device.lastSeenAt)).length,
      lastSeen: iso(dateMax(current.map((device) => device.lastSeenAt))),
      lastPlaybackObserved: iso(dateMax(current.map((device) => device.lastPlaybackObservedAt))),
    };
  }).sort((a, b) => (a.organizationName ?? "").localeCompare(b.organizationName ?? "") || a.locationName.localeCompare(b.locationName) || a.locationId.localeCompare(b.locationId));

  const usage = (lane: "music" | "ambient") => [...channelsByKey.values()]
    .filter((entry) => entry.lane === lane)
    .map(({ channelId, channelName, seconds }) => ({ channelId, channelName, playedSeconds: seconds }))
    .sort((a, b) => b.playedSeconds - a.playedSeconds || a.channelName.localeCompare(b.channelName) || a.channelId.localeCompare(b.channelId));
  const musicUsage = usage("music");
  const ambientUsage = usage("ambient");
  const playerActiveSeconds = devices.reduce((sum, device) => sum + device.playerActiveSeconds, 0);
  const musicSeconds = musicUsage.reduce((sum, entry) => sum + entry.playedSeconds, 0);
  const ambientSeconds = ambientUsage.reduce((sum, entry) => sum + entry.playedSeconds, 0);

  const scopedErrors = input.errorAggregates.filter((row) => isWithinAnalyticsPeriod(row.bucketStart, window) && (
    row.deviceId ? includeDevice(row.deviceId) : input.scope.type === "all"
  ));
  const errorGroups = new Map<string, { category: string; code: string; count: number; firstSeen: Date; lastSeen: Date; ids: Set<string> }>();
  for (const row of scopedErrors) {
    const key = `${row.category}:${row.code}`;
    const group = errorGroups.get(key) ?? { category: row.category, code: row.code, count: 0, firstSeen: row.firstSeenAt, lastSeen: row.lastSeenAt, ids: new Set<string>() };
    group.count += row.count;
    if (row.firstSeenAt < group.firstSeen) group.firstSeen = row.firstSeenAt;
    if (row.lastSeenAt > group.lastSeen) group.lastSeen = row.lastSeenAt;
    if (row.deviceId) group.ids.add(row.deviceId);
    errorGroups.set(key, group);
  }
  const byCode = [...errorGroups.values()].map((group) => ({
    category: group.category,
    code: group.code,
    count: group.count,
    firstSeen: group.firstSeen.toISOString(),
    lastSeen: group.lastSeen.toISOString(),
    affectedDeviceCount: group.ids.size,
  })).sort((a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code));
  const totalErrors = byCode.reduce((sum, group) => sum + group.count, 0);
  const affectedDeviceCount = new Set(scopedErrors.flatMap((row) => row.deviceId ? [row.deviceId] : [])).size;

  const lifecycleCounts = new Map<string, number>();
  for (const event of input.lifecycleRecords) {
    if (!WRITTEN_LIFECYCLE_TYPES.includes(event.eventType as typeof WRITTEN_LIFECYCLE_TYPES[number])) continue;
    if (!isWithinAnalyticsPeriod(event.occurredAt, window)) continue;
    const inScope = input.scope.type === "all"
      || (input.scope.type === "organization" && event.organizationId === input.scope.organizationId)
      || (input.scope.type === "location" && event.locationId === input.scope.locationId);
    if (inScope) add(lifecycleCounts, event.eventType, 1);
  }

  const unattributedPlayerActiveSeconds = [...unknownIds].reduce((sum, id) => sum + (activeByDevice.get(id) ?? 0), 0);
  const unattributedChannelSeconds = [...unknownIds].reduce((sum, id) => sum + (channelByDeviceLane.get(`${id}:music`) ?? 0) + (channelByDeviceLane.get(`${id}:ambient`) ?? 0), 0);
  const notes = ["Entity counts include current rows in scope plus deleted/unknown historical identities represented by retained usage in the selected period."];
  if (unknownIds.size) notes.push("Some retained usage belongs to device IDs without a current Device or a usable deletion snapshot; it is retained as Unknown / deleted Device and is not attributed to a Location.");
  if (input.scope.type !== "all") notes.push("Device activity without a current Device or a deletion snapshot cannot be safely assigned to this scope and is omitted from its totals; use All scope to inspect unattributed retained rows.");
  notes.push("Global error aggregates without a Device ID are included only in All scope because they cannot be safely attributed to a customer.");

  return {
    metadata: { version: 1, generatedAt: window.generatedAt, scope: input.scope, requestedPeriod: input.period, effectiveStart: window.effectiveStart, effectiveEnd: window.effectiveEnd, timezone: "UTC", granularity: "hour", interval: "[effectiveStart, effectiveEnd)" },
    summary: {
      organizationCount: new Set([...scopedOrganizations.map((org) => org.id), ...[...deletedWithActivity.values()].flatMap((item) => item.organizationId ? [item.organizationId] : [])]).size,
      locationCount: locations.length,
      deviceCount: devices.length,
      onlineDeviceCount: devices.filter((device) => device.online).length,
      playerActiveSeconds,
      musicSeconds,
      ambientSeconds,
      errorCount: totalErrors,
    },
    locations,
    musicUsage,
    ambientUsage,
    devices,
    reliability: { totalErrors, affectedDeviceCount, byCode },
    lifecycle: { byType: [...lifecycleCounts.entries()].map(([eventType, count]) => ({ eventType, count })).sort((a, b) => a.eventType.localeCompare(b.eventType)) },
    dataQuality: {
      hourlyGranularity: "Usage is reported in completed UTC hour buckets, not as an exact event timeline.",
      accountingCaveat: "Monitoring accounting may be delayed until the next accepted snapshot and is capped at 180 seconds per accounting interval; interruptions can therefore undercount activity. lastPlaybackObserved is the last accepted monitoring signal reporting at least one playing lane, not an exact playback start/stop time.",
      channelTimelineCaveat: "Channel usage is aggregated by UTC hour; exact channel-switch timestamps are not available.",
      unattributedPlayerActiveSeconds,
      unattributedChannelSeconds,
      notes,
    },
  };
}

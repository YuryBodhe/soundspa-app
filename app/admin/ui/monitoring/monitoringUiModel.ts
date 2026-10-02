import type { MonitoringSnapshotV1 } from "../../../../db/v2/monitoringSnapshotModel";

export type MonitoringLocationStatus = "Online" | "Partially Online" | "Offline" | "No Devices";
export type MonitoringFilter = "all" | "offline" | "not-playing" | "playing" | "partially-online";

export interface MonitoringLocationRow {
  organizationId: string;
  organizationName: string;
  location: MonitoringSnapshotV1["organizations"][number]["locations"][number];
  deviceCount: number;
  onlineCount: number;
  playingCount: number;
  lastSeenAt: string | null;
  status: MonitoringLocationStatus;
  priority: number;
}

export function getMonitoringLocationStatus(deviceCount: number, onlineCount: number): MonitoringLocationStatus {
  if (deviceCount === 0) return "No Devices";
  if (onlineCount === 0) return "Offline";
  if (onlineCount < deviceCount) return "Partially Online";
  return "Online";
}

export function buildMonitoringLocationRows(snapshot: MonitoringSnapshotV1): MonitoringLocationRow[] {
  const rows = snapshot.organizations.flatMap((organization) => organization.locations.map((location) => {
    const deviceCount = location.devices.length;
    const onlineCount = location.devices.filter((device) => device.online).length;
    const playingCount = location.devices.filter((device) => device.playerActiveNow).length;
    const status = getMonitoringLocationStatus(deviceCount, onlineCount);
    const priority = status === "Offline" ? 0
      : status === "Partially Online" ? 1
      : status === "Online" && playingCount === 0 ? 2
      : status === "Online" ? 3
      : 4;
    const lastSeenAt = location.devices
      .map((device) => device.lastSeenAt)
      .filter((value): value is string => value !== null)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

    return { organizationId: organization.id, organizationName: organization.name, location, deviceCount, onlineCount, playingCount, lastSeenAt, status, priority };
  }));

  return rows.sort((a, b) => a.priority - b.priority
    || a.organizationName.localeCompare(b.organizationName)
    || a.location.name.localeCompare(b.location.name)
    || a.location.id.localeCompare(b.location.id));
}

export function filterMonitoringLocations(
  rows: MonitoringLocationRow[],
  query: string,
  filter: MonitoringFilter,
): MonitoringLocationRow[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    const matchesQuery = !needle || [row.organizationName, row.location.name, ...row.location.devices.map((device) => device.label)]
      .some((value) => value.toLocaleLowerCase().includes(needle));
    const matchesFilter = filter === "all"
      || (filter === "offline" && row.status === "Offline")
      || (filter === "not-playing" && row.playingCount === 0)
      || (filter === "playing" && row.playingCount > 0)
      || (filter === "partially-online" && row.status === "Partially Online");
    return matchesQuery && matchesFilter;
  });
}

export function formatMonitoringRelativeTime(value: string | null, asOf: string): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  const reference = Date.parse(asOf);
  if (!Number.isFinite(timestamp) || !Number.isFinite(reference)) return "Unknown";
  const seconds = Math.max(0, Math.floor((reference - timestamp) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours} h ${remainingMinutes} min ago` : `${hours} h ago`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} d ${remainingHours} h ago` : `${days} d ago`;
}

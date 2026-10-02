import type { AnalyticsReportV1, AnalyticsScope } from "../../../../db/v2/analyticsReportModel";

export function formatAnalyticsDuration(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remainder = seconds % 60;
    return remainder ? `${minutes} min ${remainder} sec` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder ? `${days} d ${remainder} h` : `${days} d`;
}

export function formatAnalyticsRelativeTime(value: string | null, asOf: string): string {
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

export function formatAnalyticsScope(scope: AnalyticsScope, options: { organizations: Array<{ id: string; name: string }>; locations: Array<{ id: string; name: string; organizationId: string }> }): string {
  if (scope.type === "all") return "All Organizations";
  if (scope.type === "organization") return options.organizations.find((row) => row.id === scope.organizationId)?.name ?? "Organization no longer available";
  const location = options.locations.find((row) => row.id === scope.locationId);
  if (!location) return "Location no longer available";
  const organization = options.organizations.find((row) => row.id === location.organizationId)?.name;
  return organization ? `${location.name} · ${organization}` : location.name;
}

export function formatAnalyticsUtc(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function currentLaneDisplay(lane: AnalyticsReportV1["devices"][number]["currentMusic"], online: boolean): string {
  const value = lane.state
    ? `${lane.state}${lane.channelName ? ` · ${lane.channelName}` : lane.channelId ? " · Unknown / deleted channel" : ""}`
    : "No state recorded";
  return online ? value : `Last known · ${value}`;
}

export function lifecycleEventLabel(eventType: string): string {
  return eventType.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

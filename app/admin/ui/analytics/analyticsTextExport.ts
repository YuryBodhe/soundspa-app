import type { AnalyticsReportV1 } from "../../../../db/v2/analyticsReportModel";
import { currentLaneDisplay, formatAnalyticsDuration, formatAnalyticsUtc, lifecycleEventLabel } from "./analyticsPresentation";

function cleanText(value: string | null | undefined, fallback = "—"): string {
  const cleaned = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function scopeLabel(report: AnalyticsReportV1): string {
  if (report.metadata.scope.type === "all") return "All Organizations";
  if (report.metadata.scope.type === "organization") {
    return cleanText(report.locations.find((location) => location.organizationName)?.organizationName, "Organization");
  }
  const location = report.locations[0];
  if (!location) return "Location";
  const organization = cleanText(location.organizationName, "");
  return organization ? `${cleanText(location.locationName)} · ${organization}` : cleanText(location.locationName);
}

function scopeFilenameName(report: AnalyticsReportV1): string {
  if (report.metadata.scope.type === "all") return "All";
  if (report.metadata.scope.type === "organization") {
    return cleanText(report.locations.find((location) => location.organizationName)?.organizationName, "Organization");
  }
  return cleanText(report.locations[0]?.locationName, "Location");
}

function filenamePart(value: string): string {
  const result = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48).replace(/_+$/g, "");
  return result || "Scope";
}

function reportDate(report: AnalyticsReportV1): string {
  const timestamp = Date.parse(report.metadata.generatedAt);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "unknown-date";
}

export function formatAnalyticsReportFilename(report: AnalyticsReportV1): string {
  const safeScope = filenamePart(scopeFilenameName(report));
  return `SoundSpa_Report_${safeScope}_${reportDate(report)}_${report.metadata.requestedPeriod}.txt`;
}

export function formatAnalyticsReportText(report: AnalyticsReportV1): string {
  const scope = scopeLabel(report);
  const lines: string[] = [
    "SOUNDSPA ANALYTICS REPORT",
    "=========================",
    "",
    `Scope: ${scope}`,
    `Period: ${report.metadata.requestedPeriod}`,
    `Effective interval: ${formatAnalyticsUtc(report.metadata.effectiveStart)} — ${formatAnalyticsUtc(report.metadata.effectiveEnd)}`,
    `Generated: ${formatAnalyticsUtc(report.metadata.generatedAt)}`,
    `Timezone: ${report.metadata.timezone}`,
    `Granularity: ${report.metadata.granularity}`,
    `Interval convention: ${report.metadata.interval}`,
    "",
    "SUMMARY",
    "-------",
    `Organizations: ${report.summary.organizationCount}`,
    `Locations: ${report.summary.locationCount}`,
    `Devices: ${report.summary.deviceCount}`,
    `Online devices: ${report.summary.onlineDeviceCount}`,
    `Player Active: ${formatAnalyticsDuration(report.summary.playerActiveSeconds)}`,
    `Music: ${formatAnalyticsDuration(report.summary.musicSeconds)}`,
    `Ambient: ${formatAnalyticsDuration(report.summary.ambientSeconds)}`,
    `Errors: ${report.summary.errorCount}`,
    "",
    "LOCATIONS",
    "---------",
  ];

  if (report.locations.length) {
    for (const location of report.locations) {
      lines.push(
        `${cleanText(location.locationName)} — ${cleanText(location.organizationName, "Unknown Organization")} [${location.status}]`,
        `  Devices: ${location.deviceCount}; online: ${location.onlineDeviceCount}`,
        `  Player Active: ${formatAnalyticsDuration(location.playerActiveSeconds)}; Music: ${formatAnalyticsDuration(location.musicSeconds)}; Ambient: ${formatAnalyticsDuration(location.ambientSeconds)}`,
        `  Last seen: ${location.lastSeen ? formatAnalyticsUtc(location.lastSeen) : "—"}; last playback: ${location.lastPlaybackObserved ? formatAnalyticsUtc(location.lastPlaybackObserved) : "—"}`,
      );
    }
  } else {
    lines.push("No Locations in this report.");
  }

  lines.push("", "MUSIC USAGE", "-----------");
  if (report.musicUsage.length) {
    for (const row of report.musicUsage) lines.push(`${cleanText(row.channelName)}: ${formatAnalyticsDuration(row.playedSeconds)}`);
  } else {
    lines.push("No music usage during this period.");
  }

  lines.push("", "AMBIENT USAGE", "-------------");
  if (report.ambientUsage.length) {
    for (const row of report.ambientUsage) lines.push(`${cleanText(row.channelName)}: ${formatAnalyticsDuration(row.playedSeconds)}`);
  } else {
    lines.push("No ambient usage during this period.");
  }

  lines.push("", "DEVICES", "-------");
  if (report.devices.length) {
    for (const device of report.devices) {
      lines.push(
        `${cleanText(device.deviceLabel)} — ${device.online ? "Online" : "Offline"}; ${device.deviceStatus}; activation ${device.activationState}`,
        `  Location: ${cleanText(device.locationName)}; Organization: ${cleanText(device.organizationName)}`,
        `  Player Active during period: ${formatAnalyticsDuration(device.playerActiveSeconds)}`,
        `  Current Music: ${cleanText(currentLaneDisplay(device.currentMusic, device.online))}`,
        `  Current Ambient: ${cleanText(currentLaneDisplay(device.currentAmbient, device.online))}`,
        `  Last seen: ${device.lastSeen ? formatAnalyticsUtc(device.lastSeen) : "—"}; last reported playback: ${device.lastPlaybackObserved ? formatAnalyticsUtc(device.lastPlaybackObserved) : "—"}`,
      );
    }
  } else {
    lines.push("No Devices in this report.");
  }

  lines.push("", "RELIABILITY", "-----------", `Total errors: ${report.reliability.totalErrors}`, `Affected Devices: ${report.reliability.affectedDeviceCount}`);
  if (report.reliability.byCode.length) {
    for (const row of report.reliability.byCode) {
      lines.push(`${cleanText(row.category)} / ${cleanText(row.code)}: ${row.count}; affected Devices: ${row.affectedDeviceCount}; first: ${formatAnalyticsUtc(row.firstSeen)}; last: ${formatAnalyticsUtc(row.lastSeen)}`);
    }
  } else {
    lines.push("No reported errors during this period.");
  }

  lines.push("", "LIFECYCLE", "---------");
  if (report.lifecycle.byType.length) {
    for (const row of report.lifecycle.byType) lines.push(`${lifecycleEventLabel(cleanText(row.eventType))}: ${row.count}`);
  } else {
    lines.push("No reported lifecycle events during this period.");
  }

  lines.push(
    "",
    "DATA QUALITY",
    "------------",
    cleanText(report.dataQuality.hourlyGranularity),
    "Music and Ambient are independent lanes; their combined totals can exceed Player Active.",
    cleanText(report.dataQuality.channelTimelineCaveat),
    cleanText(report.dataQuality.accountingCaveat),
    `Unattributed Player Active: ${formatAnalyticsDuration(report.dataQuality.unattributedPlayerActiveSeconds)}`,
    `Unattributed channel time: ${formatAnalyticsDuration(report.dataQuality.unattributedChannelSeconds)}`,
  );
  for (const note of report.dataQuality.notes) lines.push(`Note: ${cleanText(note)}`);
  return `${lines.join("\n")}\n`;
}

export function createAnalyticsTextDownload(report: AnalyticsReportV1) {
  return { filename: formatAnalyticsReportFilename(report), text: formatAnalyticsReportText(report), mimeType: "text/plain;charset=utf-8" } as const;
}

export function triggerAnalyticsTextDownload(report: AnalyticsReportV1): void {
  const download = createAnalyticsTextDownload(report);
  const objectUrl = URL.createObjectURL(new Blob([download.text], { type: download.mimeType }));
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = download.filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

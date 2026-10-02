"use client";

import Link from "next/link";
import type { MonitoringSnapshotV1 } from "../../../../../../db/v2/monitoringSnapshotModel";
import { formatMonitoringRelativeTime, getMonitoringLocationStatus } from "../../monitoringUiModel";
import { useMonitoringSnapshot } from "../../useMonitoringSnapshot";

type Lane = { state: string | null; channelId: string | null; channelName: string | null };

function laneValue(lane: Lane) {
  if (!lane.state) return "No monitoring state";
  return `${lane.state}${lane.channelName ? ` — ${lane.channelName}` : lane.channelId ? " — Unknown / deleted channel" : ""}`;
}

function exactTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "No signal recorded";
}

export default function MonitoringLocationDetail({ initialSnapshot, locationId }: { initialSnapshot: MonitoringSnapshotV1; locationId: string }) {
  const { snapshot, refreshing, refreshError, refresh } = useMonitoringSnapshot(initialSnapshot);
  const organization = snapshot.organizations.find((item) => item.locations.some((location) => location.id === locationId));
  const location = organization?.locations.find((item) => item.id === locationId);
  if (!organization || !location) return <section role="status" className="admin-card text-dim">This Location is no longer available in the current snapshot.</section>;

  const deviceCount = location.devices.length;
  const onlineCount = location.devices.filter((device) => device.online).length;
  const playingCount = location.devices.filter((device) => device.playerActiveNow).length;
  const status = getMonitoringLocationStatus(deviceCount, onlineCount);

  return <>
    <div className="admin-page-header">
      <div>
        <p className="monitoring-eyebrow">LOCATION MONITORING</p>
        <h1 className="admin-page-title">{location.name}</h1>
        <p className="text-dim">{organization.name} · Snapshot at <time dateTime={snapshot.asOf}>{snapshot.asOf.replace("T", " ").replace(".000Z", " UTC")}</time></p>
        <p className="monitoring-refresh-note" role="status" aria-live="polite">
          {refreshing ? "Updating snapshot…" : refreshError ? "Refresh failed · showing last snapshot" : "Automatic refresh every 60 seconds"}
        </p>
      </div>
      <div className="admin-page-nav">
        <Link href="/admin/ui/monitoring" className="btn btn-sm">Back to Monitoring</Link>
        <button className="btn btn-sm" type="button" onClick={() => { void refresh(); }} disabled={refreshing}>Refresh</button>
      </div>
    </div>

    <section className="monitoring-summary monitoring-detail-summary" aria-label="Location status summary">
      <SummaryItem label="Status" value={status} tone={status === "Online" ? "online" : status === "Partially Online" ? "partial" : status === "No Devices" ? undefined : "warn"} />
      <SummaryItem label="Devices" value={deviceCount} />
      <SummaryItem label="Online" value={onlineCount} tone="online" />
      <SummaryItem label="Playing" value={playingCount} tone="playing" />
    </section>

    <details className="monitoring-technical-details">
      <summary>Technical details</summary>
      <p>Location ID <code>{location.id}</code></p>
      {!!deviceCount && <ul>{location.devices.map((device) => <li key={device.id}>{device.label} · <code>{device.id}</code></li>)}</ul>}
    </details>

    {!deviceCount && <section className="admin-card text-dim">No Devices are assigned to this Location.</section>}
    {!!deviceCount && <section className="monitoring-device-list" aria-label={`Devices at ${location.name}`}>
      {location.devices.map((device) => <article className={`admin-card monitoring-device ${device.online ? "" : "monitoring-device-offline"}`} key={device.id}>
        <div className="monitoring-device-header">
          <div><h2>{device.label}</h2></div>
          <div className="monitoring-badges">
            <span className={`badge ${device.online ? "badge-ok" : "badge-warn"}`}>{device.online ? "ONLINE" : "OFFLINE"}</span>
            <span className={`badge ${device.playerActiveNow ? "badge-ok" : "badge-neutral"}`}>{device.playerActiveNow ? "PLAYING" : "NOT PLAYING"}</span>
            <span className={`badge ${device.status === "active" ? "badge-neutral" : "badge-warn"}`}>{device.status.toUpperCase()}</span>
            <span className="badge badge-neutral">{device.activationState.toUpperCase()}</span>
          </div>
        </div>
        {!device.online && <p className="monitoring-stale-note">Lane values below are last-known state; this Device is not currently signaling.</p>}
        <div className="monitoring-lanes">
          <div><span className="monitoring-eyebrow">MUSIC</span><p>{laneValue(device.music)}</p></div>
          <div><span className="monitoring-eyebrow">AMBIENT</span><p>{laneValue(device.ambient)}</p></div>
        </div>
        <div className="monitoring-times">
          <span>Last seen: <RelativeTime value={device.lastSeenAt} asOf={snapshot.asOf} /></span>
          <span>Last reported playback: <RelativeTime value={device.lastPlaybackObservedAt} asOf={snapshot.asOf} /></span>
        </div>
      </article>)}
    </section>}
  </>;
}

function RelativeTime({ value, asOf }: { value: string | null; asOf: string }) {
  return value
    ? <time dateTime={value} title={exactTime(value)}>{formatMonitoringRelativeTime(value, asOf)}</time>
    : <>—</>;
}

function SummaryItem({ label, value, tone }: { label: string; value: string | number; tone?: "online" | "playing" | "warn" | "partial" }) {
  return <div className={`monitoring-summary-item ${tone ? `monitoring-summary-${tone}` : ""}`}>
    <span>{label}</span><strong>{value}</strong>
  </div>;
}

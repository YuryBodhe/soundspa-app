"use client";

import Link from "next/link";
import type { MonitoringSnapshotV1 } from "../../../../db/v2/monitoringSnapshotModel";
import MonitoringLocationList from "./MonitoringLocationList";
import { useMonitoringSnapshot } from "./useMonitoringSnapshot";

export default function MonitoringDashboard({ initialSnapshot }: { initialSnapshot: MonitoringSnapshotV1 }) {
  const { snapshot, refreshing, refreshError, refresh } = useMonitoringSnapshot(initialSnapshot);
  return <>
    <div className="admin-page-header">
      <div>
        <p className="monitoring-eyebrow">SOUNDSPA V2 · CURRENT STATE</p>
        <h1 className="admin-page-title">Monitoring</h1>
        <p className="text-dim">Snapshot at <time dateTime={snapshot.asOf}>{snapshot.asOf.replace("T", " ").replace(".000Z", " UTC")}</time></p>
        <p className="monitoring-refresh-note" role="status" aria-live="polite">
          {refreshing ? "Updating snapshot…" : refreshError ? "Refresh failed · showing last snapshot" : "Automatic refresh every 60 seconds"}
        </p>
      </div>
      <div className="admin-page-nav">
        <Link href="/admin/ui" className="btn btn-sm">Admin</Link>
        <button className="btn btn-sm" type="button" onClick={() => { void refresh(); }} disabled={refreshing}>Refresh</button>
      </div>
    </div>
    <section className="monitoring-summary" aria-label="Current monitoring summary">
      <SummaryItem label="Locations" value={snapshot.summary.locationCount} />
      <SummaryItem label="Devices" value={snapshot.summary.deviceCount} />
      <SummaryItem label="Online" value={snapshot.summary.onlineDeviceCount} tone="online" />
      <SummaryItem label="Playing" value={snapshot.summary.playingDeviceCount} tone="playing" />
    </section>
    <MonitoringLocationList snapshot={snapshot} />
  </>;
}

function SummaryItem({ label, value, tone }: { label: string; value: number; tone?: "online" | "playing" }) {
  return <div className={`monitoring-summary-item ${tone ? `monitoring-summary-${tone}` : ""}`}>
    <span>{label}</span><strong>{value}</strong>
  </div>;
}

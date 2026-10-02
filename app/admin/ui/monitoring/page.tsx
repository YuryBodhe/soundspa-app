import Link from "next/link";
import { headers } from "next/headers";
import { operatorAuthStatus } from "../../../../lib/v2/adminOperator";
import MonitoringLocationList from "./MonitoringLocationList";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) {
    throw new Error("V2 operator authorization required.");
  }
  const { getMonitoringSnapshot } = await import("../../../../db/v2/queries/monitoringSnapshot");
  const snapshot = await getMonitoringSnapshot();

  return <>
    <div className="admin-page-header">
      <div>
        <p className="monitoring-eyebrow">SOUNDSPA V2 · CURRENT STATE</p>
        <h1 className="admin-page-title">Monitoring</h1>
        <p className="text-dim">Snapshot at <time dateTime={snapshot.asOf}>{snapshot.asOf.replace("T", " ").replace(".000Z", " UTC")}</time></p>
      </div>
      <div className="admin-page-nav">
        <Link href="/admin/ui" className="btn btn-sm">Admin</Link>
        <form method="get"><button className="btn btn-sm" type="submit">Refresh</button></form>
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

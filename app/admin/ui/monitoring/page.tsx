import Link from "next/link";
import { headers } from "next/headers";
import { operatorAuthStatus } from "../../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";

function laneValue(lane: { state: string | null; channelId: string | null; channelName: string | null }) {
  if (!lane.state) return "No monitoring state";
  return `${lane.state}${lane.channelName ? ` — ${lane.channelName}` : lane.channelId ? " — Unknown / deleted channel" : ""}`;
}

function dateValue(value: string | null) {
  return value ? `${value.replace("T", " ").replace(".000Z", " UTC")}` : "—";
}

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
        <p className="text-dim">Updated {dateValue(snapshot.asOf)}</p>
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

    {!snapshot.organizations.length && <section className="admin-card text-dim">No Organizations are configured.</section>}
    {snapshot.organizations.map((organization) => <section className="monitoring-organization" key={organization.id}>
      <div className="monitoring-group-heading">
        <div><span className="monitoring-eyebrow">ORGANIZATION</span><h2>{organization.name}</h2></div>
        {organization.archived && <span className="badge badge-neutral">ARCHIVED</span>}
      </div>
      {!organization.locations.length && <div className="admin-card text-dim">No Locations.</div>}
      {organization.locations.map((location) => <section className="admin-card monitoring-location" key={location.id}>
        <div className="monitoring-group-heading">
          <div><span className="monitoring-eyebrow">LOCATION</span><h3>{location.name}</h3></div>
          {location.archived && <span className="badge badge-neutral">ARCHIVED</span>}
        </div>
        {!location.devices.length && <p className="text-dim">No Devices.</p>}
        {!!location.devices.length && <div className="monitoring-device-list">
          {location.devices.map((device) => <article className={`monitoring-device ${device.online ? "" : "monitoring-device-offline"}`} key={device.id}>
            <div className="monitoring-device-header">
              <div><h4>{device.label}</h4><span className="text-dim">{device.id}</span></div>
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
              <span>Last seen: {dateValue(device.lastSeenAt)}</span>
              <span>Last reported playback: {dateValue(device.lastPlaybackObservedAt)}</span>
            </div>
          </article>)}
        </div>}
      </section>)}
    </section>)}
  </>;
}

function SummaryItem({ label, value, tone }: { label: string; value: number; tone?: "online" | "playing" }) {
  return <div className={`monitoring-summary-item ${tone ? `monitoring-summary-${tone}` : ""}`}>
    <span>{label}</span><strong>{value}</strong>
  </div>;
}

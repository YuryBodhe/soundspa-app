"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MonitoringSnapshotV1 } from "../../../../db/v2/monitoringSnapshotModel";
import { buildMonitoringLocationRows, filterMonitoringLocations, formatMonitoringRelativeTime, type MonitoringFilter } from "./monitoringUiModel";

const FILTERS: Array<{ value: MonitoringFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "offline", label: "Offline" },
  { value: "partially-online", label: "Partially Online" },
  { value: "not-playing", label: "Not Playing" },
  { value: "playing", label: "Playing" },
];

export default function MonitoringLocationList({ snapshot }: { snapshot: MonitoringSnapshotV1 }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MonitoringFilter>("all");
  const rows = useMemo(() => filterMonitoringLocations(buildMonitoringLocationRows(snapshot), query, filter), [snapshot, query, filter]);
  const organizationsWithoutLocations = snapshot.organizations.filter((organization) => organization.locations.length === 0);

  return <>
    <section className="monitoring-controls" aria-label="Filter Locations">
      <label className="monitoring-search"><span>Search</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Organization, Location or Device" /></label>
      <div className="monitoring-filters" role="group" aria-label="Quick filters">
        {FILTERS.map((item) => <button key={item.value} type="button" className={`btn btn-sm ${filter === item.value ? "monitoring-filter-active" : ""}`} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
      </div>
    </section>

    <div className="monitoring-table-wrap">
      <table className="admin-table monitoring-table">
        <thead><tr><th>Location</th><th>Organization</th><th>Devices</th><th>Status</th><th>Playing</th><th>Last seen</th></tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.location.id}>
            <td><Link className="monitoring-location-link" href={`/admin/ui/monitoring/locations/${encodeURIComponent(row.location.id)}`}>{row.location.name}<span aria-hidden="true"> →</span></Link></td>
            <td>{row.organizationName}</td>
            <td>{row.deviceCount}</td>
            <td><span className={`badge ${row.status === "Online" ? "badge-ok" : row.status === "No Devices" ? "badge-neutral" : "badge-warn"}`}>{row.status}</span></td>
            <td>{row.playingCount} / {row.deviceCount}</td>
            <td>{row.lastSeenAt ? <time dateTime={row.lastSeenAt} title={row.lastSeenAt}>{formatMonitoringRelativeTime(row.lastSeenAt, snapshot.asOf)}</time> : "—"}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={6} className="text-dim">{snapshot.organizations.length ? "No Locations match this search/filter." : "No Organizations are configured."}</td></tr>}
        </tbody>
      </table>
    </div>

    {!!organizationsWithoutLocations.length && <section className="monitoring-empty-organizations">
      <h2>Organizations without Locations</h2>
      <p>{organizationsWithoutLocations.map((organization) => organization.name).join(" · ")}</p>
    </section>}
  </>;
}

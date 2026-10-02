"use client";

import { useState, type FormEvent } from "react";
import type { AnalyticsPeriod, AnalyticsReportV1, AnalyticsScope } from "../../../../db/v2/analyticsReportModel";
import { currentLaneDisplay, formatAnalyticsDuration, formatAnalyticsRelativeTime, formatAnalyticsScope, formatAnalyticsUtc, lifecycleEventLabel } from "./analyticsPresentation";

type ScopeOptionData = {
  organizations: Array<{ id: string; name: string; archived: boolean }>;
  locations: Array<{ id: string; name: string; organizationId: string; archived: boolean }>;
};
export type AnalyticsScopeOptionData = ScopeOptionData;

const PERIODS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

function parseScope(value: string): AnalyticsScope {
  if (value === "all") return { type: "all" };
  const separator = value.indexOf(":");
  const type = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (type === "organization") return { type: "organization", organizationId: id };
  return { type: "location", locationId: id };
}

function scopeValue(scope: AnalyticsScope): string {
  if (scope.type === "all") return "all";
  return scope.type === "organization" ? `organization:${scope.organizationId}` : `location:${scope.locationId}`;
}

function periodLabel(period: AnalyticsPeriod) {
  return PERIODS.find((option) => option.value === period)?.label ?? period;
}

export default function AnalyticsReportClient({ options }: { options: ScopeOptionData }) {
  const [selectedScope, setSelectedScope] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState<AnalyticsPeriod>("24h");
  const [report, setReport] = useState<AnalyticsReportV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v2/admin/analytics/report", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ scope: parseScope(selectedScope), period: selectedPeriod }),
      });
      const body = await response.json() as AnalyticsReportV1 | { message?: string };
      if (!response.ok) throw new Error("message" in body && body.message ? body.message : "The analytics report could not be generated.");
      setReport(body as AnalyticsReportV1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The analytics report could not be generated.");
    } finally {
      setLoading(false);
    }
  }

  return <>
    <form className="admin-card analytics-controls" onSubmit={generateReport}>
      <div className="analytics-control-grid">
        <label className="form-row">
          <span>Scope</span>
          <select value={selectedScope} onChange={(event) => setSelectedScope(event.target.value)}>
            <option value="all">All Organizations</option>
            <optgroup label="Organizations">
              {options.organizations.map((organization) => <option key={organization.id} value={`organization:${organization.id}`}>
                {organization.name}{organization.archived ? " (Archived)" : ""}
              </option>)}
            </optgroup>
            <optgroup label="Locations">
              {options.locations.map((location) => {
                const organization = options.organizations.find((item) => item.id === location.organizationId);
                return <option key={location.id} value={`location:${location.id}`}>
                  {location.name} — {organization?.name ?? "Unknown Organization"}{location.archived ? " (Archived)" : ""}
                </option>;
              })}
            </optgroup>
          </select>
        </label>
        <label className="form-row">
          <span>Period</span>
          <select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value as AnalyticsPeriod)}>
            {PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
          </select>
        </label>
        <button className="btn btn-primary analytics-generate" type="submit" disabled={loading}>
          {loading ? "Generating…" : "Generate Report"}
        </button>
      </div>
      <p className="analytics-control-note">Reports run only when requested. Periods use completed UTC-hour buckets.</p>
      <AnalyticsRequestFeedback loading={loading} error={error} />
    </form>

    {report && <AnalyticsReportView report={report} options={options} />}
  </>;
}

export function AnalyticsRequestFeedback({ loading, error }: { loading: boolean; error: string | null }) {
  return <>
    {loading && <p className="analytics-feedback" role="status" aria-live="polite">Generating report…</p>}
    {error && <p className="analytics-feedback analytics-error" role="alert">{error}</p>}
  </>;
}

export function AnalyticsReportView({ report, options }: { report: AnalyticsReportV1; options: ScopeOptionData }) {
  const requestedScope = formatAnalyticsScope(report.metadata.scope, options);
  const music = [...report.musicUsage].sort((a, b) => b.playedSeconds - a.playedSeconds || a.channelName.localeCompare(b.channelName));
  const ambient = [...report.ambientUsage].sort((a, b) => b.playedSeconds - a.playedSeconds || a.channelName.localeCompare(b.channelName));

  return <div className="analytics-report" aria-live="polite">
    <section className="admin-card analytics-report-header">
      <div>
        <p className="monitoring-eyebrow">GENERATED ANALYTICS REPORT</p>
        <h2>{requestedScope}</h2>
        <div className="analytics-report-meta">
          <span>Requested period: {periodLabel(report.metadata.requestedPeriod)}</span>
          <span>Effective interval: {formatAnalyticsUtc(report.metadata.effectiveStart)} — {formatAnalyticsUtc(report.metadata.effectiveEnd)}</span>
          <span>Generated: {formatAnalyticsUtc(report.metadata.generatedAt)}</span>
        </div>
        <p className="analytics-interval-note">The effective interval is based on completed UTC-hour buckets, not a rolling-to-the-second window.</p>
      </div>
      <div className="analytics-future-action" aria-hidden="true" />
    </section>

    <section className="analytics-summary" aria-label="Analytics summary">
      <Metric label="Organizations" value={report.summary.organizationCount} />
      <Metric label="Locations" value={report.summary.locationCount} />
      <Metric label="Devices" value={report.summary.deviceCount} />
      <Metric label="Online Devices" value={report.summary.onlineDeviceCount} />
      <Metric label="Player Active" value={formatAnalyticsDuration(report.summary.playerActiveSeconds)} />
      <Metric label="Music" value={formatAnalyticsDuration(report.summary.musicSeconds)} />
      <Metric label="Ambient" value={formatAnalyticsDuration(report.summary.ambientSeconds)} />
      <Metric label="Errors" value={report.summary.errorCount} />
    </section>

    <section className="admin-card analytics-section">
      <h2 className="admin-card-title">Locations</h2>
      <div className="analytics-table-wrap"><table className="admin-table analytics-table">
        <thead><tr><th>Location</th><th>Organization</th><th>Devices</th><th>Online</th><th>Player Active</th><th>Music</th><th>Ambient</th><th>Last seen</th><th>Last playback</th></tr></thead>
        <tbody>{report.locations.map((location) => <tr key={location.locationId}>
          <td>{location.locationName}{location.status !== "current" ? <span className="badge badge-neutral">{location.status.toUpperCase()}</span> : null}</td>
          <td>{location.organizationName ?? "—"}</td>
          <td>{location.deviceCount}</td>
          <td>{location.onlineDeviceCount}</td>
          <td>{formatAnalyticsDuration(location.playerActiveSeconds)}</td>
          <td>{formatAnalyticsDuration(location.musicSeconds)}</td>
          <td>{formatAnalyticsDuration(location.ambientSeconds)}</td>
          <td><RelativeTime value={location.lastSeen} asOf={report.metadata.generatedAt} /></td>
          <td><RelativeTime value={location.lastPlaybackObserved} asOf={report.metadata.generatedAt} /></td>
        </tr>)}{!report.locations.length && <EmptyRow columns={9} text="No Locations in this report." />}</tbody>
      </table></div>
    </section>

    <div className="analytics-two-column">
      <UsageTable title="Music Usage" rows={music} />
      <UsageTable title="Ambient Usage" rows={ambient} />
    </div>

    <section className="admin-card analytics-section">
      <h2 className="admin-card-title">Devices</h2>
      <div className="analytics-table-wrap"><table className="admin-table analytics-table">
        <thead><tr><th>Device</th><th>Location</th><th>Organization</th><th>Now</th><th>Player Active during period</th><th>Current Music</th><th>Current Ambient</th><th>Last seen</th><th>Last reported playback</th></tr></thead>
        <tbody>{report.devices.map((device) => <tr key={device.deviceId}>
          <td>{device.deviceLabel}{device.deviceStatus !== "active" ? <span className="badge badge-neutral">{device.deviceStatus.toUpperCase()}</span> : null}</td>
          <td>{device.locationName ?? "—"}</td>
          <td>{device.organizationName ?? "—"}</td>
          <td><span className={`badge ${device.online ? "badge-ok" : "badge-warn"}`}>{device.online ? "ONLINE" : "OFFLINE"}</span></td>
          <td>{formatAnalyticsDuration(device.playerActiveSeconds)}</td>
          <td>{currentLaneDisplay(device.currentMusic, device.online)}</td>
          <td>{currentLaneDisplay(device.currentAmbient, device.online)}</td>
          <td><RelativeTime value={device.lastSeen} asOf={report.metadata.generatedAt} /></td>
          <td><RelativeTime value={device.lastPlaybackObserved} asOf={report.metadata.generatedAt} /></td>
        </tr>)}{!report.devices.length && <EmptyRow columns={9} text="No Devices in this report." />}</tbody>
      </table></div>
    </section>

    <div className="analytics-two-column">
      <section className="admin-card analytics-section">
        <h2 className="admin-card-title">Reliability</h2>
        <div className="analytics-inline-metrics"><span>Total errors <strong>{report.reliability.totalErrors}</strong></span><span>Affected Devices <strong>{report.reliability.affectedDeviceCount}</strong></span></div>
        {report.reliability.byCode.length
          ? <div className="analytics-table-wrap"><table className="admin-table analytics-table"><thead><tr><th>Category</th><th>Code</th><th>Count</th><th>Affected Devices</th><th>First seen</th><th>Last seen</th></tr></thead>
            <tbody>{report.reliability.byCode.map((row) => <tr key={`${row.category}:${row.code}`}><td>{row.category}</td><td><code>{row.code}</code></td><td>{row.count}</td><td>{row.affectedDeviceCount}</td><td><RelativeTime value={row.firstSeen} asOf={report.metadata.generatedAt} /></td><td><RelativeTime value={row.lastSeen} asOf={report.metadata.generatedAt} /></td></tr>)}</tbody>
          </table></div>
          : <p className="analytics-empty">No reported errors during this period.</p>}
      </section>

      <section className="admin-card analytics-section">
        <h2 className="admin-card-title">Lifecycle</h2>
        {report.lifecycle.byType.length
          ? <ul className="analytics-lifecycle">{report.lifecycle.byType.map((row) => <li key={row.eventType}><span>{lifecycleEventLabel(row.eventType)}</span><strong>{row.count}</strong></li>)}</ul>
          : <p className="analytics-empty">No reported lifecycle events during this period.</p>}
      </section>
    </div>

    <section className="analytics-data-quality">
      <h2>Data quality &amp; interpretation</h2>
      <ul>
        <li>{report.dataQuality.hourlyGranularity}</li>
        <li>Music and Ambient are independent lanes; their combined totals can exceed Player Active.</li>
        <li>{report.dataQuality.channelTimelineCaveat}</li>
        <li>{report.dataQuality.accountingCaveat}</li>
        <li>Unattributed Player Active: {formatAnalyticsDuration(report.dataQuality.unattributedPlayerActiveSeconds)}; unattributed channel time: {formatAnalyticsDuration(report.dataQuality.unattributedChannelSeconds)}.</li>
        {report.dataQuality.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="analytics-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function UsageTable({ title, rows }: { title: string; rows: Array<{ channelId: string; channelName: string; playedSeconds: number }> }) {
  return <section className="admin-card analytics-section">
    <h2 className="admin-card-title">{title}</h2>
    <div className="analytics-table-wrap"><table className="admin-table analytics-table"><thead><tr><th>Channel</th><th>Played time</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.channelId}><td>{row.channelName}</td><td>{formatAnalyticsDuration(row.playedSeconds)}</td></tr>)}{!rows.length && <EmptyRow columns={2} text="No usage reported during this period." />}</tbody>
    </table></div>
  </section>;
}

function RelativeTime({ value, asOf }: { value: string | null; asOf: string }) {
  return value ? <time dateTime={value} title={formatAnalyticsUtc(value)}>{formatAnalyticsRelativeTime(value, asOf)}</time> : <>—</>;
}

function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <tr><td colSpan={columns} className="text-dim">{text}</td></tr>;
}

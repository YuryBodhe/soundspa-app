import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAnalyticsReport, type AnalyticsReportInput } from "../../../../db/v2/analyticsReportModel";
import AnalyticsReportClient, { AnalyticsReportView, AnalyticsRequestFeedback } from "./AnalyticsReportClient";

const asOf = new Date("2026-10-02T13:15:00.000Z");
const organizationId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const musicChannelId = "44444444-4444-4444-8444-444444444444";
const ambientChannelId = "55555555-5555-4555-8555-555555555555";
const options = {
  organizations: [{ id: organizationId, name: "Viet Spa", archived: false }],
  locations: [{ id: locationId, name: "Danang", organizationId, archived: false }],
};

function reportInput(overrides: Partial<AnalyticsReportInput> = {}): AnalyticsReportInput {
  return {
    asOf,
    period: "24h",
    scope: { type: "all" },
    organizations: [{ id: organizationId, name: "Viet Spa", archivedAt: null }],
    locations: [{ id: locationId, organizationId, name: "Danang", archivedAt: null }],
    devices: [{
      id: deviceId, locationId, label: "Lobby Player", status: "active", activationState: "activated", current: true,
      lastSeenAt: new Date("2026-10-02T12:59:00.000Z"), lastPlaybackObservedAt: new Date("2026-10-02T12:58:00.000Z"),
      music: { state: "paused", channelId: musicChannelId, channelName: "Relax" },
      ambient: { state: "idle", channelId: ambientChannelId, channelName: "Forest" },
    }],
    deletedDevices: [],
    playerActiveBuckets: [{ bucketStart: new Date("2026-10-02T12:00:00.000Z"), deviceId, activePlaybackSeconds: 183 }],
    channelPlaybackBuckets: [
      { bucketStart: new Date("2026-10-02T12:00:00.000Z"), deviceId, channelId: musicChannelId, channelName: "Relax", lane: "music", playedSeconds: 224 },
      { bucketStart: new Date("2026-10-02T12:00:00.000Z"), deviceId, channelId: ambientChannelId, channelName: "Forest", lane: "ambient", playedSeconds: 420 },
    ],
    errorAggregates: [],
    lifecycleRecords: [{ eventType: "device_activated", occurredAt: new Date("2026-10-02T12:20:00.000Z"), organizationId, organizationName: "Viet Spa", locationId, locationName: "Danang", deviceId, deviceLabel: "Lobby Player" }],
    ...overrides,
  };
}

test("scope/period controls render with dynamic options and no report request occurs before Generate Report", () => {
  let fetchCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalls++; throw new Error("unexpected fetch"); }) as typeof fetch;
  try {
    const html = renderToStaticMarkup(createElement(AnalyticsReportClient, { options }));
    assert.match(html, /All Organizations/);
    assert.match(html, /optgroup label="Organizations"/);
    assert.match(html, /optgroup label="Locations"/);
    assert.match(html, /Viet Spa/);
    assert.match(html, /Danang — Viet Spa/);
    assert.match(html, /Last 24 hours/);
    assert.match(html, /Last 30 days/);
    assert.match(html, /Generate Report/);
    assert.doesNotMatch(html, /GENERATED ANALYTICS REPORT/);
    assert.doesNotMatch(html, /Download \.txt/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("loading and error states are visible and operator-friendly", () => {
  const loading = renderToStaticMarkup(createElement(AnalyticsRequestFeedback, { loading: true, error: null }));
  assert.match(loading, /role="status"/);
  assert.match(loading, /Generating report/);
  const error = renderToStaticMarkup(createElement(AnalyticsRequestFeedback, { loading: false, error: "The selected Location was not found." }));
  assert.match(error, /role="alert"/);
  assert.match(error, /selected Location was not found/);
});

test("canonical report keeps business sections primary and collapses technical details by default", () => {
  const report = buildAnalyticsReport(reportInput());
  const html = renderToStaticMarkup(createElement(AnalyticsReportView, { report, options }));
  assert.match(html, /Download \.txt/);
  assert.match(html, /All Organizations/);
  assert.match(html, /Last 24 hours/);
  assert.match(html, /Effective interval:/);
  assert.match(html, /completed UTC-hour buckets/);
  assert.match(html, /Player Active/);
  assert.match(html, /3 min 3 sec/);
  assert.match(html, /Locations/);
  assert.match(html, /Danang/);
  assert.match(html, /Music Usage/);
  assert.match(html, /Relax/);
  assert.match(html, /Ambient Usage/);
  assert.match(html, /Forest/);
  assert.match(html, /No reported errors during this period/);
  assert.match(html, /independent lanes; their combined totals can exceed Player Active/);
  assert.match(html, /exact channel-switch timestamps are not available/);
  assert.match(html, /Reliability/);
  const disclosure = html.match(/<details class="admin-card analytics-technical-details">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(disclosure, "technical sections use a native collapsed disclosure");
  assert.doesNotMatch(html.slice(0, html.indexOf("<details class=\"admin-card analytics-technical-details\"")), /<h2 class="admin-card-title">Devices<\/h2>/);
  assert.match(disclosure, /<h2 class="admin-card-title">Devices<\/h2>/);
  assert.match(disclosure, /Lobby Player/);
  assert.match(disclosure, /Player Active during period/);
  assert.match(disclosure, /Current Music/);
  assert.match(disclosure, /Last known · paused · Relax/);
  assert.match(disclosure, /Device Activated/);
  assert.match(disclosure, /Data quality &amp; interpretation/);
  assert.doesNotMatch(html.slice(0, html.indexOf("<details class=\"admin-card analytics-technical-details\"")), /Data quality &amp; interpretation|Lifecycle/);
  assert.ok(report.summary.musicSeconds + report.summary.ambientSeconds > report.summary.playerActiveSeconds);
});

test("zero-usage report remains valid and keeps the effective interval visible", () => {
  const report = buildAnalyticsReport(reportInput({ playerActiveBuckets: [], channelPlaybackBuckets: [] }));
  const html = renderToStaticMarkup(createElement(AnalyticsReportView, { report, options }));
  assert.equal(report.summary.playerActiveSeconds, 0);
  assert.equal(report.summary.musicSeconds, 0);
  assert.equal(report.summary.ambientSeconds, 0);
  assert.match(html, /Effective interval:/);
  assert.match(html, /0 sec/);
  assert.doesNotMatch(html, /No data available/);
});

test("Organization and Location scope labels are represented in report header", () => {
  const organizationReport = buildAnalyticsReport(reportInput({ scope: { type: "organization", organizationId } }));
  const locationReport = buildAnalyticsReport(reportInput({ scope: { type: "location", locationId } }));
  assert.match(renderToStaticMarkup(createElement(AnalyticsReportView, { report: organizationReport, options })), /Viet Spa/);
  assert.match(renderToStaticMarkup(createElement(AnalyticsReportView, { report: locationReport, options })), /Danang · Viet Spa/);
});

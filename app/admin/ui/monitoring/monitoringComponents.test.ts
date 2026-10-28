import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MonitoringSnapshotV1 } from "../../../../db/v2/monitoringSnapshotModel";
import MonitoringDashboard from "./MonitoringDashboard";
import MonitoringLocationDetail from "./locations/[locationId]/MonitoringLocationDetail";

const snapshot: MonitoringSnapshotV1 = {
  asOf: "2026-10-02T13:15:00.000Z", onlineThresholdSeconds: 300,
  summary: { organizationCount: 1, locationCount: 1, deviceCount: 1, onlineDeviceCount: 0, playingDeviceCount: 0 },
  organizations: [{ id: "org-id", name: "Viet Spa", archived: false, locations: [{
    id: "loc-uuid-secret", name: "Danang", archived: false, devices: [{
      id: "device-uuid-secret", label: "Front Desk", status: "active", activationState: "activated", online: false,
      lastSeenAt: "2026-10-02T13:00:00.000Z", lastPlaybackObservedAt: null, playerActiveNow: false,
      music: { state: "paused", channelId: null, channelName: null }, ambient: { state: "idle", channelId: null, channelName: null },
    }],
  }] }],
};

test("Monitoring dashboard retains manual Refresh and communicates the server snapshot cadence", () => {
  const html = renderToStaticMarkup(createElement(MonitoringDashboard, { initialSnapshot: snapshot }));
  assert.match(html, /Snapshot at/);
  assert.match(html, /Automatic refresh every 60 seconds/);
  assert.match(html, /type="button"[^>]*>Refresh<\/button>/);
  assert.match(html, /<strong>0<\/strong>/);
  assert.match(html, /Offline/);
});

test("Location detail keeps UUIDs available only in collapsed Technical details", () => {
  const html = renderToStaticMarkup(createElement(MonitoringLocationDetail, { initialSnapshot: snapshot, locationId: "loc-uuid-secret" }));
  const disclosureStart = html.indexOf("<details class=\"monitoring-technical-details\">");
  assert.notEqual(disclosureStart, -1);
  const disclosureEnd = html.indexOf("</details>", disclosureStart);
  const visibleContent = html.slice(0, disclosureStart) + html.slice(disclosureEnd + "</details>".length);
  const technicalContent = html.slice(disclosureStart, disclosureEnd);
  assert.doesNotMatch(visibleContent, /loc-uuid-secret|device-uuid-secret/);
  assert.match(technicalContent, /Location ID/);
  assert.match(technicalContent, /loc-uuid-secret/);
  assert.match(technicalContent, /device-uuid-secret/);
  assert.match(technicalContent, /Front Desk/);
  assert.match(visibleContent, /OFFLINE/);
});

test("Partially Online uses the yellow status treatment in list and detail", () => {
  const partialSnapshot: MonitoringSnapshotV1 = {
    ...snapshot,
    organizations: [{ ...snapshot.organizations[0]!, locations: [{
      ...snapshot.organizations[0]!.locations[0]!,
      devices: [
        { ...snapshot.organizations[0]!.locations[0]!.devices[0]!, id: "device-offline", online: false },
        { ...snapshot.organizations[0]!.locations[0]!.devices[0]!, id: "device-online", online: true },
      ],
    }] }],
  };
  const list = renderToStaticMarkup(createElement(MonitoringDashboard, { initialSnapshot: partialSnapshot }));
  assert.match(list, /class="badge badge-partial">Partially Online<\/span>/);

  const detail = renderToStaticMarkup(createElement(MonitoringLocationDetail, { initialSnapshot: partialSnapshot, locationId: "loc-uuid-secret" }));
  assert.match(detail, /monitoring-summary-partial/);
  assert.match(detail, /<strong>Partially Online<\/strong>/);
});

test("offline playing history remains readable without a current PLAYING badge", () => {
  const historical: MonitoringSnapshotV1 = structuredClone(snapshot);
  historical.organizations[0]!.locations[0]!.devices[0]!.music = { state: "playing", channelId: "music", channelName: "Relax" };
  const html = renderToStaticMarkup(createElement(MonitoringLocationDetail, { initialSnapshot: historical, locationId: "loc-uuid-secret" }));
  assert.match(html, /NOT PLAYING/);
  assert.doesNotMatch(html, />PLAYING<\/span>/);
  assert.match(html, /playing — Relax/);
  assert.match(html, /last-known state/);
});

test("pending devices remain available in detail when operational device count is zero", () => {
  const pending: MonitoringSnapshotV1 = structuredClone(snapshot);
  pending.organizations[0]!.locations[0]!.devices[0]!.activationState = "pending";
  const html = renderToStaticMarkup(createElement(MonitoringLocationDetail, { initialSnapshot: pending, locationId: "loc-uuid-secret" }));
  assert.match(html, /Active devices/);
  assert.match(html, /Front Desk/);
  assert.match(html, /PENDING/);
  assert.match(html, /device-uuid-secret/);
});

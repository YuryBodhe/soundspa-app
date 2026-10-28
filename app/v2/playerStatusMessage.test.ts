import assert from "node:assert/strict";
import test from "node:test";
import { playerStatusMessageKey } from "./playerStatusMessage";

test("a ready player and a completed ownership handoff show no status banner", () => {
  const ready = { monitoringEnabled: true, ownershipState: "owned" as const, monitoringState: "connected" as const };
  assert.equal(playerStatusMessageKey(ready), null);
  assert.equal(playerStatusMessageKey({ monitoringEnabled: false, ownershipState: "owned", monitoringState: "connected" }), null);
});

test("standby and functional monitoring messages remain visible", () => {
  assert.equal(playerStatusMessageKey({ monitoringEnabled: true, ownershipState: "activeElsewhere", monitoringState: "idle" }), "playerOwnershipActive");
  assert.equal(playerStatusMessageKey({ monitoringEnabled: true, ownershipState: "waiting", monitoringState: "idle" }), "playerOwnershipWaiting");
  assert.equal(playerStatusMessageKey({ monitoringEnabled: true, ownershipState: "owned", monitoringState: "retrying" }), "playerMonitoringRecovery");
  assert.equal(playerStatusMessageKey({ monitoringEnabled: true, ownershipState: "owned", monitoringState: "unauthorized" }), "deviceSetupRequired");
});

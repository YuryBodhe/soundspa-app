import assert from "node:assert/strict";
import test from "node:test";
import { canAssignActivatedDevice, deviceProductAssignmentLimit } from "./deviceProductPolicy";

test("Basic Trial allows five activated Basic assignments and denies the sixth", () => {
  const limit = deviceProductAssignmentLimit("soundspa", "basic_trial");
  assert.equal(limit, 5);
  assert.equal(canAssignActivatedDevice(limit, 4), true);
  assert.equal(canAssignActivatedDevice(limit, 5), false);
});

test("paid Basic is unlimited and supersedes its Trial cap for Basic only", () => {
  assert.equal(deviceProductAssignmentLimit("soundspa", "basic_paid"), null);
  assert.equal(deviceProductAssignmentLimit("soundspa", ["basic_trial", "basic_paid"]), null);
  assert.equal(canAssignActivatedDevice(deviceProductAssignmentLimit("soundspa", "basic_paid"), 500), true);
  assert.equal(deviceProductAssignmentLimit("spaquatoria", "spaquatoria_gift"), 1);
  assert.equal(canAssignActivatedDevice(deviceProductAssignmentLimit("spaquatoria", "spaquatoria_gift"), 1), false);
  assert.equal(deviceProductAssignmentLimit("soundspa", ["basic_trial", "other"]), null,
    "a separate Basic benefit or promotion carries no new Trial-derived quota");
  assert.equal(deviceProductAssignmentLimit("soundspa", "other"), null,
    "no unapproved limit is imposed on a non-Trial, non-paid Basic grant");
});

test("product quotas remain independent and no cap is inferred for unrelated products or historical sources", () => {
  const basic = deviceProductAssignmentLimit("soundspa", "basic_trial");
  const gift = deviceProductAssignmentLimit("spaquatoria", "spaquatoria_gift");
  assert.equal(canAssignActivatedDevice(basic, 4), true);
  assert.equal(canAssignActivatedDevice(gift, 0), true);
  assert.equal(canAssignActivatedDevice(gift, 1), false);
  assert.equal(deviceProductAssignmentLimit("spaquatoria", "other"), null);
  assert.equal(deviceProductAssignmentLimit("divnitsa", "other"), null);
});

test("invalid counts and invalid finite limits fail closed", () => {
  assert.equal(canAssignActivatedDevice(5, -1), false);
  assert.equal(canAssignActivatedDevice(5, 1.5), false);
  assert.equal(canAssignActivatedDevice(Number.NaN, 0), false);
});

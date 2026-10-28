import assert from "node:assert/strict";
import test from "node:test";
import { canStartPlayerAudio, DevicePlayerOwnership, type LockManagerLike } from "./playerOwnership";
import { en } from "../i18n/dictionaries/en";
import { ru } from "../i18n/dictionaries/ru";
import { vi } from "../i18n/dictionaries/vi";
import { th } from "../i18n/dictionaries/th";

class FakeLockManager implements LockManagerLike {
  private held: string | null = null;
  private readonly queue: Array<{ name: string; signal: AbortSignal; callback: (lock: { name: string }) => unknown; resolve: () => void; reject: (error: Error) => void }> = [];
  query = async () => ({ held: this.held ? [{ name: this.held }] : [] });
  request(name: string, options: { mode: "exclusive"; signal: AbortSignal }, callback: (lock: { name: string } | null) => unknown) {
    return new Promise<void>((resolve, reject) => {
      const entry = { name, signal: options.signal, callback: callback as (lock: { name: string }) => unknown, resolve, reject };
      if (options.signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      options.signal.addEventListener("abort", () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) { this.queue.splice(index, 1); reject(new DOMException("Aborted", "AbortError")); }
      }, { once: true });
      this.queue.push(entry);
      this.drain();
    });
  }
  private drain() {
    if (this.held || !this.queue.length) return;
    const entry = this.queue.shift()!;
    if (entry.signal.aborted) { entry.reject(new DOMException("Aborted", "AbortError")); this.drain(); return; }
    this.held = entry.name;
    Promise.resolve(entry.callback({ name: entry.name })).then(() => {
      this.held = null;
      entry.resolve();
      this.drain();
    }, error => {
      this.held = null;
      entry.reject(error instanceof Error ? error : new Error("lock callback failed"));
      this.drain();
    });
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("simultaneous tabs get one Device-scoped owner and standby acquires after release", async () => {
  const locks = new FakeLockManager();
  const first = new DevicePlayerOwnership("device-1", () => undefined, locks);
  const secondStates: string[] = [];
  const second = new DevicePlayerOwnership("device-1", state => secondStates.push(state), locks);
  first.start();
  second.start();
  await tick();
  assert.equal(first.isOwner, true);
  assert.equal(second.isOwner, false);
  assert.equal(first.lockName, second.lockName);
  let resolveStopped!: () => void;
  const stopBarrier = new Promise<void>(resolve => { resolveStopped = resolve; });
  const release = first.release(stopBarrier);
  await tick();
  assert.equal(second.isOwner, false, "next tab waits until playback/server cleanup finishes");
  resolveStopped();
  await release;
  await tick();
  assert.equal(second.isOwner, true);
  assert.ok(secondStates.includes("activeElsewhere"), "query is used to explain that another tab currently holds the lock");
  await second.release();
});

test("lock remains owned while paused; ownership is released only by explicit player cleanup", async () => {
  const locks = new FakeLockManager();
  const owner = new DevicePlayerOwnership("device-2", () => undefined, locks);
  owner.start();
  await tick();
  // Pause changes audio state in V2Player but does not call DevicePlayerOwnership.release().
  assert.equal(owner.isOwner, true);
  await owner.release();
  assert.equal(owner.isOwner, false);
});

test("closing a queued standby aborts its request without releasing the current owner's lock", async () => {
  const locks = new FakeLockManager();
  const owner = new DevicePlayerOwnership("device-3", () => undefined, locks);
  const standby = new DevicePlayerOwnership("device-3", () => undefined, locks);
  owner.start(); standby.start();
  await tick();
  await standby.release();
  assert.equal(owner.isOwner, true);
  await owner.release();
  assert.equal(standby.isOwner, false);
});

test("audio start gate requires local ownership and first accepted monitoring heartbeat", () => {
  const base = { monitoringEnabled: true, lockOwned: true, monitoringReady: true, monitoringConnected: true };
  assert.equal(canStartPlayerAudio(base), true);
  assert.equal(canStartPlayerAudio({ ...base, lockOwned: false }), false);
  assert.equal(canStartPlayerAudio({ ...base, monitoringReady: false }), false);
  assert.equal(canStartPlayerAudio({ ...base, monitoringConnected: false }), false);
  assert.equal(canStartPlayerAudio({ ...base, monitoringEnabled: false, lockOwned: false, monitoringReady: false, monitoringConnected: false }), true);
});

test("unsupported Web Locks fails closed", () => {
  const states: string[] = [];
  const owner = new DevicePlayerOwnership("device-4", state => states.push(state), null);
  owner.start();
  assert.equal(owner.currentState, "unsupported");
  assert.ok(states.includes("unsupported"));
});

test("ownership and recovery messages are localized in all supported languages", () => {
  const keys = ["playerOwnershipActive", "playerOwnershipWaiting", "playerOwnershipUnsupported", "playerMonitoringRecovery", "playerMonitoringUnavailable"] as const;
  for (const dictionary of [en, ru, vi, th]) for (const key of keys) assert.ok(dictionary[key].trim().length > 0, `${key} must be translated`);
});

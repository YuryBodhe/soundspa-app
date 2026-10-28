import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "@/app/i18n/dictionaries/en";
import { ru } from "@/app/i18n/dictionaries/ru";
import { vi } from "@/app/i18n/dictionaries/vi";
import { th } from "@/app/i18n/dictionaries/th";
import { accountSectionHref, accountSectionIdFromHash } from "./accountNavigation";

test("account navigation opens each stable dashboard section", () => {
  assert.deepEqual(
    ["salons", "devices", "subscriptions"].map((section) => accountSectionHref(section as "salons" | "devices" | "subscriptions")),
    ["/account#account-salons", "/account#account-devices", "/account#account-subscriptions"],
  );
});

test("section hash handling only recognizes the three account targets", () => {
  assert.equal(accountSectionIdFromHash("#account-devices"), "account-devices");
  assert.equal(accountSectionIdFromHash("#account-subscriptions"), "account-subscriptions");
  assert.equal(accountSectionIdFromHash("#https://example.invalid"), null);
  assert.equal(accountSectionIdFromHash("#other"), null);
});

test("player management opens only relative account section links in safe new tabs", async () => {
  const source = await readFile(new URL("../v2/V2Player.tsx", import.meta.url), "utf8");
  for (const section of ["salons", "devices", "subscriptions"]) {
    assert.match(source, new RegExp(`href=\\{accountSectionHref\\(\\"${section}\\"\\)\\} target=\\"_blank\\" rel=\\"noopener noreferrer\\"`));
  }
});

test("player management menu supports toggle, outside-pointer, Escape, and item dismissal", async () => {
  const source = await readFile(new URL("../v2/V2Player.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /onClick=\{\(\) => setOpen\(\(current\) => !current\)\}/);
  assert.match(source, /document\.addEventListener\("pointerdown", closeOnOutsidePointer\)/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /toggleRef\.current\?\.focus\(\)/);
  assert.match(source, /onClick=\{closeAfterSelection\}/);
});

test("player and onboarding navigation labels are translated in every supported locale", () => {
  for (const dictionary of [en, ru, vi, th]) {
    for (const key of ["playerManagement", "playerManagementSalons", "playerManagementDevices", "playerManagementSubscription", "accountSubscriptionSection", "devicePrimaryName"] as const) {
      assert.ok(dictionary[key].trim().length > 0);
    }
  }
  assert.equal(ru.devicePrimaryName, "Основное устройство");
});

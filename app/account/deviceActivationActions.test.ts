import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "@/app/i18n/dictionaries/en";
import { ru } from "@/app/i18n/dictionaries/ru";
import { vi } from "@/app/i18n/dictionaries/vi";
import { th } from "@/app/i18n/dictionaries/th";

test("activation result offers opening on this device and copying the full link", async () => {
  const source = await readFile(new URL("./AccountClient.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/href=\{activationLink\.url\}/g) ?? []).length, 2);
  assert.equal((source.match(/onClick=\{\(\) => void copyActivationLink\(\)\}/g) ?? []).length, 2);
  assert.match(source, /navigator\.clipboard\.writeText\(activationLink\.url\)/);
  assert.equal((source.match(/deviceLinkExpires/g) ?? []).length >= 2, true);
  assert.doesNotMatch(source, />\s*\{activationLink\.url\}\s*</);
  assert.match(source, /new Date\(activationLink\.expiresAt\)\.toLocaleString\(locale\)/);
});

test("activation actions have localized open-player labels in every supported language", () => {
  assert.equal(en.deviceOpenPlayer, "Open Player");
  assert.equal(ru.deviceOpenPlayer, "Открыть плеер");
  assert.equal(vi.deviceOpenPlayer, "Mở trình phát");
  assert.equal(th.deviceOpenPlayer, "เปิดเครื่องเล่น");
});

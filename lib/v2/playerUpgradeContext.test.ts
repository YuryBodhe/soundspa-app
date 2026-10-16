import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_PLAYER_UPGRADE_PRODUCTS,
  parsePlayerUpgradeContext,
  parsePlayerUpgradeContextFields,
  playerUpgradeAccountPath,
  playerUpgradeLoginPath,
  removePlayerUpgradeContextParams,
} from "./playerUpgradeContext";

const locationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const basicId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const divnitsaId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("allowlisted context parsing validates UUIDs, normalizes, deduplicates, and ignores unrelated parameters", () => {
  const context = parsePlayerUpgradeContext(`?source=player-upgrade&locationId=${locationId.toUpperCase()}&productId=${basicId}&productId=${basicId.toUpperCase()}&productId=${divnitsaId}&returnTo=https%3A%2F%2Fevil.example`);
  assert.deepEqual(context, { source: "player-upgrade", locationId, productIds: [basicId, divnitsaId] });
});

test("invalid, incomplete, oversized, and excessive Product hints are rejected", () => {
  assert.equal(parsePlayerUpgradeContext("?source=player-upgrade&locationId=bad&productId=" + basicId), null);
  assert.equal(parsePlayerUpgradeContext(`?source=player-upgrade&locationId=${locationId}&productId=not-a-uuid`), null);
  assert.equal(parsePlayerUpgradeContext(`?source=player-upgrade&locationId=${locationId}`), null);
  const many = Array.from({ length: MAX_PLAYER_UPGRADE_PRODUCTS + 1 }, (_, index) => `productId=${index.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`).join("&");
  assert.equal(parsePlayerUpgradeContext(`?source=player-upgrade&locationId=${locationId}&${many}`), null);
  assert.equal(parsePlayerUpgradeContext(`?source=player-upgrade&locationId=${locationId}&productId=${basicId}`.padEnd(4097, "x")), null);
  assert.equal(parsePlayerUpgradeContextFields("other", locationId, [basicId]), null);
});

test("Account-to-login and post-login paths are fixed local routes with canonical hints", () => {
  const login = playerUpgradeLoginPath(`?source=player-upgrade&locationId=${locationId}&productId=${basicId}&productId=${divnitsaId}&next=https%3A%2F%2Fevil.example`);
  assert.equal(login, `/login?source=player-upgrade&locationId=${locationId}&productId=${basicId}&productId=${divnitsaId}`);
  const account = playerUpgradeAccountPath(parsePlayerUpgradeContext(login.split("?")[1])!);
  assert.equal(account, `/account?source=player-upgrade&locationId=${locationId}&productId=${basicId}&productId=${divnitsaId}`);
  assert.equal(playerUpgradeLoginPath("?source=player-upgrade&locationId=bad&productId=" + basicId), "/login");
});

test("handoff history cleanup removes only its allowlisted query keys", () => {
  assert.equal(removePlayerUpgradeContextParams(`?source=player-upgrade&locationId=${locationId}&productId=${basicId}&tab=billing&tab=devices`), "?tab=billing&tab=devices");
  assert.equal(removePlayerUpgradeContextParams(`?source=player-upgrade&locationId=${locationId}&productId=${basicId}`), "");
});

test("auth and Account clients preserve context only through the fixed magic-link flow", async () => {
  const authClient = await readFile(new URL("../../app/auth/AuthClient.tsx", import.meta.url), "utf8");
  const loginRoute = await readFile(new URL("../../app/api/v2/customer-auth/request-login/route.ts", import.meta.url), "utf8");
  const accountClient = await readFile(new URL("../../app/account/AccountClient.tsx", import.meta.url), "utf8");
  assert.match(authClient, /const handoff = mode === "login" \? parsePlayerUpgradeContext\(search\.toString\(\)\) \?\? playerUpgradeContext : null/);
  assert.match(authClient, /playerUpgradeContext: handoff/);
  assert.match(authClient, /window\.location\.assign\(playerUpgradeContext \? playerUpgradeAccountPath\(playerUpgradeContext\) : "\/account"\)/);
  assert.match(authClient, /window\.history\.replaceState\(null, "", `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/);
  assert.match(loginRoute, /parsePlayerUpgradeContextFields/);
  assert.match(loginRoute, /authEmailUrl\(request, issued\.token, playerUpgradeContext\)/);
  assert.match(loginRoute, /raw\.length > 4096/);
  assert.match(accountClient, /resolvePlayerUpgradeHandoff\(currentSearch, billing\.locations\)/);
  assert.match(accountClient, /removePlayerUpgradeContextParams\(currentSearch\)/);
});

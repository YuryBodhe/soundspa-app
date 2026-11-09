import assert from "node:assert/strict";
import test from "node:test";
import { createGiftDraftUpdateHandler } from "./route";
import { SpaquatoriaGiftDraftError } from "@/db/v2/services/spaquatoriaGiftDrafts";

const session = { user: { id: "4a56aade-5d59-4d77-87cf-b4d3f82de4bc", emailVerifiedAt: new Date() } };

test("Gift draft PATCH rejects cross-origin and unverified requests before update", async () => {
  let updates = 0;
  const handler = createGiftDraftUpdateHandler({
    sameOrigin: () => false,
    getSession: async () => session,
    update: async () => { updates++; return {}; },
  });
  const request = new Request("https://soundspa.test/api/v2/customer/spaquatoria-gift/drafts/89cd111a-45bb-4500-902a-67f605484ec7", { method: "PATCH", body: JSON.stringify({ version: 1, legalName: "Test" }) });
  assert.equal((await handler(request, { params: Promise.resolve({ draftId: "89cd111a-45bb-4500-902a-67f605484ec7" }) })).status, 403);
  const unverified = createGiftDraftUpdateHandler({
    sameOrigin: () => true,
    getSession: async () => ({ user: { id: session.user.id, emailVerifiedAt: null } }),
    update: async () => { updates++; return {}; },
  });
  assert.equal((await unverified(request, { params: Promise.resolve({ draftId: "89cd111a-45bb-4500-902a-67f605484ec7" }) })).status, 401);
  assert.equal(updates, 0);
});

test("Gift draft PATCH requires a version and maps concurrent update conflicts to 409", async () => {
  let input: unknown;
  const handler = createGiftDraftUpdateHandler({
    sameOrigin: () => true,
    getSession: async () => session,
    update: async (value) => { input = value; return {}; },
  });
  const draftId = "89cd111a-45bb-4500-902a-67f605484ec7";
  const good = await handler(new Request(`https://soundspa.test/api/v2/customer/spaquatoria-gift/drafts/${draftId}`, { method: "PATCH", body: JSON.stringify({ version: 2, physicalAddress: "ул. Пример, 1" }) }), { params: Promise.resolve({ draftId }) });
  assert.equal(good.status, 200);
  assert.deepEqual(input, { authenticatedUserId: session.user.id, draftId, expectedVersion: 2, patch: { physicalAddress: "ул. Пример, 1" } });

  const conflict = createGiftDraftUpdateHandler({
    sameOrigin: () => true, getSession: async () => session,
    update: async () => { throw new SpaquatoriaGiftDraftError("version_conflict"); },
  });
  const stale = await conflict(new Request(`https://soundspa.test/api/v2/customer/spaquatoria-gift/drafts/${draftId}`, { method: "PATCH", body: JSON.stringify({ version: 1, legalName: "Concurrent" }) }), { params: Promise.resolve({ draftId }) });
  assert.equal(stale.status, 409);
});

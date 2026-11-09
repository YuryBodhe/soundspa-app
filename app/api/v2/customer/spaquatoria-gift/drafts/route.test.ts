import assert from "node:assert/strict";
import test from "node:test";
import { createGiftDraftCollectionHandlers } from "./route";

const ownerSession = { user: { id: "4a56aade-5d59-4d77-87cf-b4d3f82de4bc", emailVerifiedAt: new Date() } };
const body = JSON.stringify({ organizationId: "f1fb63bb-51c5-45e6-a68b-1341a7c189e0", locationId: "e8d95e94-34d6-461a-9de7-353733e19a1c" });

test("Gift draft collection rejects cross-origin POST before session lookup or persistence", async () => {
  let calls = 0;
  const handlers = createGiftDraftCollectionHandlers({
    sameOrigin: () => false,
    getSession: async () => { calls++; return ownerSession; },
    list: async () => [],
    createOrResume: async () => { calls++; return {}; },
  });
  const response = await handlers.POST(new Request("https://soundspa.test/api/v2/customer/spaquatoria-gift/drafts", { method: "POST", body }));
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("Gift draft collection requires a verified session and validates tenant identifiers", async () => {
  let writes = 0;
  const handlers = createGiftDraftCollectionHandlers({
    sameOrigin: () => true,
    getSession: async () => ({ user: { id: ownerSession.user.id, emailVerifiedAt: null } }),
    list: async () => [],
    createOrResume: async () => { writes++; return {}; },
  });
  const unverified = await handlers.POST(new Request("https://soundspa.test/api/v2/customer/spaquatoria-gift/drafts", { method: "POST", body }));
  assert.equal(unverified.status, 401);
  const invalid = createGiftDraftCollectionHandlers({
    sameOrigin: () => true, getSession: async () => ownerSession, list: async () => [],
    createOrResume: async () => { writes++; return {}; },
  });
  const badInput = await invalid.POST(new Request("https://soundspa.test/api/v2/customer/spaquatoria-gift/drafts", { method: "POST", body: JSON.stringify({ organizationId: "not-uuid", locationId: "x" }) }));
  assert.equal(badInput.status, 400);
  assert.equal(writes, 0);
});

test("verified Gift draft POST is same-origin and uses only the authenticated session user", async () => {
  const created: unknown[] = [];
  const handlers = createGiftDraftCollectionHandlers({
    sameOrigin: () => true,
    getSession: async () => ownerSession,
    list: async () => [],
    createOrResume: async (input) => { created.push(input); return { resumed: false }; },
  });
  const response = await handlers.POST(new Request("https://soundspa.test/api/v2/customer/spaquatoria-gift/drafts", { method: "POST", body }));
  assert.equal(response.status, 201);
  assert.deepEqual(created, [{ authenticatedUserId: ownerSession.user.id, organizationId: "f1fb63bb-51c5-45e6-a68b-1341a7c189e0", locationId: "e8d95e94-34d6-461a-9de7-353733e19a1c" }]);
});

test("resuming an existing shared Location draft returns success without another create status", async () => {
  const handlers = createGiftDraftCollectionHandlers({
    sameOrigin: () => true, getSession: async () => ownerSession, list: async () => [],
    createOrResume: async () => ({ resumed: true, draft: { id: "shared-draft" } }),
  });
  const response = await handlers.POST(new Request("https://soundspa.test/api/v2/customer/spaquatoria-gift/drafts", { method: "POST", body }));
  assert.equal(response.status, 200);
});

test("Gift draft GET exposes contents only after verified authentication", async () => {
  let listCalls = 0;
  const handlers = createGiftDraftCollectionHandlers({
    sameOrigin: () => true,
    getSession: async () => ownerSession,
    list: async (userId) => { listCalls++; assert.equal(userId, ownerSession.user.id); return [{ id: "draft" }]; },
    createOrResume: async () => ({}),
  });
  const response = await handlers.GET(new Request("https://soundspa.test/api/v2/customer/spaquatoria-gift/drafts"));
  assert.equal(response.status, 200);
  assert.equal(listCalls, 1);
});

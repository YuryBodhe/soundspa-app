import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createCustomerLocation } from "./customerLocations";

type QueryResult = unknown;
function query(result: QueryResult, onLock?: (mode: string) => void) {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "innerJoin", "orderBy"]) builder[method] = () => builder;
  builder.for = (mode: string) => { onLock?.(mode); return builder; };
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function fakeTransaction(options: { membershipRole?: string; noMembership?: boolean; archived?: boolean; count?: number; duplicate?: boolean } = {}) {
  const selected: QueryResult[] = [
    [{ id: "org-1", name: "Bodhe Spa", archivedAt: options.archived ? new Date() : null }],
    options.noMembership ? [] : [{ role: options.membershipRole ?? "owner", emailVerifiedAt: new Date(), disabledAt: null }],
    [{ count: options.count ?? 1 }],
    options.duplicate ? [{ id: "location-existing" }] : [],
  ];
  const lockModes: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const tx = {
    select: () => query(selected.shift() ?? [], (mode) => lockModes.push(mode)),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserted.push(value);
        return { returning: async () => [{ id: "location-new", name: value.name, slug: value.slug, timezone: value.timezone }] };
      },
    }),
  };
  return { tx, lockModes, inserted };
}

type Dependencies = NonNullable<Parameters<typeof createCustomerLocation>[1]>;
function dependencies(tx: ReturnType<typeof fakeTransaction>["tx"], events: unknown[], slugFactory = () => "hamam-north-abc12345"): Dependencies {
  return {
    transaction: async (callback: (tx: never) => Promise<unknown>) => callback(tx as never),
    limit: 20,
    slugFactory,
    recordEvent: async (_tx: never, event: unknown) => { events.push(event); },
  } as unknown as Dependencies;
}

const input = { authenticatedUserId: "user-1", organizationId: "org-1", name: "Hamam North", timezone: "Europe/Moscow" };

test("Owner creation locks the Organization and writes only a Location plus an audit event", async () => {
  const fake = fakeTransaction();
  const events: unknown[] = [];
  const created = await createCustomerLocation(input, dependencies(fake.tx, events));
  assert.deepEqual(created, { id: "location-new", name: "Hamam North", slug: "hamam-north-abc12345", timezone: "Europe/Moscow" });
  assert.deepEqual(fake.lockModes, ["update", "share"], "creation serializes Organization access and locks membership/user state");
  assert.equal(fake.inserted.length, 1);
  assert.deepEqual(fake.inserted[0], { organizationId: "org-1", name: "Hamam North", slug: "hamam-north-abc12345", timezone: "Europe/Moscow" });
  assert.equal(events.length, 1);
  assert.equal((events[0] as { eventType: string }).eventType, "location_created");
});

test("non-Owners, archived Organizations, duplicate names, and Location cap reject before insert", async () => {
  for (const [options, code] of [
    [{ membershipRole: "admin" }, "owner_required"],
    [{ membershipRole: "manager" }, "owner_required"],
    [{ noMembership: true }, "organization_unavailable"],
    [{ archived: true }, "organization_unavailable"],
    [{ duplicate: true }, "duplicate_name"],
    [{ count: 20 }, "location_limit"],
  ] as const) {
    const fake = fakeTransaction(options);
    await assert.rejects(createCustomerLocation(input, dependencies(fake.tx, [])), (error: { code?: string }) => error.code === code);
    assert.equal(fake.inserted.length, 0, `${code} must not insert a Location`);
  }
});

test("unique slug conflicts retry the complete transaction with a new server-generated slug", async () => {
  const first = fakeTransaction();
  const second = fakeTransaction();
  let attempt = 0;
  const slugs: string[] = [];
  const deps = dependencies(second.tx, [], () => {
    const slug = `hamam-north-0000000${attempt++}`;
    slugs.push(slug);
    return slug;
  });
  let transactionCount = 0;
  deps.transaction = async (callback) => {
    if (transactionCount++ === 0) {
      await callback(first.tx as never);
      throw Object.assign(new Error("unique collision"), { code: "23505", constraint: "locations_slug_unique" });
    }
    return callback(second.tx as never);
  };
  const created = await createCustomerLocation(input, deps);
  assert.equal(created.slug, slugs[1]);
  assert.equal(slugs.length, 2);
  assert.equal(transactionCount, 2);
});

test("creation service contains no trial, subscription, entitlement, order, or payment writes", async () => {
  const source = await readFile(new URL("./customerLocations.ts", import.meta.url), "utf8");
  const onboarding = await readFile(new URL("./customerOnboarding.ts", import.meta.url), "utf8");
  const stagingCompose = await readFile(new URL("../../../docker-compose.staging.yml", import.meta.url), "utf8");
  assert.doesNotMatch(source, /startSoundSpaTrial|locationSubscriptions|billingOrders|payments|entitlements/);
  assert.match(source, /for\("update"\)/);
  assert.match(source, /lower\(btrim\(\$\{locations\.name\}\)\)/);
  assert.match(stagingCompose, /V2_MAX_LOCATIONS_PER_ORGANIZATION: \$\{V2_MAX_LOCATIONS_PER_ORGANIZATION:-20\}/);
  assert.match(onboarding, /const trial = await createTrial\(location\.id, tx\)/, "first-Location signup keeps its existing trial creation path");
});

test("disposable PostgreSQL verifies tenant authorization, cap, slug retry, side effects, and concurrent creation", {
  skip: process.env.V2_CUSTOMER_LOCATION_TEST_ALLOW_DATABASE !== "1" ? "requires explicit opt-in and a disposable local PostgreSQL database" : false,
}, async () => {
  const { v2Db, v2Pool } = await import("../client");
  const schema = await import("../schema");
  const { eq, inArray } = await import("drizzle-orm");
  const targetUrl = new URL(process.env.V2_DATABASE_URL!);
  assert(new Set(["127.0.0.1", "::1", "localhost"]).has(targetUrl.hostname), "test DB host must be loopback");
  assert.equal(decodeURIComponent(targetUrl.pathname), "/soundspa_v2");
  assert.notEqual(decodeURIComponent(targetUrl.username), "soundspa_v2", "must use a dedicated test role");
  const identity = await v2Pool.query<{ database: string; role: string; address: string | null; migrations: number; latest: string }>(
    `SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address,
      (SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS migrations,
      (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest`,
  );
  const target = identity.rows[0];
  const address = target?.address?.split("/")[0] ?? "";
  assert.equal(target?.database, "soundspa_v2");
  assert.equal(target?.role, decodeURIComponent(targetUrl.username));
  assert.notEqual(target?.role, "postgres", "must not use the PostgreSQL superuser");
  assert(isIP(address) > 0 && new Set(["127.0.0.1", "::1"]).has(address));
  assert.equal(target?.migrations, 20);
  assert.equal(target?.latest, "1791986317531");
  const empty = await v2Pool.query<{ count: string }>(
    `SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) +
      (SELECT count(*) FROM monitoring_lifecycle_events) + (SELECT count(*) FROM location_core_trials) +
      (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM commercial_billing_orders) +
      (SELECT count(*) FROM commercial_payments) AS count`,
  );
  assert.equal(empty.rows[0]?.count, "0", "disposable test database must contain no customer or billing records");

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const now = new Date();
  const suffix = randomUUID();
  let ownerId = "";
  let organizationId = "";
  let otherOrganizationId = "";
  try {
    await v2Db.transaction(async (tx) => {
      const [organization] = await tx.insert(schema.organizations).values({ name: `location test ${suffix}` }).returning();
      organizationId = organization.id; organizationIds.push(organization.id);
      const [otherOrganization] = await tx.insert(schema.organizations).values({ name: `location test other ${suffix}` }).returning();
      otherOrganizationId = otherOrganization.id; organizationIds.push(otherOrganization.id);
      const createdUsers = await tx.insert(schema.users).values([
        { email: `owner-${suffix}@example.test`, emailVerifiedAt: now },
        { email: `admin-${suffix}@example.test`, emailVerifiedAt: now },
        { email: `manager-${suffix}@example.test`, emailVerifiedAt: now },
        { email: `unverified-${suffix}@example.test` },
        { email: `disabled-${suffix}@example.test`, emailVerifiedAt: now, disabledAt: now },
        { email: `outside-${suffix}@example.test`, emailVerifiedAt: now },
      ]).returning();
      userIds.push(...createdUsers.map((user) => user.id));
      [ownerId] = [createdUsers[0].id];
      await tx.insert(schema.organizationMembers).values([
        { organizationId, userId: createdUsers[0].id, role: "owner" },
        { organizationId, userId: createdUsers[1].id, role: "admin" },
        { organizationId, userId: createdUsers[2].id, role: "manager" },
        { organizationId, userId: createdUsers[3].id, role: "owner" },
        { organizationId, userId: createdUsers[4].id, role: "owner" },
        { organizationId: otherOrganizationId, userId: createdUsers[5].id, role: "owner" },
      ]);
    });

    const create = (userId: string, name = "New salon") => createCustomerLocation({
      authenticatedUserId: userId, organizationId, name, timezone: "Europe/Moscow",
    });
    const first = await create(ownerId);
    assert.match(first.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    await assert.rejects(create(userIds[1]), (error: { code?: string }) => error.code === "owner_required");
    await assert.rejects(create(userIds[2]), (error: { code?: string }) => error.code === "owner_required");
    await assert.rejects(create(userIds[3]), (error: { code?: string }) => error.code === "unverified");
    await assert.rejects(create(userIds[4]), (error: { code?: string }) => error.code === "owner_required");
    await assert.rejects(create(userIds[5]), (error: { code?: string }) => error.code === "organization_unavailable");
    await assert.rejects(create("00000000-0000-4000-8000-000000000000"), (error: { code?: string }) => error.code === "organization_unavailable");
    await assert.rejects(create(ownerId, "  new SALON "), (error: { code?: string }) => error.code === "duplicate_name");

    const competing = await Promise.allSettled([create(ownerId, "Concurrent Salon"), create(ownerId, " concurrent salon ")]);
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = competing.find((result) => result.status === "rejected");
    assert.equal(rejected?.status === "rejected" ? (rejected.reason as { code?: string }).code : null, "duplicate_name");

    const generatedSlugs = [first.slug, `collision-retry-${suffix.slice(0, 8)}`];
    const collisionResult = await createCustomerLocation({ authenticatedUserId: ownerId, organizationId, name: "Slug retry", timezone: "UTC" }, {
      slugFactory: () => generatedSlugs.shift() ?? `collision-retry-${randomUUID().slice(0, 8)}`,
    });
    assert.match(collisionResult.slug, /^collision-retry-/);

    const filler = Array.from({ length: 20 - 3 }, (_, index) => ({
      organizationId, name: `Filler ${index}`, slug: `filler-${suffix.slice(0, 8)}-${index}`, timezone: "UTC",
    }));
    await v2Db.insert(schema.locations).values(filler);
    await assert.rejects(create(ownerId, "Location twenty one"), (error: { code?: string }) => error.code === "location_limit");

    await v2Db.update(schema.organizations).set({ archivedAt: now }).where(eq(schema.organizations.id, otherOrganizationId));
    await assert.rejects(createCustomerLocation({ authenticatedUserId: userIds[5], organizationId: otherOrganizationId, name: "Archived", timezone: "UTC" }),
      (error: { code?: string }) => error.code === "organization_unavailable");

    const billingRows = await v2Pool.query<{ count: string }>(
      `SELECT (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM location_subscriptions) +
        (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_payments) AS count`,
    );
    assert.equal(billingRows.rows[0]?.count, "0", "Location creation must not add trials, subscriptions, orders, or payments");
    const organizationLocations = await v2Db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.organizationId, organizationId));
    assert.equal(organizationLocations.length, 20);
  } finally {
    try {
      for (const id of organizationIds) {
        await v2Db.delete(schema.monitoringLifecycleEvents).where(eq(schema.monitoringLifecycleEvents.organizationId, id));
        await v2Db.delete(schema.locations).where(eq(schema.locations.organizationId, id));
        await v2Db.delete(schema.organizationMembers).where(eq(schema.organizationMembers.organizationId, id));
        await v2Db.delete(schema.organizations).where(eq(schema.organizations.id, id));
      }
      if (userIds.length) await v2Db.delete(schema.users).where(inArray(schema.users.id, userIds));
    } finally {
      await v2Pool.end();
    }
  }
});

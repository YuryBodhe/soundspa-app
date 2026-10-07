import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";

class Rollback extends Error {}

async function main() {
  if (process.env.V2_PRODUCT_ADMIN_TEST_ALLOW_DATABASE !== "1") {
    throw new Error("Set V2_PRODUCT_ADMIN_TEST_ALLOW_DATABASE=1 to enable this rollback-only integration test.");
  }
  const connectionString = process.env.V2_DATABASE_URL;
  if (!connectionString) throw new Error("V2_DATABASE_URL is required for the local integration test.");
  const databaseUrl = new URL(connectionString);
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(databaseUrl.hostname)) {
    throw new Error("Refusing to run the Product Admin integration test against a non-local database.");
  }

  const [{ v2Db, v2Pool }, { resolveEffectiveChannelAccess }, schema, { createProduct, updateProduct, ProductAdminError }] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/queries/effectiveAccess"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/productAdmin"),
  ]);
  const { channelTracks, channels, commercialProductChannels, commercialProducts, locationChannelGrants, locationCoreTrials, locations, organizations } = schema;
  const suffix = randomUUID();
  const now = new Date();

  try {
    await v2Db.transaction(async (tx) => {
      const runInTransaction = <T>(operation: (inner: typeof tx) => Promise<T>) => tx.transaction(operation);
      const protectedProductsBefore = await tx.select({ id: commercialProducts.id, code: commercialProducts.code, name: commercialProducts.name, isActive: commercialProducts.isActive })
        .from(commercialProducts).where(inArray(commercialProducts.code, ["soundspa", "spaquatoria"])).orderBy(asc(commercialProducts.code));
      const protectedProductIds = protectedProductsBefore.map((product) => product.id);
      const protectedCompositionBefore = protectedProductIds.length
        ? await tx.select({ productId: commercialProductChannels.productId, channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(inArray(commercialProductChannels.productId, protectedProductIds)).orderBy(asc(commercialProductChannels.productId), asc(commercialProductChannels.channelId))
        : [];
      const grantsBefore = await tx.select({ id: locationChannelGrants.id, locationId: locationChannelGrants.locationId, channelId: locationChannelGrants.channelId, enabled: locationChannelGrants.enabled }).from(locationChannelGrants).orderBy(asc(locationChannelGrants.id));
      const [organization] = await tx.insert(organizations).values({ name: `product-admin-${suffix}` }).returning();
      const [location] = await tx.insert(locations).values({ organizationId: organization.id, name: "Product Admin Test", slug: `product-admin-${suffix}`, timezone: "UTC" }).returning();
      const makeChannel = async (name: string) => {
        const [channel] = await tx.insert(channels).values({ slug: `product-admin-${name}-${suffix}`, displayName: name, kind: "music", isPublished: true }).returning();
        await tx.insert(channelTracks).values({ channelId: channel.id, storageKey: `test/${suffix}/${name}.mp3`, originalFilename: `${name}.mp3`, sizeBytes: BigInt(1), sortOrder: 0 });
        return channel;
      };
      const first = await makeChannel("first");
      const second = await makeChannel("second");
      const [trialProduct] = await tx.insert(commercialProducts).values({ code: `trial-${suffix}`, name: "Test Trial", kind: "core", isActive: true }).returning();
      await tx.insert(locationCoreTrials).values({ locationId: location.id, productId: trialProduct.id, status: "active", startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 60_000) });

      const created = await createProduct({ name: "  Admin Test Product ", code: ` Product_Admin_${suffix} `, kind: "partner", isActive: false, channelIds: [first.id] }, runInTransaction);
      assert.equal(created.code, `product-admin-${suffix}`);
      assert.equal(created.isActive, false, "a Product can be created inactive");
      await assert.rejects(createProduct({ name: "Duplicate", code: created.code, kind: "core", isActive: true, channelIds: [] }, runInTransaction),
        (error: unknown) => error instanceof ProductAdminError && error.code === "PRODUCT_CODE_EXISTS");
      const [beforeUpdate] = await tx.select().from(commercialProducts).where(eq(commercialProducts.id, created.id));
      const firstComposition = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(eq(commercialProductChannels.productId, created.id));
      assert.deepEqual(firstComposition.map((item) => item.channelId), [first.id]);

      const accessBefore = new Map((await resolveEffectiveChannelAccess(location.id, now, tx)).map((item) => [item.id, item]));
      assert.equal(accessBefore.get(first.id)?.playable, false, "inactive Product must not grant its composed Channel");
      assert.equal(accessBefore.get(second.id)?.playable, false);

      await updateProduct(created.id, { name: "Updated Test Product", isActive: true, channelIds: [first.id] }, runInTransaction);
      const accessAfterActivate = new Map((await resolveEffectiveChannelAccess(location.id, now, tx)).map((item) => [item.id, item]));
      assert.equal(accessAfterActivate.get(first.id)?.playable, true, "active trial should include the active Product composition");

      const updated = await updateProduct(created.id, { name: "Updated Test Product", isActive: true, channelIds: [second.id] }, runInTransaction);
      assert.equal(updated.name, "Updated Test Product");
      assert.equal(updated.code, created.code);
      assert.equal(updated.kind, "partner");
      const secondComposition = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(eq(commercialProductChannels.productId, created.id));
      assert.deepEqual(secondComposition.map((item) => item.channelId), [second.id]);
      const accessAfterEdit = new Map((await resolveEffectiveChannelAccess(location.id, now, tx)).map((item) => [item.id, item]));
      assert.equal(accessAfterEdit.get(first.id)?.playable, false);
      assert.equal(accessAfterEdit.get(second.id)?.playable, true);

      await updateProduct(created.id, { name: updated.name, isActive: false, channelIds: [second.id] }, runInTransaction);
      const accessAfterDeactivate = new Map((await resolveEffectiveChannelAccess(location.id, now, tx)).map((item) => [item.id, item]));
      assert.equal(accessAfterDeactivate.get(second.id)?.playable, false, "deactivating a Product must remove its commercial access");
      const [afterUpdate] = await tx.select().from(commercialProducts).where(eq(commercialProducts.id, created.id));
      assert.equal(afterUpdate.code, beforeUpdate.code, "Product code remains immutable through the update service");
      assert.equal(afterUpdate.kind, beforeUpdate.kind, "Product kind remains unchanged through the update service");
      assert.deepEqual(await tx.select({ id: commercialProducts.id, code: commercialProducts.code, name: commercialProducts.name, isActive: commercialProducts.isActive }).from(commercialProducts).where(inArray(commercialProducts.code, ["soundspa", "spaquatoria"])).orderBy(asc(commercialProducts.code)), protectedProductsBefore);
      assert.deepEqual(protectedProductIds.length
        ? await tx.select({ productId: commercialProductChannels.productId, channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(inArray(commercialProductChannels.productId, protectedProductIds)).orderBy(asc(commercialProductChannels.productId), asc(commercialProductChannels.channelId))
        : [], protectedCompositionBefore);
      assert.deepEqual(await tx.select({ id: locationChannelGrants.id, locationId: locationChannelGrants.locationId, channelId: locationChannelGrants.channelId, enabled: locationChannelGrants.enabled }).from(locationChannelGrants).orderBy(asc(locationChannelGrants.id)), grantsBefore, "Product composition edits do not create Location Grants");

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  console.info("Product Admin integration PASS: create, immutable code/kind, atomic composition edit, activation effects, effective-access regression, and transaction rollback.");
  await v2Pool.end();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

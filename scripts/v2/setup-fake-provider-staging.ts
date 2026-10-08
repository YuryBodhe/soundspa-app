import { and, eq } from "drizzle-orm";
import { isIP } from "node:net";

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  const parsed = databaseUrl ? new URL(databaseUrl) : null;
  const secret = process.env.V2_FAKE_PROVIDER_SECRET;
  if (process.env.V2_FAKE_PROVIDER_SETUP_STAGING !== "1" ||
      process.env.V2_DEPLOYMENT_ENV !== "staging" ||
      process.env.V2_FAKE_PROVIDER_ENABLED !== "1" ||
      process.env.V2_PUBLIC_ORIGIN !== "https://test.soundspa.bodhemusic.com" ||
      !secret || Buffer.byteLength(secret, "utf8") < 32 ||
      parsed?.hostname !== "v2-postgres" || (parsed.port && parsed.port !== "5432") ||
      parsed.pathname !== "/soundspa_v2" || decodeURIComponent(parsed.username) !== "soundspa_v2") {
    throw new Error("Refusing Fake Provider setup without explicit staging guards and exact V2 Compose database identity.");
  }

  const { v2Db, v2Pool } = await import("../../db/v2/client");
  try {
    const identity = await v2Pool.query<{ database: string; address: string | null; port: number; role: string }>(
      "SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port, current_user AS role",
    );
    const db = identity.rows[0];
    const address = db?.address?.split("/")[0] ?? "";
    const octets = address.split(".").map(Number);
    const privateAddress = isIP(address) === 4 && octets.length === 4 && (
      octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
    if (!db || db.database !== "soundspa_v2" || db.role !== "soundspa_v2" || db.port !== 5432 || !privateAddress) {
      throw new Error("Refusing setup: connected PostgreSQL identity is not the V2 staging database.");
    }

    const schema = await import("../../db/v2/schema");
    const result = await v2Db.transaction(async (tx) => {
      const [product] = await tx.select().from(schema.commercialProducts)
        .where(and(eq(schema.commercialProducts.code, "soundspa"), eq(schema.commercialProducts.isActive, true))).limit(1);
      if (!product) throw new Error("Active SoundSpa Basic Product was not found; no setup changes committed.");

      const [existingProvider] = await tx.select().from(schema.commercialPaymentProviders)
        .where(eq(schema.commercialPaymentProviders.code, "fake-staging")).limit(1);
      if (existingProvider) {
        await tx.update(schema.commercialPaymentProviders).set({ displayName: "Staging Fake Payment", isEnabled: true, updatedAt: new Date() })
          .where(eq(schema.commercialPaymentProviders.code, "fake-staging"));
      } else {
        await tx.insert(schema.commercialPaymentProviders).values({ code: "fake-staging", displayName: "Staging Fake Payment", isEnabled: true });
      }

      const [existingLocation] = await tx.select({ location: schema.locations, organizationName: schema.organizations.name })
        .from(schema.locations).innerJoin(schema.organizations, eq(schema.organizations.id, schema.locations.organizationId))
        .where(eq(schema.locations.slug, "fake-provider-test-ru")).limit(1);
      let location = existingLocation?.location;
      if (!location) {
        const [organization] = await tx.insert(schema.organizations).values({ name: "Fake Provider Acceptance" }).returning();
        [location] = await tx.insert(schema.locations).values({
          organizationId: organization.id,
          name: "Fake Provider Acceptance",
          slug: "fake-provider-test-ru",
          timezone: "Europe/Moscow",
          marketCode: "RU",
        }).returning();
      } else if (location.name !== "Fake Provider Acceptance" || existingLocation.organizationName !== "Fake Provider Acceptance" || location.marketCode !== "RU" || location.archivedAt) {
        throw new Error("The reserved Fake Provider test Location slug is occupied by unexpected data; no setup changes committed.");
      }

      const [trials, benefits, subscriptions, devices, serviceAccess, channelEntitlements, channelGrants, memberships, payments] = await Promise.all([
        tx.select({ id: schema.locationCoreTrials.id }).from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, location.id)),
        tx.select({ id: schema.commercialPartnerBenefits.id }).from(schema.commercialPartnerBenefits).where(eq(schema.commercialPartnerBenefits.locationId, location.id)),
        tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.locationId, location.id)),
        tx.select({ id: schema.devices.id }).from(schema.devices).where(eq(schema.devices.locationId, location.id)),
        tx.select({ locationId: schema.locationServiceAccess.locationId }).from(schema.locationServiceAccess).where(eq(schema.locationServiceAccess.locationId, location.id)),
        tx.select({ locationId: schema.locationChannelEntitlements.locationId }).from(schema.locationChannelEntitlements).where(eq(schema.locationChannelEntitlements.locationId, location.id)),
        tx.select({ id: schema.locationChannelGrants.id }).from(schema.locationChannelGrants).where(eq(schema.locationChannelGrants.locationId, location.id)),
        tx.select({ organizationId: schema.organizationMembers.organizationId }).from(schema.organizationMembers).where(eq(schema.organizationMembers.organizationId, location.organizationId)),
        tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments).where(eq(schema.commercialPayments.locationId, location.id)),
      ]);
      if (trials.length + benefits.length + subscriptions.length + devices.length + serviceAccess.length + channelEntitlements.length + channelGrants.length + memberships.length + payments.length > 0) {
        throw new Error("Reserved test Location has existing membership, access, billing, or Device data; no setup changes committed.");
      }

      const externalReference = "fake-staging-soundspa-basic";
      const [existingRoute] = await tx.select().from(schema.commercialPaymentRoutes).where(and(
        eq(schema.commercialPaymentRoutes.marketCode, "RU"),
        eq(schema.commercialPaymentRoutes.productId, product.id),
        eq(schema.commercialPaymentRoutes.providerCode, "fake-staging"),
        eq(schema.commercialPaymentRoutes.externalReference, externalReference),
      )).limit(1);
      let route = existingRoute;
      if (!route) {
        [route] = await tx.insert(schema.commercialPaymentRoutes).values({
          marketCode: "RU", productId: product.id, providerCode: "fake-staging", externalReference, isEnabled: true,
        }).returning();
      } else if (!route.isEnabled) {
        [route] = await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: true, updatedAt: new Date() })
          .where(eq(schema.commercialPaymentRoutes.id, route.id)).returning();
      }
      return { locationId: location.id, productId: product.id, routeId: route.id };
    });
    console.info(JSON.stringify({ setup: "verified", market: "RU", provider: "fake-staging", product: "soundspa", ...result }));
  } finally {
    await v2Pool.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Fake Provider setup failed"); process.exitCode = 1; });

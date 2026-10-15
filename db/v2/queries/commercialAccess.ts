import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { v2Db } from "../client";
import { commercialPartnerBenefits, commercialPartners, commercialProductChannels, commercialProducts, locationCoreTrials, locationSubscriptions } from "../schema";

export type CommercialAccessSource = "trial" | "subscription" | "partner_benefit";
export type CommercialChannelAccess = Map<string, Set<CommercialAccessSource>>;
export type CommercialProductChannelAccess = Map<string, Map<string, Set<CommercialAccessSource>>>;
type SelectDb = Pick<typeof v2Db, "select">;

export async function resolveCommercialProductChannelAccess(locationId: string, now: Date, db: SelectDb = v2Db): Promise<CommercialProductChannelAccess> {
  const result: CommercialProductChannelAccess = new Map();
  const add = (productId: string, channelId: string, source: CommercialAccessSource) => {
    const channels = result.get(productId) ?? new Map<string, Set<CommercialAccessSource>>();
    const sources = channels.get(channelId) ?? new Set<CommercialAccessSource>();
    sources.add(source);
    channels.set(channelId, sources);
    result.set(productId, channels);
  };

  // A transaction executor may be backed by one pg client; keep these reads
  // sequential so rollback-only access checks never overlap on that client.
  const trials = await db.select({ productId: commercialProductChannels.productId, channelId: commercialProductChannels.channelId })
      .from(locationCoreTrials)
      .innerJoin(commercialProducts, and(eq(commercialProducts.id, locationCoreTrials.productId), eq(commercialProducts.isActive, true)))
      .innerJoin(commercialProductChannels, eq(commercialProductChannels.productId, commercialProducts.id))
      .where(and(eq(locationCoreTrials.locationId, locationId), isNull(locationCoreTrials.invalidatedByResetId), eq(locationCoreTrials.status, "active"), lte(locationCoreTrials.startsAt, now), gt(locationCoreTrials.endsAt, now)));
  const subscriptions = await db.select({ productId: commercialProductChannels.productId, channelId: commercialProductChannels.channelId })
      .from(locationSubscriptions)
      .innerJoin(commercialProducts, and(eq(commercialProducts.id, locationSubscriptions.productId), eq(commercialProducts.isActive, true)))
      .innerJoin(commercialProductChannels, eq(commercialProductChannels.productId, commercialProducts.id))
      .where(and(eq(locationSubscriptions.locationId, locationId), isNull(locationSubscriptions.invalidatedByResetId), or(eq(locationSubscriptions.status, "active"), eq(locationSubscriptions.status, "canceled")), lte(locationSubscriptions.startsAt, now), or(isNull(locationSubscriptions.currentPeriodEndsAt), gt(locationSubscriptions.currentPeriodEndsAt, now))));
  const benefits = await db.select({ productId: commercialProductChannels.productId, channelId: commercialProductChannels.channelId })
      .from(commercialPartnerBenefits)
      .innerJoin(commercialPartners, and(eq(commercialPartners.id, commercialPartnerBenefits.partnerId), eq(commercialPartners.isActive, true)))
      .innerJoin(commercialProducts, and(eq(commercialProducts.id, commercialPartnerBenefits.productId), eq(commercialProducts.isActive, true)))
      .innerJoin(commercialProductChannels, eq(commercialProductChannels.productId, commercialProducts.id))
      .where(and(eq(commercialPartnerBenefits.locationId, locationId), lte(commercialPartnerBenefits.startsAt, now), or(isNull(commercialPartnerBenefits.endsAt), gt(commercialPartnerBenefits.endsAt, now))));
  for (const row of trials) add(row.productId, row.channelId, "trial");
  for (const row of subscriptions) add(row.productId, row.channelId, "subscription");
  for (const row of benefits) add(row.productId, row.channelId, "partner_benefit");
  return result;
}

export async function resolveCommercialProductAccess(locationId: string, now: Date, db: SelectDb = v2Db): Promise<CommercialChannelAccess> {
  const productAccess = await resolveCommercialProductChannelAccess(locationId, now, db);
  const result: CommercialChannelAccess = new Map();
  for (const channels of productAccess.values()) for (const [channelId, sources] of channels) {
    const combined = result.get(channelId) ?? new Set<CommercialAccessSource>();
    for (const source of sources) combined.add(source);
    result.set(channelId, combined);
  }
  return result;
}

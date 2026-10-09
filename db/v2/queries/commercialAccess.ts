import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { v2Db } from "../client";
import { commercialPartnerBenefits, commercialPartners, commercialProductChannels, commercialProducts, locationCoreTrials, locationSubscriptions } from "../schema";

export type CommercialAccessSource = "trial" | "subscription" | "partner_benefit";
export type CommercialChannelAccess = Map<string, Set<CommercialAccessSource>>;
type SelectDb = Pick<typeof v2Db, "select">;

export async function resolveCommercialProductAccess(locationId: string, now: Date, db: SelectDb = v2Db): Promise<CommercialChannelAccess> {
  const result: CommercialChannelAccess = new Map();
  const add = (channelId: string, source: CommercialAccessSource) => {
    const sources = result.get(channelId) ?? new Set<CommercialAccessSource>();
    sources.add(source);
    result.set(channelId, sources);
  };

  // A transaction executor may be backed by one pg client; keep these reads
  // sequential so rollback-only access checks never overlap on that client.
  const trials = await db.select({ channelId: commercialProductChannels.channelId })
      .from(locationCoreTrials)
      .innerJoin(commercialProducts, and(eq(commercialProducts.id, locationCoreTrials.productId), eq(commercialProducts.isActive, true)))
      .innerJoin(commercialProductChannels, eq(commercialProductChannels.productId, commercialProducts.id))
      .where(and(eq(locationCoreTrials.locationId, locationId), isNull(locationCoreTrials.invalidatedByResetId), eq(locationCoreTrials.status, "active"), lte(locationCoreTrials.startsAt, now), gt(locationCoreTrials.endsAt, now)));
  const subscriptions = await db.select({ channelId: commercialProductChannels.channelId })
      .from(locationSubscriptions)
      .innerJoin(commercialProducts, and(eq(commercialProducts.id, locationSubscriptions.productId), eq(commercialProducts.isActive, true)))
      .innerJoin(commercialProductChannels, eq(commercialProductChannels.productId, commercialProducts.id))
      .where(and(eq(locationSubscriptions.locationId, locationId), isNull(locationSubscriptions.invalidatedByResetId), or(eq(locationSubscriptions.status, "active"), eq(locationSubscriptions.status, "canceled")), lte(locationSubscriptions.startsAt, now), or(isNull(locationSubscriptions.currentPeriodEndsAt), gt(locationSubscriptions.currentPeriodEndsAt, now))));
  const benefits = await db.select({ channelId: commercialProductChannels.channelId })
      .from(commercialPartnerBenefits)
      .innerJoin(commercialPartners, and(eq(commercialPartners.id, commercialPartnerBenefits.partnerId), eq(commercialPartners.isActive, true)))
      .innerJoin(commercialProducts, and(eq(commercialProducts.id, commercialPartnerBenefits.productId), eq(commercialProducts.isActive, true)))
      .innerJoin(commercialProductChannels, eq(commercialProductChannels.productId, commercialProducts.id))
      .where(and(eq(commercialPartnerBenefits.locationId, locationId), lte(commercialPartnerBenefits.startsAt, now), or(isNull(commercialPartnerBenefits.endsAt), gt(commercialPartnerBenefits.endsAt, now))));
  for (const row of trials) add(row.channelId, "trial");
  for (const row of subscriptions) add(row.channelId, "subscription");
  for (const row of benefits) add(row.channelId, "partner_benefit");
  return result;
}

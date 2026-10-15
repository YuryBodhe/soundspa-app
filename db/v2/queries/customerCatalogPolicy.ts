import { and, eq, inArray } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialPartnerBenefits,
  commercialProductChannels,
  commercialProductOrganizationAuthorizations,
  commercialProducts,
  commercialRegistrationLinkGrants,
  commercialRegistrationLinkRedemptions,
  locationCoreTrials,
  locationSubscriptions,
  locations,
} from "../schema";

type PolicyDb = Pick<typeof v2Db, "select">;

export type CustomerCatalogProductPolicy = {
  productChannelIds: Map<string, Set<string>>;
  publicProductIds: Set<string>;
  assignedProductIds: Set<string>;
};

const emptyPolicy = (): CustomerCatalogProductPolicy => ({
  productChannelIds: new Map(),
  publicProductIds: new Set(),
  assignedProductIds: new Set(),
});

/**
 * Build a generic Product-to-channel catalog policy. Location records are
 * scoped to this Location; organization authorizations intentionally apply to
 * each Location in their Organization, including revoked rows as history.
 */
export async function getCustomerCatalogProductPolicy(locationId: string, db: PolicyDb = v2Db): Promise<CustomerCatalogProductPolicy> {
  const [location] = await db.select({ organizationId: locations.organizationId }).from(locations).where(eq(locations.id, locationId)).limit(1);
  if (!location) return emptyPolicy();

  const products = await db.select({ id: commercialProducts.id, catalogVisibility: commercialProducts.catalogVisibility }).from(commercialProducts);
  if (!products.length) return emptyPolicy();
  const productIds = products.map(({ id }) => id);
  // Transaction-backed executors use one pg client; keep queries sequential.
  const composition = await db.select({ productId: commercialProductChannels.productId, channelId: commercialProductChannels.channelId })
    .from(commercialProductChannels).where(inArray(commercialProductChannels.productId, productIds));
  const trials = await db.select({ productId: locationCoreTrials.productId }).from(locationCoreTrials)
    .where(and(eq(locationCoreTrials.locationId, locationId), inArray(locationCoreTrials.productId, productIds)));
  const subscriptions = await db.select({ productId: locationSubscriptions.productId }).from(locationSubscriptions)
    .where(and(eq(locationSubscriptions.locationId, locationId), inArray(locationSubscriptions.productId, productIds)));
  const benefits = await db.select({ productId: commercialPartnerBenefits.productId }).from(commercialPartnerBenefits)
    .where(and(eq(commercialPartnerBenefits.locationId, locationId), inArray(commercialPartnerBenefits.productId, productIds)));
  const linkGrants = await db.select({ productId: commercialRegistrationLinkGrants.productId }).from(commercialRegistrationLinkGrants)
    .where(and(eq(commercialRegistrationLinkGrants.locationId, locationId), inArray(commercialRegistrationLinkGrants.productId, productIds)));
  const linkRedemptions = await db.select({ productId: commercialRegistrationLinkRedemptions.productId }).from(commercialRegistrationLinkRedemptions)
    .where(and(eq(commercialRegistrationLinkRedemptions.firstLocationId, locationId), inArray(commercialRegistrationLinkRedemptions.productId, productIds)));
  const organizationAuthorizations = await db.select({ productId: commercialProductOrganizationAuthorizations.productId }).from(commercialProductOrganizationAuthorizations)
    .where(and(eq(commercialProductOrganizationAuthorizations.organizationId, location.organizationId), inArray(commercialProductOrganizationAuthorizations.productId, productIds)));

  const productChannelIds = new Map<string, Set<string>>();
  for (const row of composition) {
    const channelIds = productChannelIds.get(row.productId) ?? new Set<string>();
    channelIds.add(row.channelId);
    productChannelIds.set(row.productId, channelIds);
  }

  const assignedProductIds = new Set<string>();
  for (const row of [...trials, ...subscriptions, ...benefits, ...linkGrants, ...linkRedemptions, ...organizationAuthorizations]) {
    if (row.productId) assignedProductIds.add(row.productId);
  }

  return {
    productChannelIds,
    publicProductIds: new Set(products.filter((product) => product.catalogVisibility === "public").map(({ id }) => id)),
    assignedProductIds,
  };
}

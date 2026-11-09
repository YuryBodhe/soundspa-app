import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialPartnerBenefits,
  commercialProductChannels,
  commercialProductOrganizationAuthorizations,
  commercialProducts,
  deviceProductAssignments,
  devices,
  commercialRegistrationLinkGrants,
  commercialRegistrationLinkRedemptions,
  locationCoreTrials,
  locationProductPromotionalAccess,
  locationSubscriptions,
  locations,
  organizationCoreTrialLocations,
  organizationCoreTrials,
} from "../schema";
import { SOUNDSPA_PRODUCT_CODE } from "./commercialProducts";

type PolicyDb = Pick<typeof v2Db, "select">;

export type CustomerCatalogProductPolicy = {
  productChannelIds: Map<string, Set<string>>;
  productDisplayNames: Map<string, string>;
  publicProductIds: Set<string>;
  assignedProductIds: Set<string>;
  /** null means the caller is a non-device preview; an empty set denies every Product. */
  activeDeviceProductIds: Set<string> | null;
};

const emptyPolicy = (): CustomerCatalogProductPolicy => ({
  productChannelIds: new Map(),
  productDisplayNames: new Map(),
  publicProductIds: new Set(),
  assignedProductIds: new Set(),
  activeDeviceProductIds: null,
});

/**
 * Build a generic Product-to-channel catalog policy. Location records are
 * scoped to this Location; organization authorizations intentionally apply to
 * each Location in their Organization, including revoked rows as history.
 */
export async function getCustomerCatalogProductPolicy(locationId: string, db: PolicyDb = v2Db, deviceId?: string): Promise<CustomerCatalogProductPolicy> {
  const [location] = await db.select({ organizationId: locations.organizationId }).from(locations).where(eq(locations.id, locationId)).limit(1);
  if (!location) return emptyPolicy();

  const products = await db.select({
    id: commercialProducts.id,
    name: commercialProducts.name,
    catalogVisibility: commercialProducts.catalogVisibility,
  }).from(commercialProducts);
  if (!products.length) return emptyPolicy();
  const productIds = products.map(({ id }) => id);
  // Transaction-backed executors use one pg client; keep queries sequential.
  const composition = await db.select({ productId: commercialProductChannels.productId, channelId: commercialProductChannels.channelId })
    .from(commercialProductChannels).where(inArray(commercialProductChannels.productId, productIds));
  const trials = await db.select({ productId: locationCoreTrials.productId }).from(locationCoreTrials)
    .innerJoin(commercialProducts, eq(commercialProducts.id, locationCoreTrials.productId))
    .where(and(eq(locationCoreTrials.locationId, locationId), ne(commercialProducts.code, SOUNDSPA_PRODUCT_CODE), inArray(locationCoreTrials.productId, productIds)));
  const organizationTrials = await db.select({ productId: organizationCoreTrials.productId }).from(organizationCoreTrialLocations)
    .innerJoin(organizationCoreTrials, and(eq(organizationCoreTrials.id, organizationCoreTrialLocations.organizationTrialId), eq(organizationCoreTrials.organizationId, location.organizationId)))
    .where(and(eq(organizationCoreTrialLocations.locationId, locationId), inArray(organizationCoreTrialLocations.organizationId, [location.organizationId])));
  const promotions = await db.select({ productId: locationProductPromotionalAccess.productId }).from(locationProductPromotionalAccess)
    .where(and(eq(locationProductPromotionalAccess.locationId, locationId), inArray(locationProductPromotionalAccess.productId, productIds)));
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

  let activeDeviceProductIds: Set<string> | null = null;
  if (deviceId) {
    const assignments = await db.select({ productId: deviceProductAssignments.productId })
      .from(deviceProductAssignments)
      .innerJoin(devices, and(
        eq(devices.id, deviceProductAssignments.deviceId),
        eq(devices.locationId, locationId),
        eq(devices.status, "active"),
        isNotNull(devices.credentialHash),
        isNull(devices.revokedAt),
      ))
      .where(and(
        eq(deviceProductAssignments.deviceId, deviceId),
        isNull(deviceProductAssignments.revokedAt),
        inArray(deviceProductAssignments.productId, productIds),
      ));
    activeDeviceProductIds = new Set(assignments.map(({ productId }) => productId));
  }

  const productChannelIds = new Map<string, Set<string>>();
  for (const row of composition) {
    const channelIds = productChannelIds.get(row.productId) ?? new Set<string>();
    channelIds.add(row.channelId);
    productChannelIds.set(row.productId, channelIds);
  }

  const assignedProductIds = new Set<string>();
  for (const row of [...trials, ...organizationTrials, ...promotions, ...subscriptions, ...benefits, ...linkGrants, ...linkRedemptions, ...organizationAuthorizations]) {
    if (row.productId) assignedProductIds.add(row.productId);
  }

  return {
    productChannelIds,
    productDisplayNames: new Map(products.map(({ id, name }) => [id, name])),
    publicProductIds: new Set(products.filter((product) => product.catalogVisibility === "public").map(({ id }) => id)),
    assignedProductIds,
    activeDeviceProductIds,
  };
}

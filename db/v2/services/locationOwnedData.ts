import { eq } from "drizzle-orm";
import { v2Db } from "../client";
import { locationChannelEntitlements, locationChannelGrants, locationChannelVisibility, locationServiceAccess } from "../schema";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

export async function deleteLocationOwnedData(tx: V2Transaction, locationId: string) {
  const visibility = await tx.delete(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, locationId)).returning({ channelId: locationChannelVisibility.channelId });
  const grants = await tx.delete(locationChannelGrants).where(eq(locationChannelGrants.locationId, locationId)).returning({ id: locationChannelGrants.id });
  const entitlements = await tx.delete(locationChannelEntitlements).where(eq(locationChannelEntitlements.locationId, locationId)).returning({ channelId: locationChannelEntitlements.channelId });
  const serviceAccess = await tx.delete(locationServiceAccess).where(eq(locationServiceAccess.locationId, locationId)).returning({ locationId: locationServiceAccess.locationId });
  return { visibility: visibility.length, grants: grants.length, entitlements: entitlements.length, serviceAccess: serviceAccess.length };
}

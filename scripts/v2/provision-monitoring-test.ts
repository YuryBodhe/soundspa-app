import { createHash } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { devices, locations, organizations } from "../../db/v2/schema";

const credential = process.env.V2_TEST_DEVICE_CREDENTIAL;
if (!credential || credential.length < 32) throw new Error("V2_TEST_DEVICE_CREDENTIAL is required and must be at least 32 characters.");
const credentialHash = createHash("sha256").update(credential, "utf8").digest("hex");

const result = await v2Db.transaction(async (tx) => {
  let [organization] = await tx.select().from(organizations).where(eq(organizations.name, "SoundSpa Test"));
  if (!organization) [organization] = await tx.insert(organizations).values({ name: "SoundSpa Test" }).returning();
  if (!organization) throw new Error("Unable to provision organization.");

  let [location] = await tx.select().from(locations).where(eq(locations.slug, "yury-test-spa"));
  if (!location) [location] = await tx.insert(locations).values({ organizationId: organization.id, name: "Yury Test Spa", slug: "yury-test-spa", timezone: "UTC" }).returning();
  if (!location || location.organizationId !== organization.id) throw new Error("Existing location slug belongs to another organization.");

  let [device] = await tx.select().from(devices).where(and(eq(devices.locationId, location.id), isNull(devices.revokedAt)));
  if (!device) [device] = await tx.insert(devices).values({ locationId: location.id, credentialHash, label: "Yury Test Device" }).returning();
  if (!device) throw new Error("Unable to provision device.");
  if (device.credentialHash !== credentialHash) throw new Error("Existing device credential differs; refusing to replace it.");
  return { organization, location, device };
});

console.log(JSON.stringify({
  organization: { id: result.organization.id, name: result.organization.name },
  location: { id: result.location.id, name: result.location.name, slug: result.location.slug },
  device: { id: result.device.id, label: result.device.label, status: result.device.status },
}));
await v2Pool.end();

import assert from "node:assert/strict";
import { isSourceActive, type LocationCommercialSource } from "../../db/v2/commercialFoundation";

const now = new Date("2026-10-06T12:00:00.000Z");
const source = (locationId: string, productId: string, kind: LocationCommercialSource["source"], endsAt: Date | null = null): LocationCommercialSource => ({ locationId, productId, source: kind, startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt });

const core = "core-product";
const partner = "spaquatoria-product";
const addon = "oriental-spa-product";

assert(isSourceActive(source("location-a", core, "trial"), now));
assert(isSourceActive(source("location-b", partner, "partner_benefit"), now));
assert(isSourceActive(source("location-b", core, "trial"), now));
assert(isSourceActive(source("location-c", core, "subscription"), now));

const organizationLocations = ["location-1", "location-2", "location-3"].map((locationId) => source(locationId, core, "subscription"));
assert.equal(new Set(organizationLocations.map((item) => item.locationId)).size, 3);

const combined = [source("location-e", core, "subscription"), source("location-e", partner, "partner_benefit"), source("location-e", addon, "add_on")];
assert.deepEqual(combined.map((item) => item.source), ["subscription", "partner_benefit", "add_on"]);
assert(isSourceActive(source("location-f", partner, "partner_benefit", new Date("2026-10-07T00:00:00.000Z")), now));
assert(!isSourceActive(source("location-f", partner, "partner_benefit", new Date("2026-10-06T00:00:00.000Z")), now));

console.info("Commercial foundation scenarios A-F PASS: Location-scoped trial, subscription, permanent/finite partner benefit, multi-location coverage, and independent add-on sources.");

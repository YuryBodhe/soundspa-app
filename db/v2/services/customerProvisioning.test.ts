import assert from "node:assert/strict";
import test from "node:test";
import { CustomerProvisioningError, validateCustomerProvisioningInput } from "./customerProvisioning";

test("customer Organization and Location names accept and preserve Unicode scripts", () => {
  const names = [
    ["Салон Москва", "Точка Арбат"],
    ["Spa Việt Nam", "Điểm Hồ Chí Minh"],
    ["ร้านสปา กรุงเทพ", "สาขา สุขุมวิท"],
    ["SoundSpa Salon", "Central Branch"],
  ];

  for (const [organizationName, locationName] of names) {
    const validated = validateCustomerProvisioningInput({
      organizationName,
      locationName,
      slug: "soundspa-location-test",
      timezone: "UTC",
    });
    assert.equal(validated.organizationName, organizationName);
    assert.equal(validated.locationName, locationName);
    assert.equal(validated.contactEmail, null);
  }
});

test("customer provisioning trims optional contact email and rejects malformed addresses", () => {
  const valid = validateCustomerProvisioningInput({ organizationName: "Spa", contactEmail: "  contact@example.com ", locationName: "Main", slug: "spa-main", timezone: "UTC" });
  assert.equal(valid.contactEmail, "contact@example.com");
  assert.throws(() => validateCustomerProvisioningInput({ organizationName: "Spa", contactEmail: "bad", locationName: "Main", slug: "spa-main", timezone: "UTC" }), (error: unknown) => error instanceof CustomerProvisioningError && error.code === "validation");
});

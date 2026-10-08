import assert from "node:assert/strict";
import test from "node:test";
import { validateCustomerProvisioningInput } from "./customerProvisioning";

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
  }
});

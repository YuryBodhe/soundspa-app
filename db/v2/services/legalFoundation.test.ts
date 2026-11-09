import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePhysicalLocationKey,
  normalizeRussianLegalProfile,
  sha256LegalDocumentContent,
} from "./legalFoundation";

test("Russian legal profile normalizes expected organization and individual entrepreneur identifiers", () => {
  assert.deepEqual(normalizeRussianLegalProfile({
    legalForm: "ru_legal_entity", legalName: " ООО Ромашка ", taxId: "7701 234567", registrationNumber: "1027700132195",
  }), {
    legalForm: "ru_legal_entity", legalName: "ООО Ромашка", taxId: "7701234567",
    registrationNumber: "1027700132195", registeredAddress: null,
  });
  assert.equal(normalizeRussianLegalProfile({
    legalForm: "ru_individual_entrepreneur", legalName: "ИП Иванов", taxId: "123456789012", registrationNumber: "123456789012345",
  }).taxId, "123456789012");
});

test("legal profile rejects unknown forms, malformed identifiers and overlong fields", () => {
  for (const input of [
    { legalForm: "company", legalName: "x", taxId: "1234567890", registrationNumber: "1234567890123" },
    { legalForm: "ru_legal_entity", legalName: "x", taxId: "123", registrationNumber: "1234567890123" },
    { legalForm: "ru_individual_entrepreneur", legalName: "x", taxId: "1234567890", registrationNumber: "123456789012345" },
    { legalForm: "ru_legal_entity", legalName: " ", taxId: "1234567890", registrationNumber: "1234567890123" },
  ]) assert.throws(() => normalizeRussianLegalProfile(input), { code: "invalid_profile" });
});

test("physical location key normalization collapses Unicode, punctuation and spacing variants", () => {
  assert.equal(normalizePhysicalLocationKey("  ул. Ленина, 10  "), normalizePhysicalLocationKey("УЛ ЛЕНИНА № 10"));
  assert.throws(() => normalizePhysicalLocationKey("  "), { code: "invalid_profile" });
});

test("legal document hash is SHA-256 over exact UTF-8 content", () => {
  assert.equal(sha256LegalDocumentContent("Соглашение"), "5bb14c8925f98b78abf7f3d36a9ea1cda8479430f7d601659e1e29db06917b15");
  assert.throws(() => sha256LegalDocumentContent("  "), { code: "document_unavailable" });
});

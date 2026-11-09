import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeSpaquatoriaGiftDraft, missingSpaquatoriaGiftDraftFields, normalizeSpaquatoriaGiftDraftPatch,
  SpaquatoriaGiftDraftValidationError, type SpaquatoriaGiftDraftFields,
} from "./spaquatoriaGiftDraftModel";

const empty: SpaquatoriaGiftDraftFields = {
  legalForm: null, legalName: null, taxId: null, registrationNumber: null, registeredAddress: null,
  physicalAddress: null, normalizedPhysicalAddress: null, representativeName: null, representativeRole: null,
  representativeEmail: null, representativePhone: null, authorityStatement: null,
};

test("draft normalization preserves partial legal identifiers and trims nullable form fields", () => {
  const patch = normalizeSpaquatoriaGiftDraftPatch({ legalForm: "ru_legal_entity", legalName: "  ООО Тест  ", taxId: "77 01", registrationNumber: "102", registeredAddress: " " });
  assert.deepEqual(patch, { legalForm: "ru_legal_entity", legalName: "ООО Тест", taxId: "7701", registrationNumber: "102", registeredAddress: null });
});

test("draft addresses are normalized but duplicate physical addresses are not reserved", () => {
  const first = normalizeSpaquatoriaGiftDraftPatch({ physicalAddress: "г. Москва, ул. Тестовая, д. 1" });
  const second = normalizeSpaquatoriaGiftDraftPatch({ physicalAddress: "Г Москва ул Тестовая д 1" });
  assert.equal(first.normalizedPhysicalAddress, second.normalizedPhysicalAddress);
  assert.equal(first.physicalAddress, "г. Москва, ул. Тестовая, д. 1");
});

test("representative declaration is stored as ordinary draft data and completeness is derived", () => {
  const fields = mergeSpaquatoriaGiftDraft(empty, normalizeSpaquatoriaGiftDraftPatch({
    representativeName: "Иван Иванов", representativeRole: "Директор", representativeEmail: " DIRECTOR@example.invalid ",
    authorityStatement: "Подтверждаю полномочия для заполнения анкеты.",
  }));
  assert.equal(fields.representativeEmail, "director@example.invalid");
  assert.equal(fields.authorityStatement, "Подтверждаю полномочия для заполнения анкеты.");
  assert.deepEqual(missingSpaquatoriaGiftDraftFields(fields), ["legalForm", "legalName", "taxId", "registrationNumber", "physicalAddress"]);
});

test("draft patch rejects malformed email, identifiers and unknown acceptance fields", () => {
  for (const patch of [
    { taxId: "77A" }, { representativeEmail: "not-an-email" }, { acceptance: true }, { documentVersionId: "a" },
  ]) assert.throws(() => normalizeSpaquatoriaGiftDraftPatch(patch), SpaquatoriaGiftDraftValidationError);
});

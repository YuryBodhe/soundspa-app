import { normalizePhysicalLocationKey, type RussianLegalForm } from "./legalFoundation";

export type SpaquatoriaGiftDraftFields = {
  legalForm: RussianLegalForm | null;
  legalName: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  registeredAddress: string | null;
  physicalAddress: string | null;
  normalizedPhysicalAddress: string | null;
  representativeName: string | null;
  representativeRole: string | null;
  representativeEmail: string | null;
  representativePhone: string | null;
  authorityStatement: string | null;
};

export type SpaquatoriaGiftDraftPatch = Partial<SpaquatoriaGiftDraftFields>;
export const SPAQUATORIA_GIFT_DRAFT_FIELD_NAMES = [
  "legalForm", "legalName", "taxId", "registrationNumber", "registeredAddress", "physicalAddress",
  "representativeName", "representativeRole", "representativeEmail", "representativePhone", "authorityStatement",
] as const;

export class SpaquatoriaGiftDraftValidationError extends Error {
  constructor() {
    super("invalid_draft");
    this.name = "SpaquatoriaGiftDraftValidationError";
  }
}

function nullableText(value: unknown, max: number, normalize = true): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new SpaquatoriaGiftDraftValidationError();
  const clean = (normalize ? value.normalize("NFKC") : value).trim();
  if (!clean) return null;
  if (clean.length > max) throw new SpaquatoriaGiftDraftValidationError();
  return clean;
}

/**
 * Draft validation permits incomplete fields. Exact tax/registration-number
 * lengths and legal authority are checked only by a future finalization flow.
 */
export function normalizeSpaquatoriaGiftDraftPatch(input: unknown): SpaquatoriaGiftDraftPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SpaquatoriaGiftDraftValidationError();
  const source = input as Record<string, unknown>;
  const allowed = new Set<string>(SPAQUATORIA_GIFT_DRAFT_FIELD_NAMES);
  if (Object.keys(source).some((key) => !allowed.has(key))) throw new SpaquatoriaGiftDraftValidationError();
  const patch: SpaquatoriaGiftDraftPatch = {};

  if (Object.hasOwn(source, "legalForm")) {
    const value = source.legalForm;
    if (value !== null && value !== "ru_legal_entity" && value !== "ru_individual_entrepreneur") throw new SpaquatoriaGiftDraftValidationError();
    patch.legalForm = value;
  }
  for (const [key, max] of [
    ["legalName", 300], ["registeredAddress", 1000], ["physicalAddress", 1000],
    ["representativeName", 300], ["representativeRole", 200], ["representativePhone", 64], ["authorityStatement", 1000],
  ] as const) {
    if (Object.hasOwn(source, key)) patch[key] = nullableText(source[key], max);
  }
  for (const [key, max] of [["taxId", 12], ["registrationNumber", 15]] as const) {
    if (!Object.hasOwn(source, key)) continue;
    const value = nullableText(source[key], max, false)?.replace(/\s+/g, "") ?? null;
    if (value && !/^\d+$/.test(value)) throw new SpaquatoriaGiftDraftValidationError();
    patch[key] = value;
  }
  if (Object.hasOwn(source, "representativeEmail")) {
    const value = nullableText(source.representativeEmail, 254)?.toLowerCase() ?? null;
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new SpaquatoriaGiftDraftValidationError();
    patch.representativeEmail = value;
  }
  if (Object.hasOwn(source, "physicalAddress")) {
    const address = patch.physicalAddress ?? null;
    patch.normalizedPhysicalAddress = address ? normalizePhysicalLocationKey(address) : null;
  }
  return patch;
}

export function mergeSpaquatoriaGiftDraft(current: SpaquatoriaGiftDraftFields, patch: SpaquatoriaGiftDraftPatch): SpaquatoriaGiftDraftFields {
  return { ...current, ...patch };
}

export function missingSpaquatoriaGiftDraftFields(fields: SpaquatoriaGiftDraftFields): string[] {
  const missing: string[] = [];
  if (!fields.legalForm) missing.push("legalForm");
  if (!fields.legalName) missing.push("legalName");
  const taxLength = fields.legalForm === "ru_legal_entity" ? 10 : fields.legalForm === "ru_individual_entrepreneur" ? 12 : 0;
  const registrationLength = fields.legalForm === "ru_legal_entity" ? 13 : fields.legalForm === "ru_individual_entrepreneur" ? 15 : 0;
  if (!taxLength || fields.taxId?.length !== taxLength) missing.push("taxId");
  if (!registrationLength || fields.registrationNumber?.length !== registrationLength) missing.push("registrationNumber");
  for (const field of ["physicalAddress", "representativeName", "representativeRole", "authorityStatement"] as const) {
    if (!fields[field]) missing.push(field);
  }
  return missing;
}

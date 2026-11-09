import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { operatorAuthStatus } from "../../../lib/v2/adminOperator";
import { v2Db } from "../client";
import {
  commercialAgreementAcceptanceEvents,
  commercialAgreementAcceptances,
  commercialLegalDocumentVersions,
  commercialLegalDocuments,
  commercialLegalEntities,
  commercialLocationLegalProfiles,
  commercialProducts,
  commercialSpaquatoriaGiftEligibility,
  commercialSpaquatoriaGiftEligibilityEvents,
  deviceProductAssignments,
  devices,
  locations,
  organizationMembers,
  organizations,
  users,
} from "../schema";

type LegalTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireGiftOperator(authorization: unknown): string {
  if (typeof authorization !== "string" || operatorAuthStatus(authorization) !== 200) {
    throw new LegalFoundationError("operator_unavailable");
  }
  const operator = process.env.V2_ADMIN_USERNAME?.trim();
  if (!operator || operator.length > 160) throw new LegalFoundationError("operator_unavailable");
  return operator;
}

export type RussianLegalForm = "ru_legal_entity" | "ru_individual_entrepreneur";
export class LegalFoundationError extends Error {
  constructor(readonly code: "invalid_profile" | "unauthorized" | "location_unavailable" | "document_unavailable" | "gift_not_eligible" | "gift_issuance_conflict" | "operator_unavailable") {
    super(code);
    this.name = "LegalFoundationError";
  }
}

export type NormalizedRussianLegalProfile = {
  legalForm: RussianLegalForm;
  legalName: string;
  taxId: string;
  registrationNumber: string;
  registeredAddress: string | null;
};

/** Hash over the exact UTF-8 document bytes; publishing remains disabled in this phase. */
export function sha256LegalDocumentContent(content: string): string {
  if (typeof content !== "string" || !content.trim()) throw new LegalFoundationError("document_unavailable");
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Validates storage shape only; it does not assert that the person is legally authorized to sign. */
export function normalizeRussianLegalProfile(input: {
  legalForm: unknown;
  legalName: unknown;
  taxId: unknown;
  registrationNumber: unknown;
  registeredAddress?: unknown;
}): NormalizedRussianLegalProfile {
  const legalForm = input.legalForm;
  const legalName = typeof input.legalName === "string" ? input.legalName.normalize("NFKC").trim() : "";
  const taxId = typeof input.taxId === "string" ? input.taxId.replace(/\s+/g, "") : "";
  const registrationNumber = typeof input.registrationNumber === "string" ? input.registrationNumber.replace(/\s+/g, "") : "";
  const registeredAddress = typeof input.registeredAddress === "string" ? input.registeredAddress.normalize("NFKC").trim() || null : null;
  if ((legalForm !== "ru_legal_entity" && legalForm !== "ru_individual_entrepreneur") || !legalName || legalName.length > 300 ||
      (registeredAddress !== null && registeredAddress.length > 1000)) throw new LegalFoundationError("invalid_profile");
  const expectedTaxDigits = legalForm === "ru_legal_entity" ? 10 : 12;
  const expectedRegistrationDigits = legalForm === "ru_legal_entity" ? 13 : 15;
  if (!new RegExp(`^[0-9]{${expectedTaxDigits}}$`).test(taxId) || !new RegExp(`^[0-9]{${expectedRegistrationDigits}}$`).test(registrationNumber)) {
    throw new LegalFoundationError("invalid_profile");
  }
  return { legalForm, legalName, taxId, registrationNumber, registeredAddress };
}

/** Conservative duplicate key: case/Unicode/spacing/punctuation variants collapse; no external address registry is assumed. */
export function normalizePhysicalLocationKey(address: unknown): string {
  if (typeof address !== "string") throw new LegalFoundationError("invalid_profile");
  const normalized = address.normalize("NFKC").replace(/№/g, " ").toLocaleLowerCase("ru-RU").replace(/\bno\s*(?=\d)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 1200) throw new LegalFoundationError("invalid_profile");
  return normalized;
}

/** Authenticated account scope for a future agreement flow; membership is not proof of legal signing authority. */
export async function requireVerifiedLocationMember(tx: LegalTx, input: { userId: string; locationId: string }) {
  if (!UUID.test(input.userId) || !UUID.test(input.locationId)) throw new LegalFoundationError("unauthorized");
  const [scope] = await tx.select({
    organizationId: organizations.id,
    locationId: locations.id,
    role: organizationMembers.role,
    legalEntityId: commercialLegalEntities.id,
    legalProfileId: commercialLocationLegalProfiles.id,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .innerJoin(locations, and(eq(locations.organizationId, organizations.id), eq(locations.id, input.locationId)))
    .leftJoin(commercialLegalEntities, eq(commercialLegalEntities.organizationId, organizations.id))
    .leftJoin(commercialLocationLegalProfiles, and(
      eq(commercialLocationLegalProfiles.locationId, locations.id),
      eq(commercialLocationLegalProfiles.organizationId, organizations.id),
    ))
    .where(and(
      eq(organizationMembers.userId, input.userId),
      isNull(users.disabledAt),
      // Sign-in is verified, while actual corporate authority remains a separate attestation/review.
      isNotNull(users.emailVerifiedAt),
      isNull(organizations.archivedAt),
      isNull(locations.archivedAt),
    )).limit(1);
  if (!scope) throw new LegalFoundationError("unauthorized");
  return scope;
}

/** Only published, non-withdrawn versions may be accepted by a future endpoint. */
export async function getAcceptableLegalDocumentVersion(tx: LegalTx, documentVersionId: string) {
  if (!UUID.test(documentVersionId)) throw new LegalFoundationError("document_unavailable");
  const [version] = await tx.select().from(commercialLegalDocumentVersions)
    .where(and(eq(commercialLegalDocumentVersions.id, documentVersionId), eq(commercialLegalDocumentVersions.status, "published"), isNull(commercialLegalDocumentVersions.withdrawnAt)))
    .limit(1).for("share");
  if (!version) throw new LegalFoundationError("document_unavailable");
  return { id: version.id, documentId: version.documentId, version: version.version, contentSha256: version.contentSha256, publishedAt: version.publishedAt };
}

/** Read-only issue preflight; no Partner Benefit, entitlement or Device assignment is written here. */
export async function getSpaquatoriaGiftIssuanceContext(tx: LegalTx, input: { operatorAuthorization: unknown; locationId: string; deviceId: string }) {
  const configuredOperator = requireGiftOperator(input.operatorAuthorization);
  if (!UUID.test(input.locationId) || !UUID.test(input.deviceId)) throw new LegalFoundationError("gift_not_eligible");

  const [scope] = await tx.select({ organizationId: organizations.id, locationId: locations.id })
    .from(locations).innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(and(eq(locations.id, input.locationId), isNull(locations.archivedAt), isNull(organizations.archivedAt)))
    .limit(1).for("update", { of: [organizations, locations] });
  if (!scope) throw new LegalFoundationError("location_unavailable");

  const [eligibility] = await tx.select({
    eligibilityId: commercialSpaquatoriaGiftEligibility.id,
    legalEntityId: commercialSpaquatoriaGiftEligibility.legalEntityId,
    acceptanceId: commercialSpaquatoriaGiftEligibility.acceptanceId,
    documentVersionId: commercialAgreementAcceptances.documentVersionId,
    documentSha256: commercialAgreementAcceptances.documentSha256,
  }).from(commercialSpaquatoriaGiftEligibility)
    .innerJoin(commercialAgreementAcceptances, and(
      eq(commercialAgreementAcceptances.id, commercialSpaquatoriaGiftEligibility.acceptanceId),
      eq(commercialAgreementAcceptances.organizationId, commercialSpaquatoriaGiftEligibility.organizationId),
      eq(commercialAgreementAcceptances.locationId, commercialSpaquatoriaGiftEligibility.locationId),
      eq(commercialAgreementAcceptances.legalEntityId, commercialSpaquatoriaGiftEligibility.legalEntityId),
    ))
    .innerJoin(commercialLegalDocumentVersions, and(
      eq(commercialLegalDocumentVersions.id, commercialAgreementAcceptances.documentVersionId),
      eq(commercialLegalDocumentVersions.status, "published"),
      isNull(commercialLegalDocumentVersions.withdrawnAt),
      eq(commercialLegalDocumentVersions.contentSha256, commercialAgreementAcceptances.documentSha256),
    ))
    .innerJoin(commercialLegalDocuments, and(
      eq(commercialLegalDocuments.id, commercialLegalDocumentVersions.documentId),
      eq(commercialLegalDocuments.code, "spaquatoria-public-performance-license"),
      eq(commercialLegalDocuments.jurisdiction, "RU"),
    ))
    .where(and(
      eq(commercialSpaquatoriaGiftEligibility.locationId, input.locationId),
      eq(commercialSpaquatoriaGiftEligibility.status, "eligible"),
    )).limit(1).for("update");
  if (!eligibility) throw new LegalFoundationError("gift_not_eligible");
  if (await hasAgreementRevocation(tx, eligibility.acceptanceId)) throw new LegalFoundationError("gift_not_eligible");

  const [device] = await tx.select({ id: devices.id }).from(devices)
    .where(and(eq(devices.id, input.deviceId), eq(devices.locationId, input.locationId), eq(devices.status, "active"), isNull(devices.revokedAt), isNotNull(devices.credentialHash)))
    .limit(1).for("update");
  if (!device) throw new LegalFoundationError("gift_issuance_conflict");

  const [product] = await tx.select({ id: commercialProducts.id }).from(commercialProducts)
    .where(and(eq(commercialProducts.code, "spaquatoria"), eq(commercialProducts.isActive, true))).limit(1).for("share");
  if (!product) throw new LegalFoundationError("gift_issuance_conflict");

  const activeAssignments = await tx.select({ deviceId: devices.id }).from(deviceProductAssignments)
    .innerJoin(devices, eq(devices.id, deviceProductAssignments.deviceId))
    .where(and(eq(devices.locationId, input.locationId), eq(devices.status, "active"), isNull(devices.revokedAt), eq(deviceProductAssignments.productId, product.id), isNull(deviceProductAssignments.revokedAt)));
  if (activeAssignments.some(({ deviceId }) => deviceId !== input.deviceId)) throw new LegalFoundationError("gift_issuance_conflict");

  return { ...scope, ...eligibility, deviceId: device.id, productId: product.id, operatorId: configuredOperator };
}

/** Append-only record lookup helper for future revocation checks. */
export async function hasAgreementRevocation(tx: LegalTx, acceptanceId: string) {
  if (!UUID.test(acceptanceId)) return false;
  const [event] = await tx.select({ id: commercialAgreementAcceptanceEvents.id })
    .from(commercialAgreementAcceptanceEvents).where(eq(commercialAgreementAcceptanceEvents.acceptanceId, acceptanceId)).limit(1);
  return Boolean(event);
}

/** Read-only audit history accessor; consumers should not derive playback access from this foundation. */
export async function listSpaquatoriaGiftEligibilityEvents(tx: LegalTx, eligibilityId: string) {
  if (!UUID.test(eligibilityId)) throw new LegalFoundationError("gift_not_eligible");
  return tx.select().from(commercialSpaquatoriaGiftEligibilityEvents)
    .where(eq(commercialSpaquatoriaGiftEligibilityEvents.eligibilityId, eligibilityId));
}

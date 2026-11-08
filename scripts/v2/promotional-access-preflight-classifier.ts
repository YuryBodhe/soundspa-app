export type LegacyTrialEvidence = {
  registrationLinkGrantLinked: boolean;
  registrationLinkGrantsAtLocation: number;
  canonicalTrialLinkConfirmed: boolean;
  canonicalOriginHint: string | null;
  exactPartnerInviteMatches: number;
  partnerInviteClaimsAtLocation: number;
};

export type LegacyTrialClassification = {
  canonical_trial_link_confirmed: boolean;
  creation_source_confirmed: "registration_link" | "partner_invite" | null;
  creation_source_inferred: string | null;
  classification: string;
  blocksPromotionalBackfill: boolean;
};

/** Classifies provenance evidence without treating an inferred legacy origin as proof. */
export function classifyLegacyTrial(evidence: LegacyTrialEvidence): LegacyTrialClassification {
  const registrationLinkEvidenceIsAmbiguous = evidence.registrationLinkGrantsAtLocation > (evidence.registrationLinkGrantLinked ? 1 : 0);
  const partnerInviteEvidenceIsAmbiguous = evidence.partnerInviteClaimsAtLocation > 0 && (
    evidence.exactPartnerInviteMatches !== 1 || evidence.registrationLinkGrantLinked
  );
  const creationSourceConfirmed = partnerInviteEvidenceIsAmbiguous || registrationLinkEvidenceIsAmbiguous
    ? null
    : evidence.registrationLinkGrantLinked
      ? "registration_link"
      : evidence.exactPartnerInviteMatches === 1
        ? "partner_invite"
        : null;
  if (partnerInviteEvidenceIsAmbiguous || registrationLinkEvidenceIsAmbiguous || evidence.exactPartnerInviteMatches > 1) {
    return {
      canonical_trial_link_confirmed: evidence.canonicalTrialLinkConfirmed,
      creation_source_confirmed: null,
      creation_source_inferred: evidence.canonicalOriginHint,
      classification: registrationLinkEvidenceIsAmbiguous && !partnerInviteEvidenceIsAmbiguous
        ? "registration_link_candidate_review"
        : "partner_invite_candidate_review",
      blocksPromotionalBackfill: true,
    };
  }

  if (evidence.registrationLinkGrantLinked) {
    return {
      canonical_trial_link_confirmed: evidence.canonicalTrialLinkConfirmed,
      creation_source_confirmed: creationSourceConfirmed,
      creation_source_inferred: null,
      classification: "registration_link_provenance",
      blocksPromotionalBackfill: false,
    };
  }

  if (evidence.exactPartnerInviteMatches === 1) {
    return {
      canonical_trial_link_confirmed: evidence.canonicalTrialLinkConfirmed,
      creation_source_confirmed: creationSourceConfirmed,
      creation_source_inferred: null,
      classification: "partner_invite_exact_candidate",
      blocksPromotionalBackfill: false,
    };
  }

  if (evidence.canonicalOriginHint === "partner_invite_possible") {
    return {
      canonical_trial_link_confirmed: evidence.canonicalTrialLinkConfirmed,
      creation_source_confirmed: null,
      creation_source_inferred: evidence.canonicalOriginHint,
      classification: "partner_invite_candidate_review",
      blocksPromotionalBackfill: true,
    };
  }

  if (evidence.canonicalTrialLinkConfirmed) {
    return {
      canonical_trial_link_confirmed: true,
      creation_source_confirmed: null,
      creation_source_inferred: evidence.canonicalOriginHint,
      classification: "canonical_legacy_historical_record",
      blocksPromotionalBackfill: false,
    };
  }

  return {
    canonical_trial_link_confirmed: false,
    creation_source_confirmed: null,
    creation_source_inferred: evidence.canonicalOriginHint,
    classification: "no_exact_partner_candidate_review",
    blocksPromotionalBackfill: true,
  };
}

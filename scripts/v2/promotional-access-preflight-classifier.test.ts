import assert from "node:assert/strict";
import test from "node:test";
import { classifyLegacyTrial } from "./promotional-access-preflight-classifier";

test("canonical-linked historical legacy trial is not mistaken for a promotional backfill", () => {
  const result = classifyLegacyTrial({
    registrationLinkGrantLinked: false,
    registrationLinkGrantsAtLocation: 0,
    canonicalTrialLinkConfirmed: true,
    canonicalOriginHint: "onboarding_inferred",
    exactPartnerInviteMatches: 0,
    partnerInviteClaimsAtLocation: 0,
  });

  assert.deepEqual(result, {
    canonical_trial_link_confirmed: true,
    creation_source_confirmed: null,
    creation_source_inferred: "onboarding_inferred",
    classification: "canonical_legacy_historical_record",
    blocksPromotionalBackfill: false,
  });
});

test("ambiguous Partner Invite claim remains a blocking review case", () => {
  const result = classifyLegacyTrial({
    registrationLinkGrantLinked: false,
    registrationLinkGrantsAtLocation: 0,
    canonicalTrialLinkConfirmed: false,
    canonicalOriginHint: "partner_invite_possible",
    exactPartnerInviteMatches: 0,
    partnerInviteClaimsAtLocation: 1,
  });

  assert.deepEqual(result, {
    canonical_trial_link_confirmed: false,
    creation_source_confirmed: null,
    creation_source_inferred: "partner_invite_possible",
    classification: "partner_invite_candidate_review",
    blocksPromotionalBackfill: true,
  });
});

test("canonical link does not erase an inferred Partner Invite ambiguity", () => {
  const result = classifyLegacyTrial({
    registrationLinkGrantLinked: false,
    registrationLinkGrantsAtLocation: 0,
    canonicalTrialLinkConfirmed: true,
    canonicalOriginHint: "partner_invite_possible",
    exactPartnerInviteMatches: 0,
    partnerInviteClaimsAtLocation: 0,
  });

  assert.equal(result.canonical_trial_link_confirmed, true);
  assert.equal(result.creation_source_confirmed, null);
  assert.equal(result.creation_source_inferred, "partner_invite_possible");
  assert.equal(result.classification, "partner_invite_candidate_review");
  assert.equal(result.blocksPromotionalBackfill, true);
});

test("unlinked Basic history still blocks when no source can be established", () => {
  const result = classifyLegacyTrial({
    registrationLinkGrantLinked: false,
    registrationLinkGrantsAtLocation: 0,
    canonicalTrialLinkConfirmed: false,
    canonicalOriginHint: "unknown",
    exactPartnerInviteMatches: 0,
    partnerInviteClaimsAtLocation: 0,
  });

  assert.equal(result.classification, "no_exact_partner_candidate_review");
  assert.equal(result.blocksPromotionalBackfill, true);
});

test("unlinked Registration Link grant at the same Location remains a blocking candidate", () => {
  const result = classifyLegacyTrial({
    registrationLinkGrantLinked: false,
    registrationLinkGrantsAtLocation: 1,
    canonicalTrialLinkConfirmed: true,
    canonicalOriginHint: "onboarding_inferred",
    exactPartnerInviteMatches: 0,
    partnerInviteClaimsAtLocation: 0,
  });

  assert.equal(result.creation_source_confirmed, null);
  assert.equal(result.creation_source_inferred, "onboarding_inferred");
  assert.equal(result.classification, "registration_link_candidate_review");
  assert.equal(result.blocksPromotionalBackfill, true);
});

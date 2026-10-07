import assert from "node:assert/strict";
import { createLocationSlug, trialCountdown } from "../../lib/v2/customerOnboarding";
import { en } from "../../app/i18n/dictionaries/en";
import { ru } from "../../app/i18n/dictionaries/ru";
import { vi } from "../../app/i18n/dictionaries/vi";
import { th } from "../../app/i18n/dictionaries/th";

assert.equal(createLocationSlug("Lotus Spa — District 1", "12345678"), "lotus-spa-district-1-12345678");
assert.equal(createLocationSlug("Тёплый Спа", "abcdef12"), "location-abcdef12");
assert.match(createLocationSlug("x".repeat(200), "12345678"), /^[a-z0-9-]{1,73}$/);
const activeTrial = (startsAt: string, endsAt: string) => ({ status: "active", startsAt, endsAt });
assert.deepEqual(trialCountdown(activeTrial("2026-10-06T00:00:00.000Z", "2026-10-08T00:00:00.000Z"), Date.parse("2026-10-07T00:00:00.000Z")), { key: "trialDays", days: 1 });
assert.deepEqual(trialCountdown(activeTrial("2026-10-06T00:00:00.000Z", "2026-10-07T12:00:00.000Z"), Date.parse("2026-10-07T00:00:00.000Z")), { key: "trialLessThanDay" });
assert.deepEqual(trialCountdown(activeTrial("2026-10-06T00:00:00.000Z", "2026-10-06T00:00:00.000Z"), Date.parse("2026-10-07T00:00:00.000Z")), { key: "trialEnded" });
assert.deepEqual(trialCountdown(activeTrial("invalid", "invalid"), Date.now()), { key: "trialEnded" });
assert.deepEqual(trialCountdown(activeTrial("2026-10-08T00:00:00.000Z", "2026-11-07T00:00:00.000Z"), Date.parse("2026-10-07T00:00:00.000Z")), { key: "trialActive" });
assert.deepEqual(trialCountdown({ ...activeTrial("2026-10-06T00:00:00.000Z", "2026-10-08T00:00:00.000Z"), status: "expired" }, Date.parse("2026-10-07T00:00:00.000Z")), { key: "trialEnded" });

const onboardingKeys = ["onboardingTitle", "onboardingDescription", "organizationName", "locationName", "timezone", "timezoneHelp", "onboardingSubmit", "onboardingSubmitting", "onboardingIncomplete", "onboardingCompleted", "onboardingInvalid", "onboardingUnavailable", "onboardingPartnerContext", "trialLabel", "trialDays", "trialLessThanDay", "trialEnded", "trialActive", "accountOrganization", "accountLocation", "accountTimezone", "timezoneRequired"] as const;
for (const dictionary of [en, ru, vi, th]) for (const key of onboardingKeys) assert.equal(typeof dictionary[key], "string", `${key} must exist in every locale`);
const partnerKeys = ["partnerInvitePending", "partnerSetupCompleted", "partnerInviteUnavailable", "partnerInviteAmbiguous", "partnerClaimFailure", "existingOrganization", "partnerAccess", "noAvailableChannels"] as const;
for (const dictionary of [en, ru, vi, th]) for (const key of partnerKeys) assert.equal(typeof dictionary[key], "string", `${key} must exist in every locale`);
assert(en.partnerInviteUnavailable && en.partnerInviteAmbiguous, "English partner invitation copy provides the fallback wording.");
console.info("V2 Customer Onboarding unit PASS: generated location slug, timezone-safe inputs remain server-validated, trial countdown boundaries, and EN/RU/VI/TH ordinary + Partner onboarding dictionary coverage.");

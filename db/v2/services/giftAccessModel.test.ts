import assert from "node:assert/strict";
import test from "node:test";
import {
  addGiftCalendarMonths,
  canRedeemGiftAccess,
  generateGiftAccessCode,
  giftCalendarAnchorForDate,
  giftDurationMonths,
  isGiftAccessCode,
  planFiniteGiftPeriod,
  rescheduleGiftPeriodsAfterRevocation,
  resolveActiveGiftAccess,
  validateGiftAccessCode,
  validateGiftAccessDuration,
  type GiftGrantPeriod,
} from "./giftAccessModel";

const date = (value: string) => new Date(value);
const period = (input: Partial<GiftGrantPeriod> & Pick<GiftGrantPeriod, "id" | "duration" | "redeemedAt" | "startsAt" | "endsAt">): GiftGrantPeriod => ({
  durationMonths: input.duration === "indefinite" ? null : 3,
  anchorDay: input.duration === "indefinite" ? null : 1,
  anchorIsEndOfMonth: input.duration === "indefinite" ? null : false,
  revokedAt: null,
  ...input,
});

test("generates distinct non-guessable invitation code shapes and validates the input format", () => {
  const generated = Array.from({ length: 500 }, generateGiftAccessCode);
  assert.equal(new Set(generated).size, generated.length);
  assert.ok(generated.every((code) => isGiftAccessCode(code) && validateGiftAccessCode(code) === code));
  assert.equal(isGiftAccessCode("short-code"), false);
  assert.throws(() => validateGiftAccessCode("short-code"), { code: "INVALID_INPUT" });
});

test("accepts only the specified finite and indefinite durations", () => {
  assert.deepEqual(["3_months", "6_months", "12_months", "indefinite"].map(validateGiftAccessDuration), ["3_months", "6_months", "12_months", "indefinite"]);
  assert.deepEqual([giftDurationMonths("3_months"), giftDurationMonths("6_months"), giftDurationMonths("12_months"), giftDurationMonths("indefinite")], [3, 6, 12, null]);
  assert.throws(() => validateGiftAccessDuration("30_days"), { code: "INVALID_INPUT" });
});

test("only verified, enabled Organization Owners and Admins may redeem gifts", () => {
  const verified = { emailVerifiedAt: date("2026-10-01T00:00:00Z"), disabledAt: null, organizationArchivedAt: null };
  assert.equal(canRedeemGiftAccess({ ...verified, role: "owner" }), true);
  assert.equal(canRedeemGiftAccess({ ...verified, role: "admin" }), true);
  assert.equal(canRedeemGiftAccess({ ...verified, role: "manager" }), false);
  assert.equal(canRedeemGiftAccess({ ...verified, role: "owner", emailVerifiedAt: null }), false);
  assert.equal(canRedeemGiftAccess({ ...verified, role: "admin", disabledAt: date("2026-10-01T00:00:00Z") }), false);
  assert.equal(canRedeemGiftAccess({ ...verified, role: "owner", organizationArchivedAt: date("2026-10-01T00:00:00Z") }), false);
});

test("calendar gifts preserve UTC month anchors and clamp end-of-month dates", () => {
  const jan30 = date("2026-01-30T10:15:00.000Z");
  const nonMonthEndAnchor = giftCalendarAnchorForDate(jan30);
  const apr30 = addGiftCalendarMonths(jan30, 3, nonMonthEndAnchor);
  assert.equal(apr30.toISOString(), "2026-04-30T10:15:00.000Z");
  assert.equal(addGiftCalendarMonths(apr30, 3, nonMonthEndAnchor).toISOString(), "2026-07-30T10:15:00.000Z");
  const aug31 = date("2026-08-31T10:15:00.000Z");
  assert.equal(addGiftCalendarMonths(aug31, 3, giftCalendarAnchorForDate(aug31)).toISOString(), "2026-11-30T10:15:00.000Z");
  assert.equal(addGiftCalendarMonths(aug31, 6, giftCalendarAnchorForDate(aug31)).toISOString(), "2027-02-28T10:15:00.000Z");
  assert.equal(addGiftCalendarMonths(aug31, 12, giftCalendarAnchorForDate(aug31)).toISOString(), "2027-08-31T10:15:00.000Z");
});

test("finite gift redemption extends an active finite period and renews an expired one from now", () => {
  const now = date("2026-10-09T10:00:00.000Z");
  const active = period({
    id: "active", duration: "3_months", redeemedAt: date("2026-07-31T10:00:00Z"),
    startsAt: date("2026-07-31T10:00:00Z"), endsAt: date("2026-10-31T10:00:00Z"),
    anchorDay: 31, anchorIsEndOfMonth: true,
  });
  const extended = planFiniteGiftPeriod({ id: "next", redeemedAt: now, durationMonths: 3, existingGrants: [active] });
  assert.equal(extended.startsAt.toISOString(), "2026-10-31T10:00:00.000Z");
  assert.equal(extended.endsAt?.toISOString(), "2027-01-31T10:00:00.000Z");
  const expired = { ...active, endsAt: date("2026-10-01T10:00:00Z") };
  const renewed = planFiniteGiftPeriod({ id: "renewed", redeemedAt: now, durationMonths: 6, existingGrants: [expired] });
  assert.equal(renewed.startsAt.toISOString(), now.toISOString());
  assert.equal(renewed.endsAt?.toISOString(), "2027-04-09T10:00:00.000Z");
});

test("finite gift schedules extend independently alongside an indefinite gift", () => {
  const now = date("2026-10-09T10:00:00Z");
  const indefinite = period({ id: "forever", duration: "indefinite", redeemedAt: now, startsAt: now, endsAt: null });
  const finite = period({ id: "finite", duration: "3_months", redeemedAt: date("2026-09-01T10:00:00Z"), startsAt: date("2026-09-01T10:00:00Z"), endsAt: date("2026-12-01T10:00:00Z") });
  const next = planFiniteGiftPeriod({ id: "next", redeemedAt: now, durationMonths: 3, existingGrants: [indefinite, finite] });
  assert.equal(next.startsAt.toISOString(), "2026-12-01T10:00:00.000Z");
  assert.equal(resolveActiveGiftAccess([indefinite, finite], now)?.kind, "indefinite");
  const revokedForever = { ...indefinite, revokedAt: now };
  assert.equal(resolveActiveGiftAccess([revokedForever, finite], now)?.kind, "finite");
});

test("revoking one gift moves unexpired later gifts forward and preserves each duration", () => {
  const now = date("2026-11-01T00:00:00Z");
  const remaining = [
    period({ id: "later-1", duration: "3_months", redeemedAt: date("2026-10-02T00:00:00Z"), startsAt: date("2027-01-01T00:00:00Z"), endsAt: date("2027-04-01T00:00:00Z") }),
    period({ id: "later-2", duration: "3_months", redeemedAt: date("2026-10-03T00:00:00Z"), startsAt: date("2027-04-01T00:00:00Z"), endsAt: date("2027-07-01T00:00:00Z") }),
  ];
  const planned = rescheduleGiftPeriodsAfterRevocation({ now, grants: remaining });
  assert.deepEqual(planned.map(({ id, startsAt, endsAt }) => [id, startsAt.toISOString(), endsAt?.toISOString()]), [
    ["later-1", "2026-11-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z"],
    ["later-2", "2027-02-01T00:00:00.000Z", "2027-05-01T00:00:00.000Z"],
  ]);
});

test("revoking the first gift removes consumed time and compacts later gifts without a gap", () => {
  const now = date("2026-02-01T00:00:00Z");
  const grants = [
    period({ id: "first", duration: "3_months", redeemedAt: date("2026-01-01T00:00:00Z"), startsAt: date("2026-01-01T00:00:00Z"), endsAt: date("2026-04-01T00:00:00Z"), revokedAt: now }),
    period({ id: "middle", duration: "3_months", redeemedAt: date("2026-01-02T00:00:00Z"), startsAt: date("2026-04-01T00:00:00Z"), endsAt: date("2026-07-01T00:00:00Z") }),
    period({ id: "last", duration: "3_months", redeemedAt: date("2026-01-03T00:00:00Z"), startsAt: date("2026-07-01T00:00:00Z"), endsAt: date("2026-10-01T00:00:00Z") }),
  ];
  const planned = rescheduleGiftPeriodsAfterRevocation({ now, grants });
  assert.deepEqual(planned.map(({ id, startsAt, endsAt }) => [id, startsAt.toISOString(), endsAt?.toISOString()]), [
    ["middle", "2026-02-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"],
    ["last", "2026-05-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"],
  ]);
  assert.equal(planned[0].startsAt.getTime(), now.getTime());
  assert.equal(planned[1].startsAt.getTime(), planned[0].endsAt?.getTime());
});

test("revoking a partially consumed middle gift leaves only the later gift's unused timeline", () => {
  const now = date("2026-05-01T00:00:00Z");
  const grants = [
    period({ id: "first", duration: "3_months", redeemedAt: date("2026-01-01T00:00:00Z"), startsAt: date("2026-01-01T00:00:00Z"), endsAt: date("2026-04-01T00:00:00Z") }),
    period({ id: "middle", duration: "3_months", redeemedAt: date("2026-01-02T00:00:00Z"), startsAt: date("2026-04-01T00:00:00Z"), endsAt: date("2026-07-01T00:00:00Z"), revokedAt: now }),
    period({ id: "last", duration: "3_months", redeemedAt: date("2026-01-03T00:00:00Z"), startsAt: date("2026-07-01T00:00:00Z"), endsAt: date("2026-10-01T00:00:00Z") }),
  ];
  const planned = rescheduleGiftPeriodsAfterRevocation({ now, grants });
  assert.deepEqual(planned.map(({ id, startsAt, endsAt }) => [id, startsAt.toISOString(), endsAt?.toISOString()]), [
    ["last", "2026-05-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"],
  ]);
  assert.equal(planned[0].startsAt.getTime(), now.getTime());
});

test("revoking a partially consumed last gift does not restore the already consumed gifts before it", () => {
  const now = date("2026-08-01T00:00:00Z");
  const grants = [
    period({ id: "first", duration: "3_months", redeemedAt: date("2026-01-01T00:00:00Z"), startsAt: date("2026-01-01T00:00:00Z"), endsAt: date("2026-04-01T00:00:00Z") }),
    period({ id: "middle", duration: "3_months", redeemedAt: date("2026-01-02T00:00:00Z"), startsAt: date("2026-04-01T00:00:00Z"), endsAt: date("2026-07-01T00:00:00Z") }),
    period({ id: "last", duration: "3_months", redeemedAt: date("2026-01-03T00:00:00Z"), startsAt: date("2026-07-01T00:00:00Z"), endsAt: date("2026-10-01T00:00:00Z"), revokedAt: now }),
  ];
  const planned = rescheduleGiftPeriodsAfterRevocation({ now, grants });
  assert.deepEqual(planned, []);
});

test("revoking a future last gift preserves the exact remaining time of the in-progress gift", () => {
  const now = date("2026-05-01T00:00:00Z");
  const middle = period({ id: "middle", duration: "3_months", redeemedAt: date("2026-01-02T00:00:00Z"), startsAt: date("2026-04-01T00:00:00Z"), endsAt: date("2026-07-01T00:00:00Z") });
  const revokedLast = period({ id: "last", duration: "3_months", redeemedAt: date("2026-01-03T00:00:00Z"), startsAt: date("2026-07-01T00:00:00Z"), endsAt: date("2026-10-01T00:00:00Z"), revokedAt: now });
  const planned = rescheduleGiftPeriodsAfterRevocation({ now, grants: [middle, revokedLast] });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].id, "middle");
  assert.equal(planned[0].startsAt.toISOString(), "2026-04-01T00:00:00.000Z");
  assert.equal(planned[0].endsAt?.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(planned[0].endsAt!.getTime() - now.getTime(), middle.endsAt!.getTime() - now.getTime());
});

test("gift entitlement resolution ignores revoked grants and indefinite gifts dominate finite gifts", () => {
  const now = date("2026-10-09T00:00:00Z");
  const finite = period({ id: "finite", duration: "3_months", redeemedAt: now, startsAt: date("2026-09-01T00:00:00Z"), endsAt: date("2026-12-01T00:00:00Z") });
  const indefinite = period({ id: "indefinite", duration: "indefinite", redeemedAt: now, startsAt: date("2026-10-01T00:00:00Z"), endsAt: null });
  const revoked = { ...indefinite, id: "revoked", revokedAt: now };
  assert.deepEqual(resolveActiveGiftAccess([finite, indefinite], now), { kind: "indefinite", endsAt: null, grantIds: ["indefinite"] });
  assert.deepEqual(resolveActiveGiftAccess([finite, revoked], now), { kind: "finite", endsAt: finite.endsAt, grantIds: ["finite"] });
  assert.equal(resolveActiveGiftAccess([{ ...finite, endsAt: date("2026-10-08T00:00:00Z") }], now), null);
});

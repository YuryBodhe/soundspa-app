import { randomBytes } from "node:crypto";

export type GiftAccessDuration = "3_months" | "6_months" | "12_months" | "indefinite";
export type FiniteGiftDuration = Exclude<GiftAccessDuration, "indefinite">;

export class GiftAccessValidationError extends Error {
  constructor(readonly code: "INVALID_INPUT") {
    super(code);
    this.name = "GiftAccessValidationError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateGiftAccessCode(): string {
  return randomBytes(32).toString("base64url");
}

export function isGiftAccessCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

export function isGiftAccessUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function giftDurationMonths(duration: GiftAccessDuration): number | null {
  if (duration === "3_months") return 3;
  if (duration === "6_months") return 6;
  if (duration === "12_months") return 12;
  if (duration === "indefinite") return null;
  throw new GiftAccessValidationError("INVALID_INPUT");
}

export function validateGiftAccessDuration(value: unknown): GiftAccessDuration {
  if (value === "3_months" || value === "6_months" || value === "12_months" || value === "indefinite") return value;
  throw new GiftAccessValidationError("INVALID_INPUT");
}

export function validateGiftAccessCode(value: unknown): string {
  if (!isGiftAccessCode(value)) throw new GiftAccessValidationError("INVALID_INPUT");
  return value;
}

export function canRedeemGiftAccess(input: {
  role: string;
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
  organizationArchivedAt: Date | null;
}): boolean {
  return (input.role === "owner" || input.role === "admin") && input.emailVerifiedAt !== null &&
    input.disabledAt === null && input.organizationArchivedAt === null;
}

export type GiftCalendarAnchor = { dayOfMonth: number; isEndOfMonth: boolean };

export function giftCalendarAnchorForDate(value: Date): GiftCalendarAnchor {
  assertValidDate(value);
  const dayOfMonth = value.getUTCDate();
  return {
    dayOfMonth,
    isEndOfMonth: dayOfMonth === lastDayOfUtcMonth(value.getUTCFullYear(), value.getUTCMonth()),
  };
}

/** Add UTC calendar months while preserving the original day or month-end anchor. */
export function addGiftCalendarMonths(startsAt: Date, durationMonths: number, anchor: GiftCalendarAnchor): Date {
  assertValidDate(startsAt);
  if (![3, 6, 12].includes(durationMonths) || !Number.isInteger(durationMonths) ||
      !Number.isInteger(anchor.dayOfMonth) || anchor.dayOfMonth < 1 || anchor.dayOfMonth > 31 ||
      typeof anchor.isEndOfMonth !== "boolean") {
    throw new RangeError("invalid_gift_period");
  }
  const absoluteTargetMonth = startsAt.getUTCFullYear() * 12 + startsAt.getUTCMonth() + durationMonths;
  const targetYear = Math.floor(absoluteTargetMonth / 12);
  const targetMonth = absoluteTargetMonth % 12;
  const targetDay = anchor.isEndOfMonth
    ? lastDayOfUtcMonth(targetYear, targetMonth)
    : Math.min(anchor.dayOfMonth, lastDayOfUtcMonth(targetYear, targetMonth));
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    startsAt.getUTCHours(),
    startsAt.getUTCMinutes(),
    startsAt.getUTCSeconds(),
    startsAt.getUTCMilliseconds(),
  ));
}

export type GiftGrantPeriod = {
  id: string;
  duration: GiftAccessDuration;
  durationMonths: number | null;
  redeemedAt: Date;
  startsAt: Date;
  endsAt: Date | null;
  anchorDay: number | null;
  anchorIsEndOfMonth: boolean | null;
  revokedAt: Date | null;
};

export type PlannedGiftPeriod = Pick<GiftGrantPeriod, "id" | "startsAt" | "endsAt" | "anchorDay" | "anchorIsEndOfMonth">;

/** Plan a finite gift after the live finite gift chain, even while indefinite access also exists. */
export function planFiniteGiftPeriod(input: {
  id: string;
  redeemedAt: Date;
  durationMonths: number;
  existingGrants: GiftGrantPeriod[];
}): PlannedGiftPeriod {
  assertValidDate(input.redeemedAt);
  const liveFinite = input.existingGrants
    .filter((grant) => grant.revokedAt === null && grant.duration !== "indefinite" && grant.endsAt !== null && grant.endsAt > input.redeemedAt)
    .sort((a, b) => b.endsAt!.getTime() - a.endsAt!.getTime())[0];
  const startsAt = liveFinite ? new Date(liveFinite.endsAt!) : new Date(input.redeemedAt);
  const anchor = liveFinite
    ? { dayOfMonth: liveFinite.anchorDay!, isEndOfMonth: liveFinite.anchorIsEndOfMonth! }
    : giftCalendarAnchorForDate(startsAt);
  return {
    id: input.id,
    startsAt,
    endsAt: addGiftCalendarMonths(startsAt, input.durationMonths, anchor),
    anchorDay: anchor.dayOfMonth,
    anchorIsEndOfMonth: anchor.isEndOfMonth,
  };
}

/**
 * Remove consumed periods, preserve the unconsumed part of an active period,
 * then compact future gifts from now in their prior schedule order. This
 * never regrants elapsed time: an active grant keeps its original end instant.
 */
export function rescheduleGiftPeriodsAfterRevocation(input: {
  now: Date;
  grants: GiftGrantPeriod[];
}): PlannedGiftPeriod[] {
  assertValidDate(input.now);
  const candidates = input.grants
    .filter((grant) => grant.revokedAt === null && grant.duration !== "indefinite" && grant.endsAt !== null && grant.endsAt > input.now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.redeemedAt.getTime() - b.redeemedAt.getTime() || a.id.localeCompare(b.id));
  if (!candidates.length) return [];

  const activeIndex = candidates.findIndex((grant) => grant.startsAt <= input.now && grant.endsAt! > input.now);
  let cursor = new Date(input.now);
  let anchor = giftCalendarAnchorForDate(cursor);
  const output: PlannedGiftPeriod[] = [];
  if (activeIndex >= 0) {
    const active = candidates[activeIndex];
    cursor = new Date(active.endsAt!);
    anchor = { dayOfMonth: active.anchorDay!, isEndOfMonth: active.anchorIsEndOfMonth! };
    output.push({
      id: active.id,
      startsAt: new Date(active.startsAt),
      endsAt: new Date(active.endsAt!),
      anchorDay: active.anchorDay,
      anchorIsEndOfMonth: active.anchorIsEndOfMonth,
    });
  }

  for (let index = 0; index < candidates.length; index += 1) {
    if (index === activeIndex) continue;
    const grant = candidates[index];
    if (grant.startsAt <= input.now) {
      throw new RangeError("overlapping_gift_periods");
    }
    const months = grant.durationMonths;
    if (months !== 3 && months !== 6 && months !== 12) throw new RangeError("invalid_gift_period");
    const startsAt = cursor;
    const endsAt = addGiftCalendarMonths(startsAt, months, anchor);
    output.push({ id: grant.id, startsAt: new Date(startsAt), endsAt, anchorDay: anchor.dayOfMonth, anchorIsEndOfMonth: anchor.isEndOfMonth });
    cursor = endsAt;
  }
  return output;
}

export function resolveActiveGiftAccess(grants: GiftGrantPeriod[], now: Date) {
  assertValidDate(now);
  const active = grants.filter((grant) => grant.revokedAt === null && grant.startsAt <= now &&
    (grant.endsAt === null || grant.endsAt > now));
  const indefinite = active.filter((grant) => grant.duration === "indefinite");
  if (indefinite.length) return { kind: "indefinite" as const, endsAt: null as Date | null, grantIds: indefinite.map((grant) => grant.id) };
  const finite = active.filter((grant): grant is GiftGrantPeriod & { endsAt: Date } => grant.endsAt !== null)
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
  const latest = finite[0];
  return latest
    ? { kind: "finite" as const, endsAt: latest.endsAt, grantIds: finite.filter((grant) => grant.endsAt.getTime() === latest.endsAt.getTime()).map((grant) => grant.id) }
    : null;
}

function lastDayOfUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new RangeError("invalid_gift_date");
}

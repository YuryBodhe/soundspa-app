import { addBillingCalendarMonths, type BillingCalendarAnchor } from "./billingCalendar";

export const MANUAL_BANK_TRANSFER_PROVIDER_CODE = "manual-bank-transfer";

const MAX_BIGINT = BigInt("9223372036854775807");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MANUAL_BANK_TRANSFER_CURRENCIES = ["RUB"] as const;

export type ManualBankTransferLineInput = { locationId: string; productId: string };
export type AllocatedManualLine = ManualBankTransferLineInput & { amountMinor: bigint };

export class ManualBillingModelError extends Error {
  constructor(readonly code: "invalid_request" | "invalid_period" | "invalid_amount" | "duplicate_line" | "invalid_creator") {
    super(code);
    this.name = "ManualBillingModelError";
  }
}

export function validateManualBankTransferInput(input: {
  organizationId: unknown;
  operator: unknown;
  reason: unknown;
  idempotencyKey: unknown;
  periodStart: unknown;
  periodEnd: unknown;
  currency: unknown;
  totalAmountMinor: unknown;
  invoiceNumber: unknown;
  invoiceIssuedAt: unknown;
  paymentDueAt: unknown;
  lines: unknown;
}) {
  if (typeof input.organizationId !== "string" || !UUID.test(input.organizationId) ||
      !Array.isArray(input.lines) || input.lines.length < 1 ||
      typeof input.currency !== "string" || !(MANUAL_BANK_TRANSFER_CURRENCIES as readonly string[]).includes(input.currency)) {
    throw new ManualBillingModelError("invalid_request");
  }
  const operator = typeof input.operator === "string" ? input.operator.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const invoiceNumber = typeof input.invoiceNumber === "string" ? input.invoiceNumber.trim() : "";
  const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
    ? new Date(`${value}T00:00:00.000Z`) : null;
  const invoiceIssuedAt = date(input.invoiceIssuedAt);
  const paymentDueAt = date(input.paymentDueAt);
  if (!operator || operator.length > 200 || /[\u0000-\u001f\u007f]/.test(operator) ||
      !reason || reason.length < 12 || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason) ||
      !invoiceNumber || invoiceNumber.length > 120 || /[\u0000-\u001f\u007f]/.test(invoiceNumber) || !invoiceIssuedAt || !paymentDueAt || paymentDueAt < invoiceIssuedAt ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) throw new ManualBillingModelError("invalid_creator");
  if (typeof input.totalAmountMinor !== "string" || !/^[1-9]\d{0,18}$/.test(input.totalAmountMinor)) throw new ManualBillingModelError("invalid_amount");
  const totalAmountMinor = BigInt(input.totalAmountMinor);
  if (totalAmountMinor > MAX_BIGINT || totalAmountMinor < BigInt(1)) throw new ManualBillingModelError("invalid_amount");
  const lines = input.lines.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ManualBillingModelError("invalid_request");
    const line = raw as Record<string, unknown>;
    if (typeof line.locationId !== "string" || !UUID.test(line.locationId) ||
        typeof line.productId !== "string" || !UUID.test(line.productId)) throw new ManualBillingModelError("invalid_request");
    return { locationId: line.locationId.toLowerCase(), productId: line.productId.toLowerCase() };
  });
  const identities = new Set(lines.map((line: ManualBankTransferLineInput) => `${line.locationId}:${line.productId}`));
  const locationIds = new Set(lines.map((line: ManualBankTransferLineInput) => line.locationId));
  if (identities.size !== lines.length || locationIds.size !== lines.length) throw new ManualBillingModelError("duplicate_line");
  const period = explicitDateCoverage(input.periodStart, input.periodEnd);
  return {
    organizationId: input.organizationId.toLowerCase(), operator, reason, idempotencyKey, invoiceNumber, invoiceIssuedAt, paymentDueAt,
    periodStart: period.startsAt, periodEnd: period.endsAt, currency: input.currency,
    totalAmountMinor, lines: lines as ManualBankTransferLineInput[],
  };
}

/** Equal minor-unit allocation. Any remainder is assigned by stable Location/Product order. */
export function allocateFixedOrganizationTotal(totalAmountMinor: bigint, lines: readonly ManualBankTransferLineInput[]): AllocatedManualLine[] {
  if (totalAmountMinor < BigInt(1) || totalAmountMinor > MAX_BIGINT || lines.length < 1) throw new ManualBillingModelError("invalid_amount");
  const sorted = [...lines].sort((a, b) => a.locationId.localeCompare(b.locationId) || a.productId.localeCompare(b.productId));
  const base = totalAmountMinor / BigInt(sorted.length);
  const remainder = Number(totalAmountMinor % BigInt(sorted.length));
  return sorted.map((line, index) => ({ ...line, amountMinor: base + (index < remainder ? BigInt(1) : BigInt(0)) }));
}

/** Manual coverage uses inclusive UTC start and exclusive UTC end date boundaries. */
export function explicitDateCoverage(periodStart: unknown, periodEndExclusive: unknown): {
  startsAt: Date; endsAt: Date; anchor: BillingCalendarAnchor;
} {
  const parseDate = (value: unknown) => {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) && value.getUTCHours() === 0 && value.getUTCMinutes() === 0 &&
        value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0 ? new Date(value) : null;
    }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  };
  const startsAt = parseDate(periodStart);
  const endsAt = parseDate(periodEndExclusive);
  if (!startsAt || !endsAt || endsAt <= startsAt) throw new ManualBillingModelError("invalid_period");
  const lastDay = new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + 1, 0)).getUTCDate();
  return { startsAt, endsAt, anchor: { dayOfMonth: startsAt.getUTCDate(), isEndOfMonth: startsAt.getUTCDate() === lastDay } };
}

export function explicitCalendarCoverage(periodStart: Date, durationMonths: number): {
  startsAt: Date; endsAt: Date; anchor: BillingCalendarAnchor;
} {
  if (!Number.isFinite(periodStart.getTime()) || periodStart.getUTCDate() !== 1 ||
      periodStart.getUTCHours() !== 0 || periodStart.getUTCMinutes() !== 0 || periodStart.getUTCSeconds() !== 0 || periodStart.getUTCMilliseconds() !== 0) {
    throw new ManualBillingModelError("invalid_period");
  }
  const anchor = { dayOfMonth: 1, isEndOfMonth: false };
  return { startsAt: new Date(periodStart), endsAt: addBillingCalendarMonths(periodStart, durationMonths, anchor), anchor };
}

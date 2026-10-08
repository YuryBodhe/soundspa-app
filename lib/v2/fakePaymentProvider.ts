import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const FAKE_PROVIDER_CODE = "fake-staging";
export const FAKE_PROVIDER_ORIGIN = "https://test.soundspa.bodhemusic.com";
export const FAKE_PROVIDER_MARKET = "RU";
export const FAKE_CHECKOUT_TTL_MS = 15 * 60_000;
export const FAKE_AGGREGATE_CHECKOUT_TTL_MS = 7 * 24 * 60 * 60_000;
export const FAKE_PAYMENT_AMOUNT_MINOR = BigInt(108_000);
export const FAKE_PAYMENT_CURRENCY = "RUB";

export type FakeProviderEnvironment = Record<string, string | undefined>;
export type FakeCheckoutTicket = { v: 1; paymentId: string; actorHash: string; expiresAt: number };
export type AggregateFakeCheckoutCapability = {
  v: 1;
  purpose: "aggregate_fake_checkout_pay";
  orderId: string;
  paymentId: string;
  providerCode: typeof FAKE_PROVIDER_CODE;
  expiresAt: number;
};
export const fakeCheckoutRequestSchema = z.object({ locationId: z.string().uuid(), productId: z.string().uuid(), routeId: z.string().uuid() }).strict();
export const fakeConfirmationRequestSchema = z.object({ confirmationToken: z.string().min(1).max(2048) }).strict();
export const fakeCancellationRequestSchema = z.object({ subscriptionId: z.string().uuid() }).strict();

export function fakeProviderIsConfigured(env: FakeProviderEnvironment): boolean {
  const secret = env.V2_FAKE_PROVIDER_SECRET;
  return env.V2_DEPLOYMENT_ENV === "staging" &&
    env.V2_FAKE_PROVIDER_ENABLED === "1" &&
    env.V2_PUBLIC_ORIGIN === FAKE_PROVIDER_ORIGIN &&
    typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;
}

export function fakeProviderIsEnabled(env: FakeProviderEnvironment, request: Request): boolean {
  const host = request.headers.get("host");
  const requestOrigin = request.headers.get("origin");
  return fakeProviderIsConfigured(env) &&
    host?.toLowerCase() === "test.soundspa.bodhemusic.com" &&
    requestOrigin === FAKE_PROVIDER_ORIGIN;
}

/** Read-only Account UI availability check; mutations still require same-origin validation. */
export function fakeProviderUiIsAvailable(env: FakeProviderEnvironment, request: Request): boolean {
  return fakeProviderIsConfigured(env) && request.headers.get("host")?.toLowerCase() === "test.soundspa.bodhemusic.com";
}

/** Host-only guard for a top-level staging payer page (which has no Origin header). */
export function fakeProviderPageIsEnabled(env: FakeProviderEnvironment, host: string | null): boolean {
  return fakeProviderIsConfigured(env) && host?.toLowerCase() === "test.soundspa.bodhemusic.com";
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function issueFakeCheckoutTicket(ticket: FakeCheckoutTicket, secret: string): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyFakeCheckoutTicket(value: unknown, secret: string): FakeCheckoutTicket | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const [payload, encodedSignature, extra] = value.split(".");
  if (!payload || !encodedSignature || extra !== undefined) return null;
  let supplied: Buffer;
  let ticket: unknown;
  try {
    supplied = Buffer.from(encodedSignature, "base64url");
    if (!timingSafeEqual(signature(payload, secret), supplied)) return null;
    ticket = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch { return null; }
  if (!ticket || typeof ticket !== "object") return null;
  const candidate = ticket as Record<string, unknown>;
  if (candidate.v !== 1 || typeof candidate.paymentId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(candidate.paymentId) || typeof candidate.actorHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(candidate.actorHash) || typeof candidate.expiresAt !== "number" ||
      !Number.isSafeInteger(candidate.expiresAt)) return null;
  return { v: 1, paymentId: candidate.paymentId, actorHash: candidate.actorHash, expiresAt: candidate.expiresAt };
}

/** Separate bearer capability: possession permits payment of one fake aggregate order only. */
export function issueAggregateFakeCheckoutCapability(capability: AggregateFakeCheckoutCapability, secret: string): string {
  const payload = Buffer.from(JSON.stringify(capability)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyAggregateFakeCheckoutCapability(value: unknown, secret: string): AggregateFakeCheckoutCapability | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const [payload, encodedSignature, extra] = value.split(".");
  if (!payload || !encodedSignature || extra !== undefined) return null;
  try {
    const supplied = Buffer.from(encodedSignature, "base64url");
    if (!timingSafeEqual(signature(payload, secret), supplied)) return null;
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const valueObject = parsed as Record<string, unknown>;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (valueObject.v !== 1 || valueObject.purpose !== "aggregate_fake_checkout_pay" ||
        valueObject.providerCode !== FAKE_PROVIDER_CODE || typeof valueObject.orderId !== "string" || !uuid.test(valueObject.orderId) ||
        typeof valueObject.paymentId !== "string" || !uuid.test(valueObject.paymentId) ||
        typeof valueObject.expiresAt !== "number" || !Number.isSafeInteger(valueObject.expiresAt)) return null;
    return valueObject as AggregateFakeCheckoutCapability;
  } catch { return null; }
}

export function addOneCalendarMonth(instant: Date): Date {
  const year = instant.getUTCFullYear();
  const month = instant.getUTCMonth();
  const day = instant.getUTCDate();
  const targetMonthLastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + 1, Math.min(day, targetMonthLastDay), instant.getUTCHours(), instant.getUTCMinutes(), instant.getUTCSeconds(), instant.getUTCMilliseconds()));
}

export function fakeConfirmedPaidThrough(occurredAt: Date, currentPeriodEndsAt: Date | null): Date {
  const periodStart = currentPeriodEndsAt && currentPeriodEndsAt > occurredAt ? currentPeriodEndsAt : occurredAt;
  return addOneCalendarMonth(periodStart);
}

export function fakeCancellationIdentity(subscriptionId: string, periodEnd: Date): { idempotencyKey: string; externalEventId: string } {
  const identity = `${subscriptionId}:${periodEnd.toISOString()}`;
  const digest = createHash("sha256").update(identity).digest("hex");
  return { idempotencyKey: `fake-cancel:${digest}`, externalEventId: `fake-cancel:${digest}` };
}

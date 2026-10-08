import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const FAKE_PROVIDER_CODE = "fake-staging";
export const FAKE_PROVIDER_ORIGIN = "https://test.soundspa.bodhemusic.com";
export const FAKE_PROVIDER_MARKET = "RU";
export const FAKE_CHECKOUT_TTL_MS = 15 * 60_000;
export const FAKE_PAYMENT_AMOUNT_MINOR = BigInt(108_000);
export const FAKE_PAYMENT_CURRENCY = "RUB";

export type FakeProviderEnvironment = Record<string, string | undefined>;
export type FakeCheckoutTicket = { v: 1; paymentId: string; actorHash: string; expiresAt: number };
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

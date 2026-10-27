import { NextResponse } from "next/server";
import { isSameOriginMutation } from "../../../lib/v2/adminOperator";
import { browserLocale, isLocale } from "../../../app/i18n/locales";
import type { Locale } from "../../../app/i18n/types";
import { en } from "../../../app/i18n/dictionaries/en";
import { ru } from "../../../app/i18n/dictionaries/ru";
import { vi } from "../../../app/i18n/dictionaries/vi";
import { th } from "../../../app/i18n/dictionaries/th";

export const dynamic = "force-dynamic";

const PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const dictionaries = { en, ru, vi, th } as const;

export function resolveDeviceActivationLocale(request: Request): Locale {
  const requested = new URL(request.url).searchParams.get("lang");
  if (isLocale(requested)) return requested;
  return browserLocale(request.headers.get("accept-language")?.split(",")[0]) ?? "en";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function renderDeviceActivationPage(locale: Locale, preview?: { organizationName: string; locationName: string; deviceName: string | null }, status = 200) {
  const t = dictionaries[locale];
  const content = preview
    ? `<p class="eyebrow">${t.deviceActivationEyebrow}</p><h1>${t.deviceActivationConfirmTitle}</h1><dl><dt>${t.deviceActivationOrganization}</dt><dd>${escapeHtml(preview.organizationName)}</dd><dt>${t.deviceActivationLocation}</dt><dd>${escapeHtml(preview.locationName)}</dd><dt>${t.deviceActivationDevice}</dt><dd>${escapeHtml(preview.deviceName || t.deviceActivationUnnamed)}</dd></dl><form method="post"><button type="submit">${t.deviceActivationSubmit}</button></form>`
    : `<p class="eyebrow">${t.deviceActivationEyebrow}</p><h1>${t.deviceActivationUnavailableTitle}</h1><p>${t.deviceActivationUnavailableDescription}</p>`;

  return new Response(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SoundSpa · ${t.deviceActivationEyebrow}</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#07070a;color:#c8c0b0;font:300 16px/1.5 Jost,Arial,sans-serif}.card{width:min(100%,460px);padding:32px;border:1px solid rgba(216,208,192,.14);border-radius:16px;background:#101014}header{margin-bottom:34px;color:#d8d0c0;font:300 30px/1.1 Georgia,serif;letter-spacing:.04em}.eyebrow{color:#8a9e82;font-size:11px;letter-spacing:.2em;text-transform:uppercase}h1{margin:8px 0 24px;color:#e1d7c4;font:300 28px/1.2 Georgia,serif}dl{margin:0 0 28px}dt{margin-top:16px;color:#827d74;font-size:11px;letter-spacing:.16em;text-transform:uppercase}dd{margin:3px 0 0;color:#d8d0c0;font-size:18px}button{width:100%;min-height:48px;border:1px solid rgba(138,158,130,.55);border-radius:8px;background:#26352d;color:#e7efe8;font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #a9c39f;outline-offset:3px}
  </style></head><body><main class="card"><header>SoundSpa</header>${content}</main></body></html>`, {
    status,
    headers: PAGE_HEADERS,
  });
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const locale = resolveDeviceActivationLocale(request);
  try {
    const { getDeviceActivationPreview } = await import("../../../db/v2/services/deviceProvisioning");
    const preview = await getDeviceActivationPreview(token);
    return preview ? renderDeviceActivationPage(locale, preview) : renderDeviceActivationPage(locale, undefined, 410);
  } catch {
    console.error("[V2 device activation] Confirmation lookup failed.");
    return new Response(dictionaries[locale].deviceActivationTemporaryError, { status: 503, headers: PAGE_HEADERS });
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const locale = resolveDeviceActivationLocale(request);
  if (!isSameOriginMutation(request)) {
    return new Response("Same-origin confirmation required.", { status: 403, headers: { ...PAGE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  }

  try {
    const publicUrl = new URL(process.env.V2_PUBLIC_ORIGIN?.trim() || new URL(request.url).origin);
    if (publicUrl.username || publicUrl.password || (process.env.NODE_ENV === "production" && publicUrl.protocol !== "https:")) throw new Error("unsafe public origin");
    const { activateDevice } = await import("../../../db/v2/services/deviceProvisioning");
    const credential = await activateDevice(token);
    const response = NextResponse.redirect(new URL("/player", publicUrl.origin), 303);
    response.cookies.set("soundspa_v2_device", credential, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if ((error as { name?: unknown })?.name === "DeviceProvisioningError") return renderDeviceActivationPage(locale, undefined, 410);
    console.error("[V2 device activation] Activation failed.");
    return new Response(dictionaries[locale].deviceActivationTemporaryError, {
      status: 503,
      headers: { ...PAGE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

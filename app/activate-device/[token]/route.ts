import { NextResponse } from "next/server";
import { isSameOriginMutation, sameOriginDiagnosticFields } from "../../../lib/v2/adminOperator";

export const dynamic = "force-dynamic";

const PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function activationPage(preview?: { organizationName: string; locationName: string; deviceName: string | null }, status = 200) {
  const content = preview
    ? `<p class="eyebrow">Device activation</p><h1>Activate this device?</h1><dl><dt>Organization</dt><dd>${escapeHtml(preview.organizationName)}</dd><dt>Location</dt><dd>${escapeHtml(preview.locationName)}</dd><dt>Device</dt><dd>${escapeHtml(preview.deviceName || "Unnamed Device")}</dd></dl><form method="post"><button type="submit">Activate Device</button></form>`
    : `<p class="eyebrow">Device activation</p><h1>Activation unavailable</h1><p>This link is invalid, expired, already used, or unavailable. Ask the operator for a new link.</p>`;

  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SoundSpa · Device activation</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#07070a;color:#c8c0b0;font:300 16px/1.5 Jost,Arial,sans-serif}.card{width:min(100%,460px);padding:32px;border:1px solid rgba(216,208,192,.14);border-radius:16px;background:#101014}header{margin-bottom:34px;color:#d8d0c0;font:300 30px/1.1 Georgia,serif;letter-spacing:.04em}.eyebrow{color:#8a9e82;font-size:11px;letter-spacing:.2em;text-transform:uppercase}h1{margin:8px 0 24px;color:#e1d7c4;font:300 28px/1.2 Georgia,serif}dl{margin:0 0 28px}dt{margin-top:16px;color:#827d74;font-size:11px;letter-spacing:.16em;text-transform:uppercase}dd{margin:3px 0 0;color:#d8d0c0;font-size:18px}button{width:100%;min-height:48px;border:1px solid rgba(138,158,130,.55);border-radius:8px;background:#26352d;color:#e7efe8;font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #a9c39f;outline-offset:3px}
  </style></head><body><main class="card"><header>SoundSpa</header>${content}</main></body></html>`, {
    status,
    headers: PAGE_HEADERS,
  });
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    const { getDeviceActivationPreview } = await import("../../../db/v2/services/deviceProvisioning");
    const preview = await getDeviceActivationPreview(token);
    return preview ? activationPage(preview) : activationPage(undefined, 410);
  } catch {
    console.error("[V2 device activation] Confirmation lookup failed.");
    return new Response("Device activation is temporarily unavailable.", { status: 503, headers: PAGE_HEADERS });
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!isSameOriginMutation(request, (validatorBranch) => {
    console.warn("DEVICE_ACTIVATION_ORIGIN_REJECT", sameOriginDiagnosticFields(request, validatorBranch, token));
  })) {
    return new Response("Same-origin confirmation required.", { status: 403, headers: { ...PAGE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  }

  try {
    const publicUrl = new URL(process.env.V2_PUBLIC_ORIGIN?.trim() || new URL(request.url).origin);
    if (publicUrl.username || publicUrl.password || (process.env.NODE_ENV === "production" && publicUrl.protocol !== "https:")) throw new Error("unsafe public origin");
    const { activateDevice, DeviceProvisioningError } = await import("../../../db/v2/services/deviceProvisioning");
    const credential = await activateDevice(token);
    const response = NextResponse.redirect(new URL("/player", publicUrl.origin), 303);
    response.cookies.set("soundspa_v2_device", credential, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if ((error as { name?: unknown })?.name === "DeviceProvisioningError") return activationPage(undefined, 410);
    console.error("[V2 device activation] Activation failed.");
    return new Response("Device activation is temporarily unavailable. Ask the operator to try again later.", {
      status: 503,
      headers: { ...PAGE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

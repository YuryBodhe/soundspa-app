import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function invalidActivation() {
  return new Response("This device activation link is invalid, expired, already used, or unavailable. Ask the operator to create a new Device link.", {
    status: 410,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    const publicUrl = new URL(process.env.V2_PUBLIC_ORIGIN?.trim() || new URL(_request.url).origin);
    if (publicUrl.username || publicUrl.password || (process.env.NODE_ENV === "production" && publicUrl.protocol !== "https:")) throw new Error("unsafe public origin");
    const { activateDevice, DeviceProvisioningError } = await import("../../../db/v2/services/deviceProvisioning");
    const credential = await activateDevice(token);
    const response = NextResponse.redirect(new URL("/player", publicUrl.origin), 303);
    response.cookies.set("soundspa_v2_device", credential, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if ((error as { name?: unknown })?.name === "DeviceProvisioningError") return invalidActivation();
    console.error("[V2 device activation] Activation failed.");
    return new Response("Device activation is temporarily unavailable. Ask the operator to try again later.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

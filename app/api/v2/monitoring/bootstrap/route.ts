import { readFile } from "node:fs/promises";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { operatorAuthResponse, operatorAuthStatus } from "@/lib/v2/adminOperator";

const COOKIE = "soundspa_v2_device";
const CREDENTIAL_FILE = process.env.V2_TEST_DEVICE_CREDENTIAL_FILE ?? "/var/www/soundspa-v2/.v2-test-device-credential";

export async function GET(request: Request) {
  if (process.env.V2_DEVICE_BOOTSTRAP_ENABLED !== "1") return new Response("Not found.", { status: 404 });
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);
  const { authenticateDeviceCredential } = await import("@/db/v2/queries/devices");
  let credential: string;
  try { credential = (await readFile(CREDENTIAL_FILE, "utf8")).trim(); }
  catch { return new Response("Device bootstrap is unavailable.", { status: 503 }); }
  const device = await authenticateDeviceCredential(credential);
  if (!device) return new Response("Device bootstrap is unavailable.", { status: 503 });
  const response = NextResponse.redirect(new URL("/v2", request.url));
  response.cookies.set(COOKIE, credential, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

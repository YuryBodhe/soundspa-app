import { cookies } from "next/headers";

const COOKIE = "soundspa_v2_device";
export const dynamic = "force-dynamic";
export async function GET() {
  const credential = (await cookies()).get(COOKIE)?.value;
  if (!credential) return Response.json({ error: "Device authentication required." }, { status: 401 });
  const { authenticateDeviceCredential } = await import("@/db/v2/queries/devices");
  const device = await authenticateDeviceCredential(credential);
  if (!device) return Response.json({ error: "Device authentication failed." }, { status: 401 });
  const { getLocationCustomerCatalog } = await import("@/lib/v2/customerCatalog");
  const catalog = await getLocationCustomerCatalog(device.locationId);
  return Response.json({ channels: catalog }, { headers: { "Cache-Control": "no-store" } });
}

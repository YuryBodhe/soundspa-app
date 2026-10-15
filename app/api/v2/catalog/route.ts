import { cookies } from "next/headers";
import { getCustomerCatalogForDevice } from "@/lib/v2/customerCatalogRequest";

const COOKIE = "soundspa_v2_device";
export const dynamic = "force-dynamic";
export async function GET() {
  const credential = (await cookies()).get(COOKIE)?.value;
  const { authenticateDeviceCredential } = await import("@/db/v2/queries/devices");
  const result = await getCustomerCatalogForDevice(credential, authenticateDeviceCredential, async (locationId) => {
    const { getLocationCustomerCatalog } = await import("@/lib/v2/customerCatalog");
    return getLocationCustomerCatalog(locationId);
  });
  if (result.failedDeviceId) {
    void import("@/db/v2/services/monitoringObservability")
      .then(({ recordCustomerCatalogFailure }) => recordCustomerCatalogFailure(result.failedDeviceId!))
      .catch(() => undefined);
  }
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

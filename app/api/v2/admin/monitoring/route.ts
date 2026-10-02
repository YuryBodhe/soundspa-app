import { handleAdminMonitoringGet } from "../../../../../lib/v2/adminMonitoringHttp";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAdminMonitoringGet(request, async () => {
    const { getMonitoringSnapshot } = await import("../../../../../db/v2/queries/monitoringSnapshot");
    return getMonitoringSnapshot();
  });
}

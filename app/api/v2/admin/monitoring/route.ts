import { getMonitoringSnapshot } from "../../../../../db/v2/queries/monitoringSnapshot";
import { handleAdminMonitoringGet } from "../../../../../lib/v2/adminMonitoringHttp";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAdminMonitoringGet(request, getMonitoringSnapshot);
}

import { operatorAuthResponse, operatorAuthStatus } from "./adminOperator";
import type { MonitoringSnapshotV1 } from "../../db/v2/monitoringSnapshotModel";

const NO_STORE = { "Cache-Control": "no-store" };

export async function handleAdminMonitoringGet(
  request: Request,
  loadSnapshot: () => Promise<MonitoringSnapshotV1>,
): Promise<Response> {
  const status = operatorAuthStatus(request.headers.get("authorization"));
  if (status !== 200) return operatorAuthResponse(status);

  try {
    return Response.json(await loadSnapshot(), { headers: NO_STORE });
  } catch {
    console.error("[V2 monitoring] Current snapshot query failed.");
    return Response.json({ ok: false, code: "monitoring_unavailable", message: "Current monitoring data is unavailable." }, {
      status: 500,
      headers: NO_STORE,
    });
  }
}

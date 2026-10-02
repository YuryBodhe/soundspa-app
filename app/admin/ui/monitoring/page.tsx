import { headers } from "next/headers";
import { operatorAuthStatus } from "../../../../lib/v2/adminOperator";
import MonitoringDashboard from "./MonitoringDashboard";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) {
    throw new Error("V2 operator authorization required.");
  }
  const { getMonitoringSnapshot } = await import("../../../../db/v2/queries/monitoringSnapshot");
  const snapshot = await getMonitoringSnapshot();
  return <MonitoringDashboard initialSnapshot={snapshot} />;
}

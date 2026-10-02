import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { operatorAuthStatus } from "../../../../../../lib/v2/adminOperator";
import MonitoringLocationDetail from "./MonitoringLocationDetail";

export const dynamic = "force-dynamic";

export default async function MonitoringLocationPage({ params }: { params: Promise<{ locationId: string }> }) {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) {
    throw new Error("V2 operator authorization required.");
  }
  const [{ locationId }, { getMonitoringSnapshot }] = await Promise.all([
    params,
    import("../../../../../../db/v2/queries/monitoringSnapshot"),
  ]);
  const snapshot = await getMonitoringSnapshot();
  const organization = snapshot.organizations.find((item) => item.locations.some((location) => location.id === locationId));
  const location = organization?.locations.find((item) => item.id === locationId);
  if (!organization || !location) notFound();
  return <MonitoringLocationDetail initialSnapshot={snapshot} locationId={locationId} />;
}

import Link from "next/link";
import { headers } from "next/headers";
import { operatorAuthStatus } from "../../../../lib/v2/adminOperator";
import AnalyticsReportClient from "./AnalyticsReportClient";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) {
    throw new Error("V2 operator authorization required.");
  }
  const { listOrganizationsWithLocations } = await import("../../../../db/v2/queries/core");
  const customers = await listOrganizationsWithLocations();
  const options = {
    organizations: customers.map(({ organization }) => ({ id: organization.id, name: organization.name, archived: organization.archivedAt !== null })),
    locations: customers.flatMap(({ organization, locations }) => locations.map((location) => ({
      id: location.id,
      name: location.name,
      organizationId: organization.id,
      archived: location.archivedAt !== null,
    }))),
  };

  return <>
    <div className="admin-page-header">
      <div>
        <p className="monitoring-eyebrow">SOUNDSPA V2 · REPORTS</p>
        <h1 className="admin-page-title">Analytics</h1>
        <p className="text-dim">Generate an on-demand report from completed monitoring aggregates.</p>
      </div>
      <div className="admin-page-nav">
        <Link href="/admin/ui" className="btn btn-sm">Admin</Link>
        <Link href="/admin/ui/monitoring" className="btn btn-sm">Monitoring</Link>
      </div>
    </div>
    <AnalyticsReportClient options={options} />
  </>;
}

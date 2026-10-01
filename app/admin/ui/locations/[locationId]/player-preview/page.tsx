import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { operatorAuthStatus } from "../../../../../../lib/v2/adminOperator";
import CustomerCatalogPlayer from "../../../../../v2/customerCatalog";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function LocationPlayerPreview({ params }: { params: Promise<{ locationId: string }> }) {
  // The Admin proxy returns the HTTP Basic challenge. Keep a route-level guard
  // as defense in depth in case this page is ever remounted outside that matcher.
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) notFound();

  const { locationId } = await params;
  if (!UUID.test(locationId)) notFound();

  const [{ locations, organizations }, { v2Db }] = await Promise.all([
    import("../../../../../../db/v2/schema"),
    import("../../../../../../db/v2/client"),
  ]);
  const [location] = await v2Db.select({ id: locations.id, name: locations.name, organizationName: organizations.name })
    .from(locations)
    .innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(and(eq(locations.id, locationId), isNull(locations.archivedAt), isNull(organizations.archivedAt)))
    .limit(1);
  if (!location) notFound();

  const { getLocationCustomerCatalog } = await import("../../../../../../lib/v2/customerCatalog");
  const catalog = await getLocationCustomerCatalog(location.id);
  return <>
    <div role="note" style={{ position: "sticky", top: 0, zIndex: 20, padding: "10px 16px", background: "#26352d", color: "#e7efe8", textAlign: "center" }}>
      Operator Player Preview · {location.organizationName} / {location.name} · <a href={`/admin/ui?location=${encodeURIComponent(location.id)}`}>Return to Admin</a>
    </div>
    <CustomerCatalogPlayer initialCatalog={catalog} />
  </>;
}

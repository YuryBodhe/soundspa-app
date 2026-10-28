import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { operatorAuthStatus } from "../../../lib/v2/adminOperator";
import { adminLocationPath } from "../../../lib/v2/adminLocationNavigation";
import AccessMutationForm from "./accessMutationForm";
import CustomerProvisioningForm from "./customerProvisioningForm";
import DeleteOrganizationPanel from "./deleteOrganizationPanel";
import { getTimeZoneOptions } from "../../../lib/v2/timeZones";

export const dynamic = "force-dynamic";

export default async function SoundSpaAdmin({ searchParams }: { searchParams: Promise<{ location?: string; message?: string }> }) {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) throw new Error("V2 operator authorization required.");
  const params = await searchParams;

  // Preserve existing links and post-provisioning redirects while moving Location controls.
  if (params.location) redirect(`${adminLocationPath(params.location)}${params.message ? `?message=${encodeURIComponent(params.message.slice(0, 200))}` : ""}`);

  const [{ listOrganizationsWithLocations }, { getSoundSpaProduct }, { commercialPartners, commercialProductChannels, commercialProducts, channels }, { and, asc, eq, isNull }, { v2Db }] = await Promise.all([
    import("../../../db/v2/queries/core"), import("../../../db/v2/queries/commercialProducts"), import("../../../db/v2/schema"), import("drizzle-orm"), import("../../../db/v2/client"),
  ]);
  const [customers, products, productComposition, partners, soundSpaProduct, published] = await Promise.all([
    listOrganizationsWithLocations(),
    v2Db.select().from(commercialProducts).orderBy(asc(commercialProducts.code)),
    v2Db.select({ productId: commercialProductChannels.productId, channelId: channels.id, channelSlug: channels.slug, channelName: channels.displayName })
      .from(commercialProductChannels).innerJoin(channels, eq(channels.id, commercialProductChannels.channelId)).orderBy(asc(channels.sortOrder), asc(channels.id)),
    v2Db.select().from(commercialPartners).orderBy(asc(commercialPartners.code)),
    getSoundSpaProduct(),
    v2Db.select().from(channels).where(and(eq(channels.isPublished, true), isNull(channels.archivedAt))).orderBy(asc(channels.kind), asc(channels.sortOrder), asc(channels.id)),
  ]);
  const productChannels = new Map<string, typeof productComposition>();
  for (const item of productComposition) productChannels.set(item.productId, [...(productChannels.get(item.productId) ?? []), item]);
  const soundSpaChannelIds = new Set(soundSpaProduct ? (await v2Db.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(eq(commercialProductChannels.productId, soundSpaProduct.id))).map(({ channelId }) => channelId) : []);

  return <>
    <div className="admin-page-header"><h1 className="admin-page-title">SoundSpa Admin</h1><div className="admin-page-nav admin-main-nav"><Link href="/admin/ui/products" className="btn btn-sm">Products</Link><Link href="/admin/ui/offers" className="btn btn-sm">Offers &amp; Invites</Link><Link href="/admin/ui/spaquatoria-promos" className="btn btn-sm">Spaquatoria Promo Codes</Link><Link href="/admin/ui/registration-links" className="btn btn-sm">Registration Links</Link><Link href="/admin/ui/monitoring" className="btn btn-sm">Monitoring</Link><Link href="/admin/ui/analytics" className="btn btn-sm">Analytics</Link></div></div>
    {params.message && <p role="status">{params.message.slice(0, 200)}</p>}
    <details className="admin-card admin-collapsible">
      <summary className="admin-collapsible-summary"><span>Products</span><span className="admin-disclosure-indicator" aria-hidden="true">⌄</span></summary>
      <div className="admin-collapsible-content"><p><Link href="/admin/ui/products" className="btn btn-sm">Manage Products</Link></p><table className="admin-table"><thead><tr><th>Code</th><th>Name</th><th>State</th><th>Channel composition</th></tr></thead><tbody>
        {products.map((product) => <tr key={product.id}>
          <td>{product.code}</td><td>{product.name}</td><td>{product.isActive ? "Active" : "Inactive"}</td>
          <td>{(productChannels.get(product.id) ?? []).map((channel, index) => <span key={channel.channelId} title={channel.channelSlug}>{index ? ", " : ""}{channel.channelName}</span>)}</td>
        </tr>)}
        {!products.length && <tr><td colSpan={4} className="text-dim">No Products configured.</td></tr>}
      </tbody></table></div>
    </details>
    <details className="admin-card admin-collapsible">
      <summary className="admin-collapsible-summary"><span>Partners</span><span className="admin-disclosure-indicator" aria-hidden="true">⌄</span></summary>
      <div className="admin-collapsible-content"><table className="admin-table"><thead><tr><th>Code</th><th>Name</th><th>State</th></tr></thead><tbody>
        {partners.map((partner) => <tr key={partner.id}><td>{partner.code}</td><td>{partner.name}</td><td>{partner.isActive ? "Active" : "Inactive"}</td></tr>)}
        {!partners.length && <tr><td colSpan={3} className="text-dim">No Partners configured.</td></tr>}
      </tbody></table></div>
    </details>
    <details className="admin-card admin-collapsible">
      <summary className="admin-collapsible-summary"><span>SoundSpa Basic channel composition</span><span className="admin-disclosure-indicator" aria-hidden="true">⌄</span></summary>
      <div className="admin-collapsible-content">
        <p className="text-dim">SoundSpa Basic composition defines the standard commercial package.</p>
        {soundSpaProduct ? <table className="admin-table"><thead><tr><th>Channel</th><th>Kind</th><th>SoundSpa</th><th /></tr></thead><tbody>{published.map((channel) => <tr key={`soundspa-${channel.id}`}><td>{channel.displayName}</td><td>{channel.kind === "music" ? "Music" : "Ambient"}</td><td>{soundSpaChannelIds.has(channel.id) ? <span className="badge badge-ok">INCLUDED</span> : <span className="badge badge-neutral">OFF</span>}</td><td><AccessMutationForm operation={soundSpaChannelIds.has(channel.id) ? "remove-product-channel" : "add-product-channel"} productCode="soundspa" channelId={channel.id}><button className="btn btn-sm">{soundSpaChannelIds.has(channel.id) ? "Remove from SoundSpa" : "Add to SoundSpa"}</button></AccessMutationForm></td></tr>)}</tbody></table> : <p className="text-dim">SoundSpa product is not provisioned.</p>}
      </div>
    </details>
    <section className="admin-card admin-customers-card">
      <CustomerProvisioningForm timeZones={getTimeZoneOptions()} />
      <div className="admin-customer-organizations">
        {customers.map(({ organization, locations: customerLocations, deviceCount }) => <article className="admin-customer-organization" key={organization.id}>
          <div className="admin-customer-organization-heading"><h3>{organization.name}</h3><span className={`badge ${organization.archivedAt ? "badge-neutral" : "badge-ok"}`}>{organization.archivedAt ? "ARCHIVED" : "ACTIVE"}</span></div>
          {customerLocations.length ? <ul className="admin-customer-location-list">{customerLocations.map((location) => <li className="admin-customer-location-row" key={location.id}>
            <div><strong>{location.name}</strong><span className="text-dim">{location.slug}</span></div>
            <span className={`badge ${location.archivedAt ? "badge-neutral" : "badge-ok"}`}>{location.archivedAt ? "ARCHIVED" : "ACTIVE"}</span>
            {!organization.archivedAt && !location.archivedAt ? <Link className="btn btn-sm" href={adminLocationPath(location.id)}>Open Location</Link> : <span />}
          </li>)}</ul> : <p className="text-dim">No Locations yet.</p>}
          <div className="admin-customer-organization-actions"><span className="text-dim">{customerLocations.length} Location(s) · {deviceCount} Device(s)</span><DeleteOrganizationPanel organizationId={organization.id} organizationName={organization.name} locationCount={customerLocations.length} deviceCount={deviceCount} /></div>
        </article>)}
        {!customers.length && <p className="text-dim">No Customers yet.</p>}
      </div>
    </section>
  </>;
}

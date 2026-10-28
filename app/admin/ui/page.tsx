import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { operatorAuthStatus } from "../../../lib/v2/adminOperator";
import { adminLocationPath } from "../../../lib/v2/adminLocationNavigation";
import AccessMutationForm from "./accessMutationForm";
import CustomersDirectory from "./CustomersDirectory";
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
  const customerOrganizations = customers.map(({ organization, locations: customerLocations, deviceCount }) => ({
    id: organization.id,
    name: organization.name,
    contactEmail: organization.contactEmail,
    archived: Boolean(organization.archivedAt),
    locations: customerLocations.map((location) => ({ id: location.id, name: location.name, slug: location.slug, archived: Boolean(location.archivedAt) })),
    deviceCount,
  }));

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
    <details className="admin-card admin-collapsible">
      <summary className="admin-collapsible-summary"><span>Billing</span><span className="admin-disclosure-indicator" aria-hidden="true">⌄</span></summary>
      <div className="admin-collapsible-content admin-billing-nav">
        <Link href="/admin/ui/billing/payments" className="btn btn-sm">Payments</Link>
        <Link href="/admin/ui/billing/subscriptions" className="btn btn-sm">Subscriptions</Link>
      </div>
    </details>
    <CustomersDirectory organizations={customerOrganizations} timeZones={getTimeZoneOptions()} />
  </>;
}

import { headers } from "next/headers";
import Link from "next/link";
import { operatorAuthStatus } from "../../../lib/v2/adminOperator";
import AccessMutationForm from "./accessMutationForm";
import CustomerProvisioningForm from "./customerProvisioningForm";
import DeviceProvisioningPanel from "./deviceProvisioningPanel";
import DeleteLocationPanel from "./deleteLocationPanel";
import DeleteOrganizationPanel from "./deleteOrganizationPanel";
import { getTimeZoneOptions } from "../../../lib/v2/timeZones";

export const dynamic = "force-dynamic";

export default async function SoundSpaAdmin({ searchParams }: { searchParams: Promise<{ location?: string; message?: string }> }) {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) throw new Error("V2 operator authorization required.");
  const params = await searchParams;
  const [{ resolveEffectiveChannelAccess }, { getSoundSpaProduct }, { getLocationAdminGrants }, { getHiddenChannelIds }, { listOrganizationsWithLocations }, { channels, commercialProductChannels, locations, organizations }, { and, asc, eq, isNull }, { v2Db }] = await Promise.all([
    import("../../../db/v2/queries/effectiveAccess"), import("../../../db/v2/queries/commercialProducts"), import("../../../db/v2/queries/adminGrants"), import("../../../db/v2/queries/locationChannelVisibility"), import("../../../db/v2/queries/core"), import("../../../db/v2/schema"), import("drizzle-orm"), import("../../../db/v2/client"),
  ]);
  const customers = await listOrganizationsWithLocations();
  const published = await v2Db.select().from(channels).where(and(eq(channels.isPublished, true), isNull(channels.archivedAt))).orderBy(asc(channels.kind), asc(channels.sortOrder), asc(channels.id));
  const soundSpaProduct = await getSoundSpaProduct();
  const soundSpaChannelIds = new Set(soundSpaProduct ? (await v2Db.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(eq(commercialProductChannels.productId, soundSpaProduct.id))).map(({ channelId }) => channelId) : []);
  const locs = await v2Db.select({ location: locations, organization: organizations }).from(locations).innerJoin(organizations, eq(organizations.id, locations.organizationId)).where(isNull(locations.archivedAt)).orderBy(asc(locations.name));
  const selected = locs.find(({ location }) => location.id === params.location) ?? locs[0];
  const [effective, grants, hiddenIds, selectedDevices] = selected ? await Promise.all([
    resolveEffectiveChannelAccess(selected.location.id, new Date()), getLocationAdminGrants(selected.location.id), getHiddenChannelIds(selected.location.id), import("../../../db/v2/queries/devices").then(({ listDevicesForLocation }) => listDevicesForLocation(selected.location.id)),
  ]) : [[], [], new Set<string>(), []];
  const grantByChannel = new Map(grants.map(({ grant }) => [grant.channelId, grant]));

  return <>
    <div className="admin-page-header"><h1 className="admin-page-title">SoundSpa Admin</h1><div className="admin-page-nav"><Link href="/admin/ui/monitoring" className="btn btn-sm">Monitoring</Link><Link href="/admin/ui/analytics" className="btn btn-sm">Analytics</Link></div></div>
    {params.message && <p role="status">{params.message.slice(0, 200)}</p>}
    <section className="admin-card">
      <h2 className="admin-card-title">SoundSpa Basic</h2>
      <p className="text-dim">SoundSpa Basic composition defines the standard commercial package.</p>
      {soundSpaProduct ? <table className="admin-table"><thead><tr><th>Channel</th><th>Kind</th><th>SoundSpa</th><th /></tr></thead><tbody>{published.map((channel) => <tr key={`soundspa-${channel.id}`}><td>{channel.displayName}</td><td>{channel.kind === "music" ? "Music" : "Ambient"}</td><td>{soundSpaChannelIds.has(channel.id) ? <span className="badge badge-ok">INCLUDED</span> : <span className="badge badge-neutral">OFF</span>}</td><td><AccessMutationForm operation={soundSpaChannelIds.has(channel.id) ? "remove-product-channel" : "add-product-channel"} productCode="soundspa" channelId={channel.id}><button className="btn btn-sm">{soundSpaChannelIds.has(channel.id) ? "Remove from SoundSpa" : "Add to SoundSpa"}</button></AccessMutationForm></td></tr>)}</tbody></table> : <p className="text-dim">SoundSpa product is not provisioned.</p>}
    </section>
    <section className="admin-card">
      <CustomerProvisioningForm timeZones={getTimeZoneOptions()} />
      <table className="admin-table"><thead><tr><th>Organization</th><th>Location</th><th>Slug</th><th>State</th><th>Location controls</th><th>Danger zone</th></tr></thead><tbody>
        {customers.flatMap(({ organization, locations: customerLocations, deviceCount }) => customerLocations.length
          ? customerLocations.map((location, index) => <tr key={`${organization.id}-${location.id}`}>
            {index === 0 && <td rowSpan={customerLocations.length}>{organization.name}{organization.archivedAt ? <span className="badge badge-neutral">ARCHIVED</span> : null}</td>}
            <td>{location.name}</td><td>{location.slug}</td>
            <td>{location.archivedAt ? <span className="badge badge-neutral">ARCHIVED</span> : <span className="badge badge-ok">ACTIVE</span>}</td>
            <td>{!organization.archivedAt && !location.archivedAt ? <a className="btn btn-sm" href={`/admin/ui?location=${encodeURIComponent(location.id)}`}>Open Location</a> : null}</td>
            {index === 0 && <td rowSpan={customerLocations.length}><DeleteOrganizationPanel organizationId={organization.id} organizationName={organization.name} locationCount={customerLocations.length} deviceCount={deviceCount} /></td>}
          </tr>)
          : [<tr key={organization.id}><td>{organization.name}{organization.archivedAt ? <span className="badge badge-neutral">ARCHIVED</span> : null}</td><td colSpan={3} className="text-dim">No Locations yet</td><td /><td><DeleteOrganizationPanel organizationId={organization.id} organizationName={organization.name} locationCount={0} deviceCount={deviceCount} /></td></tr>])}
        {!customers.length && <tr><td colSpan={6} className="text-dim">No Customers yet.</td></tr>}
      </tbody></table>
    </section>
    {selected && <section className="admin-card">
      <h2 className="admin-card-title">{selected.location.name}</h2>
      <p className="text-dim">{selected.organization.name} · {selected.location.slug} · Effective playable channels: {effective.filter((c) => c.playable).length}</p>
      {!selected.organization.archivedAt && <p><a className="btn btn-primary" href={`/admin/ui/locations/${encodeURIComponent(selected.location.id)}/player-preview`} target="_blank" rel="noopener noreferrer">Open Player Preview</a></p>}
      {!selected.organization.archivedAt && <DeviceProvisioningPanel locationId={selected.location.id} devices={selectedDevices} />}
      <table className="admin-table"><thead><tr><th>Channel</th><th>Kind</th><th>Visibility</th><th>Effective Access</th><th>Sources</th><th>Admin Override</th><th /></tr></thead><tbody>
        {effective.map((channel) => {
          const grant = grantByChannel.get(channel.id); const hidden = hiddenIds.has(channel.id);
          return <tr key={channel.id}>
            <td>{channel.displayName}</td><td>{channel.kind === "music" ? "Music" : "Ambient"}</td>
            <td><span className={hidden ? "badge badge-warn" : "badge badge-ok"}>{hidden ? "HIDDEN" : "VISIBLE"}</span></td>
            <td>{channel.playable ? <span className="badge badge-ok">PLAYABLE</span> : <span className="badge badge-warn">LOCKED</span>}</td>
            <td>{channel.accessSources.length ? channel.accessSources.join(", ") : "—"}</td>
            <td>{grant ? <span className={grant.enabled ? "badge badge-ok" : "badge badge-neutral"}>{grant.enabled ? "ADMIN ON" : "ADMIN OFF"}</span> : "OFF"}</td>
            <td><AccessMutationForm operation={hidden ? "show-channel" : "hide-channel"} locationId={selected.location.id} channelId={channel.id}><button className="btn btn-sm">{hidden ? "Show" : "Hide"}</button></AccessMutationForm></td>
          </tr>;
        })}
      </tbody></table>
    </section>}
    {selected && !selected.organization.archivedAt && <DeleteLocationPanel
      locationId={selected.location.id}
      locationName={selected.location.name}
      organizationName={selected.organization.name}
      deviceCount={selectedDevices.length}
    />}
  </>;
}

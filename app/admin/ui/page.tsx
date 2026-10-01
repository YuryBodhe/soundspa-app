import { headers } from "next/headers";
import { operatorAuthStatus } from "../../../lib/v2/adminOperator";
import AccessMutationForm from "./accessMutationForm";
import CustomerProvisioningForm from "./customerProvisioningForm";
import DeviceProvisioningPanel from "./deviceProvisioningPanel";

export const dynamic = "force-dynamic";

export default async function SoundSpaAdmin({ searchParams }: { searchParams: Promise<{ location?: string; message?: string }> }) {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) throw new Error("V2 operator authorization required.");
  const params = await searchParams;
  const [{ resolveEffectiveChannelAccess }, { getBaseChannelIds }, { getLocationAdminGrants }, { getHiddenChannelIds }, { listOrganizationsWithLocations }, { channels, locations, organizations }, { and, asc, eq, isNull }, { v2Db }] = await Promise.all([
    import("../../../db/v2/queries/effectiveAccess"), import("../../../db/v2/queries/base"), import("../../../db/v2/queries/adminGrants"), import("../../../db/v2/queries/locationChannelVisibility"), import("../../../db/v2/queries/core"), import("../../../db/v2/schema"), import("drizzle-orm"), import("../../../db/v2/client"),
  ]);
  const customers = await listOrganizationsWithLocations();
  const published = await v2Db.select().from(channels).where(and(eq(channels.isPublished, true), isNull(channels.archivedAt))).orderBy(asc(channels.kind), asc(channels.sortOrder), asc(channels.id));
  const baseIds = new Set(await getBaseChannelIds());
  const locs = await v2Db.select({ location: locations, organization: organizations }).from(locations).innerJoin(organizations, eq(organizations.id, locations.organizationId)).where(isNull(locations.archivedAt)).orderBy(asc(locations.name));
  const selected = locs.find(({ location }) => location.id === params.location) ?? locs[0];
  const [effective, grants, hiddenIds, selectedDevices] = selected ? await Promise.all([
    resolveEffectiveChannelAccess(selected.location.id, new Date()), getLocationAdminGrants(selected.location.id), getHiddenChannelIds(selected.location.id), import("../../../db/v2/queries/devices").then(({ listDevicesForLocation }) => listDevicesForLocation(selected.location.id)),
  ]) : [[], [], new Set<string>(), []];
  const grantByChannel = new Map(grants.map(({ grant }) => [grant.channelId, grant]));

  return <>
    <div className="admin-page-header"><h1 className="admin-page-title">SoundSpa Admin</h1></div>
    {params.message && <p role="status">{params.message.slice(0, 200)}</p>}
    <section className="admin-card">
      <h2 className="admin-card-title">Base</h2><p className="text-dim">Global package membership uses the effective access resolver.</p>
      <table className="admin-table"><thead><tr><th>Channel</th><th>Kind</th><th>Base</th><th /></tr></thead><tbody>
        {published.map((channel) => <tr key={channel.id}><td>{channel.displayName}</td><td>{channel.kind === "music" ? "Music" : "Ambient"}</td><td>{baseIds.has(channel.id) ? <span className="badge badge-ok">BASE</span> : <span className="badge badge-neutral">OFF</span>}</td><td><AccessMutationForm operation={baseIds.has(channel.id) ? "remove-base" : "add-base"} channelId={channel.id}><button className="btn btn-sm">{baseIds.has(channel.id) ? "Remove from Base" : "Add to Base"}</button></AccessMutationForm></td></tr>)}
      </tbody></table>
    </section>
    <section className="admin-card">
      <CustomerProvisioningForm />
      <table className="admin-table"><thead><tr><th>Organization</th><th>Location</th><th>Slug</th><th>State</th><th /></tr></thead><tbody>
        {customers.flatMap(({ organization, locations: customerLocations }) => customerLocations.length
          ? customerLocations.map((location) => <tr key={`${organization.id}-${location.id}`}>
            <td>{organization.name}{organization.archivedAt ? <span className="badge badge-neutral">ARCHIVED</span> : null}</td>
            <td>{location.name}</td><td>{location.slug}</td>
            <td>{location.archivedAt ? <span className="badge badge-neutral">ARCHIVED</span> : <span className="badge badge-ok">ACTIVE</span>}</td>
            <td>{!organization.archivedAt && !location.archivedAt ? <a className="btn btn-sm" href={`/admin/ui?location=${encodeURIComponent(location.id)}`}>Open Location</a> : null}</td>
          </tr>)
          : [<tr key={organization.id}><td>{organization.name}{organization.archivedAt ? <span className="badge badge-neutral">ARCHIVED</span> : null}</td><td colSpan={4} className="text-dim">No Locations yet</td></tr>])}
        {!customers.length && <tr><td colSpan={5} className="text-dim">No Customers yet.</td></tr>}
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
  </>;
}

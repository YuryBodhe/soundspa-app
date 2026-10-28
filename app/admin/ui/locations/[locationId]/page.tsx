import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { operatorAuthStatus } from "../../../../../lib/v2/adminOperator";
import { SOUNDSPA_BASIC_TRIAL_DAYS } from "../../../../../db/v2/queries/trialPolicy";
import AccessMutationForm from "../../accessMutationForm";
import DeleteLocationPanel from "../../deleteLocationPanel";
import DeviceProvisioningPanel from "../../deviceProvisioningPanel";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AdminLocationPage({ params, searchParams }: {
  params: Promise<{ locationId: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) throw new Error("V2 operator authorization required.");
  const [{ locationId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(locationId)) notFound();
  const [{ resolveEffectiveChannelAccess }, { getSoundSpaProduct }, { getHiddenChannelIds }, { getSoundSpaTrial }, { and, eq, isNull }, { commercialProductChannels, locations, organizations }, { v2Db }] = await Promise.all([
    import("../../../../../db/v2/queries/effectiveAccess"), import("../../../../../db/v2/queries/commercialProducts"), import("../../../../../db/v2/queries/locationChannelVisibility"), import("../../../../../db/v2/queries/coreTrials"), import("drizzle-orm"), import("../../../../../db/v2/schema"), import("../../../../../db/v2/client"),
  ]);
  const [selected] = await v2Db.select({ location: locations, organization: organizations }).from(locations)
    .innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(and(eq(locations.id, locationId), isNull(locations.archivedAt))).limit(1);
  if (!selected) notFound();

  const [effective, hiddenIds, selectedDevices, soundSpaTrial, soundSpaProduct] = await Promise.all([
    resolveEffectiveChannelAccess(selected.location.id, new Date()),
    getHiddenChannelIds(selected.location.id),
    import("../../../../../db/v2/queries/devices").then(({ listDevicesForLocation }) => listDevicesForLocation(selected.location.id)),
    getSoundSpaTrial(selected.location.id),
    getSoundSpaProduct(),
  ]);
  const soundSpaChannelIds = new Set(soundSpaProduct ? (await v2Db.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(eq(commercialProductChannels.productId, soundSpaProduct.id))).map(({ channelId }) => channelId) : []);
  const trialIsActive = soundSpaTrial?.trial.status === "active" && soundSpaTrial.trial.endsAt > new Date();

  return <>
    <div className="admin-page-header admin-location-page-header">
      <div><p className="monitoring-eyebrow">CUSTOMER MANAGEMENT</p><h1 className="admin-page-title">{selected.location.name}</h1><p className="text-dim">{selected.organization.name} · {selected.location.slug} · {effective.filter((channel) => channel.playable).length} effective playable channels</p></div>
      <div className="admin-page-nav"><Link href="/admin/ui" className="btn btn-sm">Back to Customers</Link></div>
    </div>
    {query.message && <p role="status">{query.message.slice(0, 200)}</p>}
    <section className="admin-card">
      <h2 className="admin-card-title">SoundSpa Basic</h2>
      <p className="text-dim">{soundSpaChannelIds.size} channels · Access: {trialIsActive ? "TRIAL" : soundSpaTrial ? "USED" : "NONE"}</p>
      {trialIsActive ? <><p className="text-dim">Started: {soundSpaTrial.trial.startsAt.toLocaleString()} · Ends: {soundSpaTrial.trial.endsAt.toLocaleString()}</p><AccessMutationForm operation="end-trial" locationId={selected.location.id} channelId="00000000-0000-4000-8000-000000000000"><button className="btn btn-sm">End trial now</button></AccessMutationForm></> : !soundSpaTrial ? <AccessMutationForm operation="start-trial" locationId={selected.location.id} channelId="00000000-0000-4000-8000-000000000000"><button className="btn btn-sm">Start {SOUNDSPA_BASIC_TRIAL_DAYS}-day trial</button></AccessMutationForm> : <p className="text-dim">This Location has already used its trial.</p>}
    </section>
    {!selected.organization.archivedAt && <section className="admin-card"><h2 className="admin-card-title">Player preview</h2><a className="btn btn-primary" href={`/admin/ui/locations/${encodeURIComponent(selected.location.id)}/player-preview`} target="_blank" rel="noopener noreferrer">Open Player Preview</a></section>}
    {!selected.organization.archivedAt && <details className="admin-card admin-collapsible admin-location-devices">
      <summary className="admin-collapsible-summary"><span>Devices <span className="text-dim">({selectedDevices.length})</span></span><span className="admin-disclosure-indicator" aria-hidden="true">⌄</span></summary>
      <div className="admin-collapsible-content"><DeviceProvisioningPanel locationId={selected.location.id} devices={selectedDevices} /></div>
    </details>}
    <section className="admin-card">
      <h2 className="admin-card-title">Channel access and visibility</h2>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Channel</th><th>Kind</th><th>Visibility</th><th>Effective Access</th><th>Sources</th><th>Actions</th></tr></thead><tbody>
        {effective.map((channel) => {
          const hidden = hiddenIds.has(channel.id); const hasAdminSource = channel.accessSources.includes("admin");
          return <tr key={channel.id}>
            <td>{channel.displayName}</td><td>{channel.kind === "music" ? "Music" : "Ambient"}</td>
            <td><span className={hidden ? "badge badge-warn" : "badge badge-ok"}>{hidden ? "HIDDEN" : "VISIBLE"}</span></td>
            <td>{hasAdminSource ? <AccessMutationForm operation="remove-admin" locationId={selected.location.id} channelId={channel.id}><button type="submit" className="badge badge-ok" title="Remove manual access">OPEN</button></AccessMutationForm> : channel.playable ? <span className="badge badge-ok" title="Access provided by Trial / Subscription / Partner Benefit">OPEN</span> : <AccessMutationForm operation="enable-admin" locationId={selected.location.id} channelId={channel.id}><button type="submit" className="badge badge-warn" title="Grant manual access">LOCKED</button></AccessMutationForm>}</td>
            <td>{channel.accessSources.length ? channel.accessSources.join(", ") : "—"}</td>
            <td><AccessMutationForm operation={hidden ? "show-channel" : "hide-channel"} locationId={selected.location.id} channelId={channel.id}><button className="btn btn-sm">{hidden ? "Show" : "Hide"}</button></AccessMutationForm>{channel.playable && !hasAdminSource && <span className="text-dim" title="Access provided by Trial / Subscription / Partner Benefit">Provided</span>}</td>
          </tr>;
        })}
        {!effective.length && <tr><td colSpan={6} className="text-dim">No published channels are available for this Location.</td></tr>}
      </tbody></table></div>
    </section>
    {!selected.organization.archivedAt && <DeleteLocationPanel locationId={selected.location.id} locationName={selected.location.name} organizationName={selected.organization.name} deviceCount={selectedDevices.length} />}
  </>;
}

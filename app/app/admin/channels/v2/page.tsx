import { headers } from "next/headers";
import { operatorAuthStatus } from "../../../../../lib/v2/adminOperator";
import { resolveImageUrl } from "../../../../v2/mediaUrls";
import { UploadControls } from "./UploadControls";
import { DeleteTrackControl } from "./DeleteTrackControl";

export const dynamic = "force-dynamic";
const endpoint = "/api/v2/admin/content";
type Metadata = { displayName: string; slug: string; kind: string; description: string | null; imageKey: string | null; sortOrder: number };

function MetadataFields({ channel, locked = false }: { channel?: Metadata; locked?: boolean }) {
  return <>
    <label>Display name<input name="displayName" required maxLength={200} defaultValue={channel?.displayName ?? ""} /></label>
    <label>Slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" readOnly={locked} defaultValue={channel?.slug ?? ""} /></label>
    <label>Kind<select name="kind" defaultValue={channel?.kind ?? "music"} disabled={locked}><option value="music">Music</option><option value="ambient">Ambient</option></select></label>
    {locked && <input type="hidden" name="kind" value={channel?.kind} />}
    <label>Description<textarea name="description" maxLength={2000} defaultValue={channel?.description ?? ""} /></label>
    <label>Sort order<input name="sortOrder" type="number" min={0} max={2147483647} required defaultValue={channel?.sortOrder ?? 0} /></label>
    <input type="hidden" name="imageKey" value={channel?.imageKey ?? ""} />
  </>;
}

export default async function ContentAdminPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  if (operatorAuthStatus((await headers()).get("authorization")) !== 200) throw new Error("V2 operator authorization required.");
  const { listAdminChannels, getAdminChannel } = await import("../../../../../db/v2/queries/contentAdmin");
  const list = await listAdminChannels();
  const details = await Promise.all(list.map((channel) => getAdminChannel(channel.id)));
  const { message } = await searchParams;
  return <>
    <div className="admin-page-header"><h1 className="admin-page-title">V2 Content — Channels</h1></div>
    <p>Isolated V2 Content administration. This screen does not edit legacy V1 channels. Artwork and MP3 uploads use external canonical storage.</p>
    {message && <p role="status">{message.slice(0,500)}</p>}
    <section className="admin-card"><h2 className="admin-card-title">Create draft channel</h2>
      <form action={endpoint} method="post" className="admin-form"><input type="hidden" name="operation" value="create" /><MetadataFields /><button className="btn btn-primary">Create draft</button></form>
    </section>
    <section className="admin-card"><h2 className="admin-card-title">All V2 channels ({list.length})</h2><table className="admin-table"><thead><tr><th>Name</th><th>Slug</th><th>Kind</th><th>State</th><th>Tracks</th></tr></thead><tbody>
      {details.map((channel) => channel && <tr key={channel.id}><td><a href={`#channel-${channel.id}`}>{channel.displayName}</a></td><td>{channel.slug}</td><td>{channel.kind}</td><td>{channel.archivedAt ? "Archived" : channel.isPublished ? "Published" : "Draft"}</td><td>{channel.tracks.length}</td></tr>)}
    </tbody></table></section>
    {details.map((channel) => channel && <section className="admin-card" id={`channel-${channel.id}`} key={channel.id}>
      <h2 className="admin-card-title">{channel.displayName}</h2><p className="text-dim">UUID: {channel.id}</p>
      <h3>Channel metadata</h3><form action={endpoint} method="post" className="admin-form">
        <input type="hidden" name="operation" value="edit" /><input type="hidden" name="channelId" value={channel.id} />
        <fieldset disabled={!!channel.archivedAt}><MetadataFields channel={channel} locked={channel.tracks.length > 0} /><button className="btn">Save metadata</button></fieldset>
      </form>
      {channel.tracks.length > 0 && <p className="text-dim">Slug and kind are locked because track records exist.</p>}
      <h3>Artwork</h3>{channel.imageKey && <img src={resolveImageUrl(channel.imageKey)!} alt={`${channel.displayName} artwork`} width={120} height={120} style={{objectFit:"cover"}} />}
      {!channel.archivedAt && <UploadControls channelId={channel.id} kind="artwork" />}
      <h3>Tracks</h3>{!channel.tracks.length && <p>No tracks uploaded.</p>}
      {!channel.archivedAt && <UploadControls channelId={channel.id} kind="track" />}
      {channel.tracks.map((track) => <div key={track.id}><form action={endpoint} method="post" className="admin-form">
        <input type="hidden" name="operation" value="track" /><input type="hidden" name="channelId" value={channel.id} /><input type="hidden" name="trackId" value={track.id} />
        <fieldset disabled={!!channel.archivedAt}><strong>{track.originalFilename}</strong><p className="text-dim">{track.storageKey} · {track.sizeBytes.toString()} bytes</p>
        <label>Order<input name="sortOrder" type="number" required min={0} max={2147483647} defaultValue={track.sortOrder} /></label>
        <label>State<select name="enabled" defaultValue={String(track.isEnabled)}><option value="true">Enabled</option><option value="false">Disabled</option></select></label><button className="btn btn-sm">Save track</button></fieldset>
      </form><DeleteTrackControl trackId={track.id} filename={track.originalFilename} /></div>)}
      <h3>Publish state</h3><p>{channel.archivedAt ? "Archived" : channel.isPublished ? "Published" : "Draft"}</p>
      {!channel.archivedAt && <><form action={endpoint} method="post" className="inline-form"><input type="hidden" name="channelId" value={channel.id} /><button className="btn" name="operation" value={channel.isPublished ? "unpublish" : "publish"}>{channel.isPublished ? "Unpublish" : "Publish"}</button></form>
      <details><summary>Archive channel</summary><p>Archive removes this channel from future catalogs. No DB rows or media files are deleted. There is no restore action in Phase 1.</p><form action={endpoint} method="post"><input type="hidden" name="channelId" value={channel.id} /><button className="btn" name="operation" value="archive">Confirm archive</button></form></details></>}
    </section>)}
  </>;
}

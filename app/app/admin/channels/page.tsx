// /app/admin/channels — глобальный список каналов
// Server Component: читает все channels из Drizzle

import { db } from "@/lib/db.pg";
import { createChannel, updateChannel, deleteChannel } from "../actions"; // Добавил deleteChannel
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminChannelsPage() {
  const allChannels = await db.query.channels.findMany({
    orderBy: (c, { asc }) => [asc(c.order), asc(c.slug)],
  });

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Channels</h1>
      </div>

      {/* ── Channel list ── */}
      <div className="admin-card">
        <div className="admin-card-title">All channels</div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Display name</th>
              <th>Mood</th>
              <th>Stream URL</th>
              <th>Image</th>
              <th>Order</th>
              <th>Kind</th>
              <th>New</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {allChannels.map((ch) => {
              const formId = `channel-form-${ch.id}`;
              return (
                <tr key={ch.id}>
                  <td>
                    <span className="text-dim">{ch.slug}</span>
                  </td>
                  <td>
                    <input
                      form={formId}
                      name="displayName"
                      defaultValue={ch.displayName}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <input
                      form={formId}
                      name="mood"
                      defaultValue={ch.mood ?? ""}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <input
                      form={formId}
                      name="streamUrl"
                      defaultValue={ch.streamUrl}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <input
                      form={formId}
                      name="image"
                      defaultValue={ch.image ?? ""}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td style={{ width: 70 }}>
                    <input
                      form={formId}
                      name="order"
                      type="number"
                      defaultValue={ch.order}
                      style={{ width: "100%", textAlign: 'center' }}
                    />
                  </td>
                  <td style={{ width: 120 }}>
                    <select
                      form={formId}
                      name="kind"
                      defaultValue={ch.kind || "music"}
                      style={{ 
                        width: "100%",
                        padding: '4px',
                        borderRadius: '4px',
                        background: 'rgba(255,255,255,0.05)',
                        color: ch.kind === 'noise' ? '#C3A86C' : '#888',
                        fontWeight: ch.kind === 'noise' ? 'bold' : 'normal',
                        border: ch.kind === 'noise' ? '1px solid rgba(195,168,108,0.3)' : '1px solid rgba(255,255,255,0.1)'
                      }}
                    >
                      <option value="music">🎵 Music</option>
                      <option value="noise">🍃 Noise</option>
                    </select>
                  </td>
                  <td style={{ textAlign: "center", width: 50 }}>
                    <input
                      form={formId}
                      name="isNew"
                      type="checkbox"
                      defaultChecked={ch.isNew}
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <form
                        id={formId}
                        className="inline-form"
                        action={async (formData: FormData) => {
                          "use server";
                          await updateChannel(ch.id, {
                            displayName: formData.get("displayName") as string,
                            mood: (formData.get("mood") as string) ?? "",
                            streamUrl: formData.get("streamUrl") as string,
                            image: (formData.get("image") as string) ?? "",
                            order: parseInt((formData.get("order") as string) ?? "0", 10) || 0,
                            kind: (formData.get("kind") as string) || "music",
                            isNew: formData.get("isNew") === "on",
                          });
                        }}
                      >
                        <button type="submit" className="btn btn-sm">Save</button>
                      </form>

                      <form
                        action={async () => {
                          "use server";
                          await deleteChannel(ch.id);
                        }}
                        onSubmit={(e) => {
                          if (!confirm("Удалить канал навсегда?")) e.preventDefault();
                        }}
                      >
                        <button 
                          type="submit" 
                          className="btn btn-sm" 
                          style={{ backgroundColor: '#442222', color: '#ff8888' }}
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Create channel ── */}
      <div className="admin-card">
        <div className="admin-card-title">Create channel</div>
        <form
          className="admin-form"
          action={async (formData: FormData) => {
            "use server";
            await createChannel({
              code: formData.get("code") as string,
              slug: formData.get("slug") as string,
              displayName: formData.get("displayName") as string,
              mood: (formData.get("mood") as string) ?? "",
              streamUrl: formData.get("streamUrl") as string,
              image: (formData.get("image") as string) ?? "",
              order: parseInt((formData.get("order") as string) ?? "0", 10) || 0,
              kind: (formData.get("kind") as string) || "music",
              isNew: formData.get("isNew") === "on",
            });
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div className="form-row">
              <label htmlFor="newCode">Code</label>
              <input id="newCode" name="code" required placeholder="rain_forest" />
            </div>
            <div className="form-row">
              <label htmlFor="newSlug">Slug</label>
              <input id="newSlug" name="slug" required placeholder="rain-forest" />
            </div>
            <div className="form-row">
              <label htmlFor="newDisplayName">Display name</label>
              <input id="newDisplayName" name="displayName" required placeholder="Rain Forest" />
            </div>
            <div className="form-row">
              <label htmlFor="newMood">Mood</label>
              <input id="newMood" name="mood" placeholder="calm" />
            </div>
            <div className="form-row">
              <label htmlFor="newStreamUrl">Stream URL</label>
              <input id="newStreamUrl" name="streamUrl" type="url" required placeholder="https://" />
            </div>
            <div className="form-row">
              <label htmlFor="newImage">Image URL</label>
              <input id="newImage" name="image" placeholder="https://cdn..." />
            </div>
            <div className="form-row">
              <label htmlFor="newOrder">Order</label>
              <input id="newOrder" name="order" type="number" defaultValue={allChannels.length + 1} />
            </div>
            <div className="form-row" style={{ alignItems: "center" }}>
              <label htmlFor="newKind">Kind</label>
              <select id="newKind" name="kind" defaultValue="music">
                <option value="music">Music</option>
                <option value="noise">Noise</option>
              </select>

              <label htmlFor="newIsNew" style={{ marginLeft: 16 }}>New badge</label>
              <input id="newIsNew" name="isNew" type="checkbox" />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Create channel</button>
          </div>
        </form>
      </div>
    </>
  );
}
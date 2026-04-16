// /app/admin/tenants/[tenantId] — детальная страница тенанта
// Server Component: читает tenant + tenant_channels + channels

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db.pg";
import { eq, notInArray } from "drizzle-orm";
import { tenants, channels, tenantChannels } from "@/db";
import {
  updateTenant,
  updateTenantChannel,
  addChannelToTenant,
  removeChannelFromTenant,
  deleteTenant,
} from "../../actions";

function daysLeft(paidTill: Date | null): number | null {
  if (!paidTill) return null;
  return Math.floor((paidTill.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const id = parseInt(tenantId, 10);
  if (isNaN(id)) notFound();

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, id),
  });
  if (!tenant) notFound();

  // Каналы тенанта (join tenantChannels + channels)
  const linkedRows = await db
    .select({
      channelId:   channels.id,
      slug:        channels.slug,
      displayName: channels.displayName,
      streamUrl:   channels.streamUrl,
      image:       channels.image,
      isNew:       channels.isNew,
      kind:        channels.kind,    // <--- ДОБАВИЛИ ЭТО
      tcOrder:     tenantChannels.order,
    })
    .from(tenantChannels)
    .innerJoin(channels, eq(tenantChannels.channelId, channels.id))
    .where(eq(tenantChannels.tenantId, id))
    .orderBy(tenantChannels.order);
    const musicRows = linkedRows.filter(r => r.kind !== "noise");
    const noiseRows = linkedRows.filter(r => r.kind === "noise");

  // Каналы НЕ подключённые к этому тенанту (для формы добавления)
  const linkedIds = linkedRows.map(r => r.channelId);
  const availableChannels = linkedIds.length > 0
    ? await db
        .select()
        .from(channels)
        .where(notInArray(channels.id, linkedIds))
    : await db.select().from(channels);

  const paidTill = tenant.paidTill ? new Date(tenant.paidTill) : null;
  const days = daysLeft(paidTill);

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-title">{tenant.brandName ?? tenant.name}</h1>
        <Link href="/app/admin" className="btn btn-sm">← All tenants</Link>
      </div>

      {/* ── Tenant info ── */}
      <div className="admin-card">
        <div className="admin-card-title">Tenant info</div>

        <div className="text-dim mt-4" style={{ marginBottom: 16 }}>
          Slug: <strong style={{ color: "var(--text)" }}>{tenant.slug}</strong>
          {" · "}
          Days left:{" "}
          {days === null
            ? <span className="text-dim">no date</span>
            : days < 7
              ? <span className="days-left-warn">{days}d ⚠️</span>
              : <span className="days-left-ok">{days}d</span>}
        </div>

        <form
          className="admin-form"
          action={async (formData: FormData) => {
            "use server";
            await updateTenant(id, {
              brandName: formData.get("brandName") as string,
              paidTill:  formData.get("paidTill") as string,
            });
          }}
        >
          <div className="form-row">
            <label htmlFor="brandName">Brand name</label>
            <input
              id="brandName"
              name="brandName"
              defaultValue={tenant.brandName ?? tenant.name}
              required
            />
          </div>
          <div className="form-row">
            <label htmlFor="paidTill">Paid till</label>
            <input
              id="paidTill"
              name="paidTill"
              type="date"
              defaultValue={toDateInputValue(paidTill)}
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>

        <form
          style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}
          action={async (formData: FormData) => {
            "use server";
            const confirmSlug = formData.get("confirmSlug") as string;
            if (confirmSlug !== tenant.slug) {
              return;
            }
            await deleteTenant(id);
            redirect("/app/admin");
          }}
        >
          <div className="form-row">
            <label htmlFor="confirmSlug">
              Type <code>{tenant.slug}</code> to confirm delete
            </label>
            <input
              id="confirmSlug"
              name="confirmSlug"
              placeholder={tenant.slug}
              autoComplete="off"
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-danger">
              Delete tenant
            </button>
          </div>
        </form>
      </div>

      {/* ── Channels (Music & Noises) ── */}
      <div className="admin-card">
        
        {/* ТАБЛИЦА 1: МУЗЫКА */}
        <div className="admin-card-title">Music Channels (Top Row)</div>
        {musicRows.length === 0 ? (
          <p className="text-dim">No music channels linked yet.</p>
        ) : (
          <table className="admin-table" style={{ marginBottom: 32 }}>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Slug</th>
                <th>Order</th>
                <th>New</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {musicRows.map(row => (
                <tr key={row.channelId}>
                  <td>{row.displayName}</td>
                  <td><span className="text-dim">{row.slug}</span></td>
                  <td style={{ width: 120 }}>
                    <form action={async (formData: FormData) => {
                      "use server";
                      await updateTenantChannel(id, row.channelId, {
                        order: parseInt(formData.get("order") as string, 10),
                        isNew: formData.get("isNew") === "on",
                      });
                    }}>
                      <input name="order" type="number" defaultValue={row.tcOrder} style={{ width: 45 }} />
                      <input name="isNew" type="checkbox" defaultChecked={row.isNew} style={{ marginLeft: 8 }} />
                      <button type="submit" className="btn btn-sm" style={{ marginLeft: 8 }}>✓</button>
                    </form>
                  </td>
                  <td></td>
                  <td>
                    <form action={async () => { "use server"; await removeChannelFromTenant(id, row.channelId); }}>
                      <button type="submit" className="btn btn-sm btn-danger">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ТАБЛИЦА 2: ШУМЫ */}
        <div className="admin-card-title" style={{ color: "#C3A86C", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 24 }}>
          Ambient Noises (Bottom Slider)
        </div>
        {noiseRows.length === 0 ? (
          <p className="text-dim">No ambient noises linked yet.</p>
        ) : (
          <table className="admin-table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Noise Name</th>
                <th>Slug</th>
                <th>Order</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {noiseRows.map(row => (
                <tr key={row.channelId}>
                  <td>{row.displayName}</td>
                  <td><span className="text-dim">{row.slug}</span></td>
                  <td style={{ width: 80 }}>
                    <form action={async (formData: FormData) => {
                      "use server";
                      await updateTenantChannel(id, row.channelId, {
                        order: parseInt(formData.get("order") as string, 10),
                        isNew: false,
                      });
                    }}>
                      <input name="order" type="number" defaultValue={row.tcOrder} style={{ width: 45 }} />
                      <button type="submit" className="btn btn-sm" style={{ marginLeft: 8 }}>✓</button>
                    </form>
                  </td>
                  <td>
                    <form action={async () => { "use server"; await removeChannelFromTenant(id, row.channelId); }}>
                      <button type="submit" className="btn btn-sm btn-danger">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ДОБАВЛЕНИЕ КАНАЛА */}
        {availableChannels.length > 0 && (
          <div style={{ marginTop: 32, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 24 }}>
            <div className="admin-card-title">Add channel</div>
            <form
              className="admin-form"
              action={async (formData: FormData) => {
                "use server";
                const channelId = parseInt(formData.get("channelId") as string, 10);
                await addChannelToTenant(id, channelId);
              }}
            >
              <div className="form-row">
                <label htmlFor="channelId">Channel</label>
                <select id="channelId" name="channelId">
                  {availableChannels.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.displayName} ({c.slug}) — [{c.kind}]
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">Add →</button>
              </div>
            </form>
          </div> // Закрывает div с формой добавления (если он был открыт внутри условия)
        )}
      </div> // Закрывает основную .admin-card
    </> // Закрывает самый верхний пустой фрагмент страницы
  );
}

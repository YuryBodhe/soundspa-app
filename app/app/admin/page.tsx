// /app/admin — список тенантов
// Server Component: читает tenants из Drizzle, вычисляет статус доступа

import Link from "next/link";
import { db } from "@/lib/db.pg";

// 1. Улучшенная функция расчета: приоритет на оплату, затем на триал
function getAccessStatus(paidTill: Date | null, trialEndsAt: Date | null) {
  const now = Date.now();
  
  if (paidTill) {
    const days = Math.floor((new Date(paidTill).getTime() - now) / (1000 * 60 * 60 * 24));
    return { days, label: 'Paid' };
  }
  
  if (trialEndsAt) {
    const days = Math.floor((new Date(trialEndsAt).getTime() - now) / (1000 * 60 * 60 * 24));
    return { days, label: 'Trial' };
  }
  
  return { days: null, label: 'No date' };
}

// 2. Красивый бейдж с типом доступа
function DaysLeftBadge({ days, label }: { days: number | null, label: string }) {
  if (days === null) return <span className="badge badge-neutral">No access</span>;
  
  const statusClass = days < 0 ? 'badge-warn' : (days < 7 ? 'days-left-warn' : 'days-left-ok');
  const expiredText = days < 0 ? ' (expired)' : '';
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span className={`badge ${statusClass}`} style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
        {days}d{expiredText}
      </span>
      <span style={{ fontSize: '10px', opacity: 0.6, textTransform: 'uppercase', textAlign: 'center' }}>
        {label}
      </span>
    </div>
  );
}

export default async function AdminPage() {
  const allTenants = await db.query.tenants.findMany({
    orderBy: (t, { asc }) => [asc(t.slug)],
  });

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Tenants</h1>
        <div className="admin-page-nav">
          <Link href="/app/admin/channels" className="btn btn-sm">
            Channels
          </Link>
          <Link href="/app/admin/users" className="btn btn-sm">
            Users
          </Link>
        </div>
      </div>

      <div className="admin-card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Brand name</th>
              <th>Access Detail</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {allTenants.map(t => {
              // Вычисляем статус на основе двух дат
              const status = getAccessStatus(
                t.paidTill ? new Date(t.paidTill) : null,
                t.trialEndsAt ? new Date(t.trialEndsAt) : null
              );

              return (
                <tr key={t.id}>
                  <td><span className="text-dim">{t.slug}</span></td>
                  <td>{t.brandName ?? t.name}</td>
                  <td>
                    <div style={{ fontSize: '13px' }}>
                      {t.paidTill
                        ? `💳 До: ${new Date(t.paidTill).toLocaleDateString("ru-RU")}`
                        : t.trialEndsAt 
                          ? `🎁 Триал: ${new Date(t.trialEndsAt).toLocaleDateString("ru-RU")}`
                          : <span className="text-dim">—</span>}
                    </div>
                  </td>
                  <td>
                    <DaysLeftBadge days={status.days} label={status.label} />
                  </td>
                  <td>
                    <Link
                      href={`/app/admin/tenants/${t.id}`}
                      className="btn btn-sm"
                    >
                      Edit →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
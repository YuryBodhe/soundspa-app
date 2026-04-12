// /app/admin — список тенантов
// Server Component: читает tenants из Drizzle, вычисляет daysLeft

import Link from "next/link";
import { db } from "@/lib/db.pg";

function daysLeft(paidTill: Date | null): number | null {
  if (!paidTill) return null;
  return Math.floor((paidTill.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function DaysLeftBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="badge badge-neutral">No date</span>;
  if (days < 0)  return <span className="badge badge-warn">{days}d (expired)</span>;
  if (days < 7)  return <span className="days-left-warn">{days}d left ⚠️</span>;
  return <span className="days-left-ok">{days}d left</span>;
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
              <th>Paid till</th>
              <th>Days left</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {allTenants.map(t => {
              const days = daysLeft(t.paidTill ? new Date(t.paidTill) : null);
              return (
                <tr key={t.id}>
                  <td><span className="text-dim">{t.slug}</span></td>
                  <td>{t.brandName ?? t.name}</td>
                  <td>
                    {t.paidTill
                      ? new Date(t.paidTill).toLocaleDateString("en-GB", {
                          day: "numeric", month: "short", year: "numeric",
                        })
                      : <span className="text-dim">—</span>}
                  </td>
                  <td><DaysLeftBadge days={days} /></td>
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

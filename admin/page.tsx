import { db } from "@/db";
import { tenants } from "@/db/schema.pg";

// ОТКЛЮЧАЕМ КЭШ: чтобы данные в админке всегда были актуальными
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // 1. Получаем список всех салонов из базы
  const allTenants = await db.select().from(tenants);

  return (
    <div style={{ padding: "40px", backgroundColor: "#07060a", minHeight: "100vh", color: "white", fontFamily: "sans-serif" }}>
      <h1 style={{ color: "#c3a86c", marginBottom: "20px", fontSize: "24px", letterSpacing: "0.1em" }}>
        ADMIN / TENANTS
      </h1>
      
      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(195,168,108,0.3)", color: "rgba(195,168,108,0.7)", textTransform: "uppercase", fontSize: "12px" }}>
            <th style={{ padding: "10px" }}>Название</th>
            <th style={{ padding: "10px" }}>Статус доступа</th>
            <th style={{ padding: "10px" }}>Оплачено до</th>
          </tr>
        </thead>
        <tbody>
          {allTenants.map((tenant) => {
            const daysLeft = tenant.paidTill 
              ? Math.ceil((new Date(tenant.paidTill).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : 0;

            return (
              <tr key={tenant.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "15px 10px" }}>{tenant.name}</td>
                <td style={{ 
                  padding: "15px 10px", 
                  color: daysLeft < 7 ? "#ff4d4d" : "#4dff88",
                  fontWeight: "bold"
                }}>
                  {daysLeft > 0 ? `${daysLeft} дн.` : "Истекла"}
                </td>
                <td style={{ padding: "15px 10px", opacity: 0.6 }}>
                  {tenant.paidTill ? new Date(tenant.paidTill).toLocaleDateString() : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
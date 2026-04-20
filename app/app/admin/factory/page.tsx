import { db } from "@/lib/db.pg";
import { agents, agentActions } from "@/db"; // Новые таблицы
import { eq, desc } from "drizzle-orm";

export default async function AdminFactoryPage() {
  // 1. Получаем настройки агентов
  const allAgents = await db.query.agents.findMany();

  // 2. Получаем последние 10 действий для лога
  const recentActions = await db.query.agentActions.findMany({
    limit: 10,
    orderBy: [desc(agentActions.createdAt)],
    with: { tenant: true } // Чтобы видеть название салона
  });

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-title">AI Factory</h1>
      </div>

      {/* Блок управления агентами */}
      <div className="admin-card">
        <div className="admin-card-title">Active Agents</div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>System Prompt</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {allAgents.map(agent => (
              <tr key={agent.id}>
                <td><span className="badge">{agent.name}</span></td>
                <td>
                  <textarea 
                    defaultValue={agent.systemPrompt ?? ""} 
                    className="admin-input"
                    rows={2}
                    style={{ width: '100%', fontSize: '12px' }}
                  />
                </td>
                <td>{agent.isActive ? "✅" : "❌"}</td>
                <td><button className="btn btn-sm">Save</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Лента событий — "Пульс завода" */}
      <div className="admin-card">
        <div className="admin-card-title">Recent Actions</div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Tenant</th>
              <th>Action</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {recentActions.map(act => (
              <tr key={act.id}>
               <td className="text-dim">
               {act.createdAt ? new Date(act.createdAt).toLocaleTimeString() : "—"}
              </td>
                <td>{(act.tenant as any)?.slug || "—"}</td>
                <td>{act.action}</td>
                <td>
                   <span className={`status-pill ${act.status}`}>
                     {act.status}
                   </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
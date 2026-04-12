// /app/admin/users — список пользователей, создание, сброс пароля
import { db } from "@/lib/db.pg";
import { createUser, resetPassword, deleteUser } from "../actions";

export default async function AdminUsersPage() {
  const allUsers = await db.query.users.findMany({
    with: { tenant: true },
    orderBy: (u, { asc }) => [asc(u.tenantId), asc(u.email)],
  });

  const allTenants = await db.query.tenants.findMany({
    orderBy: (t, { asc }) => [asc(t.slug)],
  });

  return (
    <>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Users</h1>
      </div>

      {/* ── User list ── */}
      <div className="admin-card">
        <div className="admin-card-title">All users</div>
        {allUsers.length === 0 ? (
          <p className="text-dim">No users yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Tenant</th>
                <th>Reset password</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {allUsers.map(u => (
                <tr key={u.id}>
                  <td><span className="text-dim">{u.email}</span></td>
                  <td>
                    <span className="badge badge-neutral">
                      {u.tenant.slug}
                    </span>
                  </td>
                  <td>
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        const pw = formData.get("password") as string;
                        if (pw) await resetPassword(u.id, pw);
                      }}
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <input
                        name="password"
                        type="password"
                        placeholder="New password"
                        style={{ width: 160 }}
                      />
                      <button type="submit" className="btn btn-sm">Set</button>
                    </form>
                  </td>
                  <td>
                    <form
                      action={async () => {
                        "use server";
                        await deleteUser(u.id);
                      }}
                    >
                      <button type="submit" className="btn btn-sm btn-danger">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create user ── */}
      <div className="admin-card">
        <div className="admin-card-title">Create user</div>
        <form
          className="admin-form"
          action={async (formData: FormData) => {
            "use server";
            const result = await createUser({
              email:    formData.get("email") as string,
              password: formData.get("password") as string,
              tenantId: parseInt(formData.get("tenantId") as string, 10),
            });
            if (result.error) throw new Error(result.error);
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-row">
              <label>Email</label>
              <input name="email" type="email" required placeholder="admin@salon.com" />
            </div>
            <div className="form-row">
              <label>Password</label>
              <input name="password" type="password" required placeholder="••••••••" />
            </div>
            <div className="form-row">
              <label>Tenant</label>
              <select name="tenantId" required>
                {allTenants.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.brandName ?? t.name} ({t.slug})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Create user</button>
          </div>
        </form>
      </div>
    </>
  );
}

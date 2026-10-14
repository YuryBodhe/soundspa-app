"use client";

import { FormEvent, useState } from "react";

type RouteState = { marketCode: string; providerCode: string; externalReference: string; isEnabled: boolean; displayOrder: number };
type RouteEvent = { id: string; action: string; operator: string; reason: string; beforeState: RouteState | null; afterState: RouteState; createdAt: Date | string };
type Route = RouteState & { id: string; productId: string; providerName: string; providerEnabled: boolean; createdAt: Date | string; updatedAt: Date | string; history: RouteEvent[] };
type Provider = { code: string; name: string; markets: readonly string[] };

export default function PaymentRouteManagement({ productId, productName, initialRoutes, providers }: {
  productId: string; productName: string; initialRoutes: Route[]; providers: readonly Provider[];
}) {
  const [routes, setRoutes] = useState(initialRoutes);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [providerCode, setProviderCode] = useState(providers[0]?.code ?? "");
  const selectedProvider = providers.find((provider) => provider.code === providerCode) ?? providers[0];

  async function refresh() {
    const response = await fetch(`/api/v2/admin/products/${encodeURIComponent(productId)}/payment-routes`, { credentials: "same-origin", cache: "no-store" });
    const result = await response.json().catch(() => ({})) as { routes?: Route[]; message?: string };
    if (!response.ok || !result.routes) throw new Error(result.message ?? "Payment routes could not be refreshed.");
    setRoutes(result.routes);
  }

  async function submitMutation(routeId: string, body: unknown, success: string) {
    setPending(routeId); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/v2/admin/products/${encodeURIComponent(productId)}/payment-routes/${encodeURIComponent(routeId)}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message ?? "The payment route could not be changed."); return false; }
      await refresh(); setMessage(success); return true;
    } catch { setError("Connection failed. Please retry."); return false; }
    finally { setPending(null); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending("create"); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/v2/admin/products/${encodeURIComponent(productId)}/payment-routes`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ marketCode: data.get("marketCode"), providerCode: data.get("providerCode"), externalReference: data.get("externalReference"), displayOrder: Number(data.get("displayOrder")), reason: data.get("reason") }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message ?? "The payment route could not be created."); return; }
      await refresh(); form.reset(); setMessage("Disabled payment route created. Enable it explicitly when ready."); return;
    } catch { setError("Connection failed. Please retry."); }
    finally { setPending(null); }
  }

  return <section className="payment-route-management" aria-label={`${productName} payment routes`}>
    <h3>Payment Routes</h3>
    <p className="text-dim">Routes determine payment options for new purchases. Disabling a route prevents new purchases but does not cancel existing pending payments.</p>
    {error && <p role="alert" className="partner-offer-feedback">{error}</p>}
    {message && <p role="status" className="partner-offer-feedback partner-offer-success">{message}</p>}
    {routes.length === 0 ? <p className="text-dim">No payment routes configured.</p> : <ul className="payment-route-list">
      {routes.map((route) => <li className="payment-route-card" key={route.id}>
        <div className="payment-route-summary">
          <strong>{route.marketCode} · {route.providerName}</strong>
          <span className={`badge ${route.isEnabled ? "badge-ok" : "badge-neutral"}`}>{route.isEnabled ? "ENABLED" : "DISABLED"}</span>
          <span>Priority {route.displayOrder}</span>
        </div>
        <p className="payment-route-reference">External reference: <code>{route.externalReference}</code></p>
        {!route.providerEnabled && <p className="text-dim">The provider is globally disabled. Route controls do not change provider status.</p>}
        <div className="payment-route-actions">
          <form className="admin-form payment-route-change-form" onSubmit={(event) => {
            event.preventDefault(); const data = new FormData(event.currentTarget);
            void submitMutation(route.id, { displayOrder: Number(data.get("displayOrder")), reason: data.get("reason") }, "Route priority updated.");
          }}>
            <label>Priority<input aria-label={`Priority for ${route.marketCode} ${route.providerName}`} type="number" min="0" max="2147483647" step="1" name="displayOrder" defaultValue={route.displayOrder} required /></label>
            <label>Reason<input name="reason" minLength={12} maxLength={500} required placeholder="Reason for priority change" /></label>
            <button className="btn btn-sm" disabled={pending === route.id}>Save priority</button>
          </form>
          <form className="admin-form payment-route-change-form" onSubmit={(event) => {
            event.preventDefault(); const data = new FormData(event.currentTarget);
            const isEnabled = !route.isEnabled;
            const confirmed = new FormData(event.currentTarget).get("confirmed") === "on";
            void submitMutation(route.id, { isEnabled, ...(isEnabled ? { confirmed } : {}), reason: data.get("reason") }, isEnabled ? "Route enabled." : "Route disabled.");
          }}>
            <label>Reason<input name="reason" minLength={12} maxLength={500} required placeholder={route.isEnabled ? "Reason for disabling" : "Reason for enabling"} /></label>
            {!route.isEnabled && <label className="payment-route-confirm"><input type="checkbox" name="confirmed" required /> Confirm enabling this route</label>}
            <button className="btn btn-sm" disabled={pending === route.id}>{pending === route.id ? "Saving…" : route.isEnabled ? "Disable route" : "Enable route"}</button>
          </form>
        </div>
        <details className="payment-route-history">
          <summary>Audit history ({route.history.length})</summary>
          {route.history.length ? <ol>{route.history.map((entry) => <li key={entry.id}>
            <strong>{entry.action.replaceAll("_", " ")}</strong> · {new Date(entry.createdAt).toLocaleString()} · {entry.operator}<br />
            {entry.reason}<br />
            <small>{entry.beforeState ? `${entry.beforeState.isEnabled ? "Enabled" : "Disabled"} / priority ${entry.beforeState.displayOrder} → ` : "Created disabled → "}{entry.afterState.isEnabled ? "Enabled" : "Disabled"} / priority {entry.afterState.displayOrder}</small>
          </li>)}</ol> : <p className="text-dim">No changes recorded for this route.</p>}
        </details>
      </li>)}
    </ul>}

    <details className="payment-route-create">
      <summary>Add Payment Route</summary>
      <form className="admin-form product-management-form" onSubmit={(event) => void create(event)}>
        <label>Market<select name="marketCode" defaultValue={selectedProvider?.markets[0] ?? ""} required>
          {selectedProvider?.markets.map((market) => <option key={market} value={market}>{market}</option>)}
        </select></label>
        <label>Provider<select name="providerCode" value={providerCode} onChange={(event) => setProviderCode(event.currentTarget.value)} required>
          {providers.map((provider) => <option key={provider.code} value={provider.code}>{provider.name}</option>)}
        </select></label>
        <label>External reference<input name="externalReference" required maxLength={255} autoComplete="off" /></label>
        <p className="text-dim">Use a provider reference identifier only. Never enter credentials or secret values here.</p>
        <label>Priority<input name="displayOrder" type="number" min="0" max="2147483647" step="1" defaultValue="0" required /></label>
        <label>Reason<input name="reason" minLength={12} maxLength={500} required /></label>
        <button className="btn btn-sm" disabled={pending === "create"}>{pending === "create" ? "Creating…" : "Create disabled route"}</button>
      </form>
    </details>
  </section>;
}

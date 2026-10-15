"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Promo = {
  id: string; partnerName: string; productName: string; durationDays: number; createdByOperator: string; creationReason: string;
  createdAt: string; expiresAt: string | null; maxRedemptions: number | null; revokedAt: string | null; revokedByOperator: string | null; revokeReason: string | null;
  redemptionCount: number; status: "active" | "expired" | "exhausted" | "revoked";
  redemptions: { id: string; email: string; organizationName: string; locationName: string; redeemedAt: string; requestedDurationDays: number; grantedDurationMs: number }[];
  events: { id: string; action: string; operator: string; reason: string; createdAt: string; beforeState: unknown; afterState: unknown }[];
};
function localDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function labelDate(value: string | null) { return value ? new Date(value).toLocaleString() : "Never"; }

export default function PromoCodeManagement({ promoCodes }: { promoCodes: Promo[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [oneTimeCode, setOneTimeCode] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>, url: string, method: string, payload: unknown, busyKey: string, reveal = false) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(busyKey); setError(""); setOneTimeCode("");
    try {
      const response = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})) as { code?: string };
      if (!response.ok) { setError(result.code ?? "The request could not be completed."); return; }
      if (reveal && typeof result.code === "string") setOneTimeCode(result.code);
      form.reset(); router.refresh();
    } catch { setError("Connection failed. Please verify the status before retrying."); }
    finally { setBusy(null); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const expiryText = String(values.get("expiresAt") ?? "");
    const expiresAt = expiryText ? new Date(expiryText).toISOString() : null;
    await submit(event, "/api/v2/admin/spaquatoria-promo-codes", "POST", {
      durationDays: Number(values.get("durationDays")), expiresAt,
      maxRedemptions: values.get("maxRedemptions") ? Number(values.get("maxRedemptions")) : null,
      reason: values.get("reason"),
    }, "create", true);
  }

  async function configure(event: FormEvent<HTMLFormElement>, promo: Promo) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const expiryText = String(values.get("expiresAt") ?? "");
    const expiresAt = expiryText ? new Date(expiryText).toISOString() : null;
    if (!window.confirm(`Save new settings for this code? Existing redemptions will remain unchanged.`)) { event.preventDefault(); return; }
    await submit(event, `/api/v2/admin/spaquatoria-promo-codes/${encodeURIComponent(promo.id)}`, "PATCH", {
      confirm: true, durationDays: Number(values.get("durationDays")), expiresAt,
      maxRedemptions: values.get("maxRedemptions") ? Number(values.get("maxRedemptions")) : null,
      reason: values.get("reason"),
    }, `configure-${promo.id}`);
  }

  async function revoke(event: FormEvent<HTMLFormElement>, promo: Promo) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!window.confirm("Revoke this code? Existing Partner Benefit access will remain unchanged.")) { event.preventDefault(); return; }
    await submit(event, `/api/v2/admin/spaquatoria-promo-codes/${encodeURIComponent(promo.id)}`, "DELETE", {
      confirm: true, reason: values.get("reason"),
    }, `revoke-${promo.id}`);
  }

  return <>
    {error && <p role="alert" className="partner-offer-feedback">{error}</p>}
    {oneTimeCode && <section className="admin-card" role="status"><h2 className="admin-card-title">Copy this Spaquatoria promo code now</h2><p>The raw code is shown once. It will not appear in history or after this page is refreshed.</p><input aria-label="Promo code" readOnly value={oneTimeCode} onFocus={(event) => event.currentTarget.select()} /></section>}
    <section className="admin-card"><h2 className="admin-card-title">Create promo code</h2><p className="text-dim">Grants finite Spaquatoria access only. It does not create a subscription or change Basic access.</p>
      <form className="partner-offer-create-form" onSubmit={(event) => void create(event)}>
        <label>Duration in days<input name="durationDays" type="number" min="1" max="365" step="1" required defaultValue="30" /></label>
        <label>Expires at (optional)<input name="expiresAt" type="datetime-local" /></label>
        <label>Maximum redemptions (optional)<input name="maxRedemptions" type="number" min="1" step="1" /></label>
        <label>Reason<input name="reason" required minLength={12} maxLength={500} /></label>
        <button className="btn btn-primary" disabled={busy === "create"}>{busy === "create" ? "Creating…" : "Create shared code"}</button>
      </form>
    </section>
    {!promoCodes.length && <section className="admin-card"><p className="text-dim">No Spaquatoria promo codes have been issued.</p></section>}
    {promoCodes.map((promo) => <section className="admin-card" key={promo.id}>
      <div className="partner-offer-heading"><div><h2 className="admin-card-title">{promo.productName} · {promo.durationDays} days</h2><p className="text-dim">{promo.id} · {promo.status.toUpperCase()} · {promo.redemptionCount}{promo.maxRedemptions === null ? "" : ` / ${promo.maxRedemptions}`} redemptions</p></div><span>Expires: {labelDate(promo.expiresAt)}</span></div>
      <p>{promo.creationReason} · Created by {promo.createdByOperator} at {labelDate(promo.createdAt)}</p>
      {promo.status !== "revoked" && <>
        <details><summary>Configure future redemptions</summary><form className="partner-offer-create-form" onSubmit={(event) => { void configure(event, promo); }}>
          <label>Duration in days<input name="durationDays" type="number" min="1" max="365" step="1" required defaultValue={promo.durationDays} /></label>
          <label>Expires at (optional)<input name="expiresAt" type="datetime-local" defaultValue={localDate(promo.expiresAt)} /></label>
          <label>Maximum redemptions (optional)<input name="maxRedemptions" type="number" min={Math.max(1, promo.redemptionCount)} step="1" defaultValue={promo.maxRedemptions ?? ""} /></label>
          <label>Reason<input name="reason" required minLength={12} maxLength={500} /></label>
          <button className="btn btn-sm" disabled={busy === `configure-${promo.id}`}>{busy === `configure-${promo.id}` ? "Saving…" : "Save configuration"}</button>
        </form></details>
        <form className="partner-offer-create-form" onSubmit={(event) => { void revoke(event, promo); }}>
          <label>Revocation reason<input name="reason" required minLength={12} maxLength={500} /></label>
          <button className="btn btn-danger" disabled={busy === `revoke-${promo.id}`}>{busy === `revoke-${promo.id}` ? "Revoking…" : "Revoke code"}</button>
        </form>
      </>}
      {promo.status === "revoked" && <p className="text-dim">Revoked by {promo.revokedByOperator} at {labelDate(promo.revokedAt)} · {promo.revokeReason}</p>}
      <details><summary>Redemption and audit history</summary>
        <h3>Redemptions</h3>{promo.redemptions.length ? <ul>{promo.redemptions.map((redemption) => <li key={redemption.id}>{redemption.organizationName} → {redemption.locationName} · {redemption.email} · {redemption.requestedDurationDays} days requested, {Math.round(redemption.grantedDurationMs / 86_400_000 * 100) / 100} days granted · {labelDate(redemption.redeemedAt)}</li>)}</ul> : <p className="text-dim">No redemptions.</p>}
        <h3>Operator audit</h3><ul>{promo.events.map((event) => <li key={event.id}>{event.action} · {event.operator} · {event.reason} · {labelDate(event.createdAt)}</li>)}</ul>
      </details>
    </section>)}
  </>;
}

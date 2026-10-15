"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type RegistrationLink = {
  id: string; policyKey: string; policyVersion: number; createdByOperator: string; creationReason: string;
  createdAt: string; expiresAt: string | null; maxRedemptions: number | null; disabledAt: string | null;
  disabledByOperator: string | null; disableReason: string | null; redeemedCount: number;
  status: "active" | "disabled" | "expired" | "exhausted";
  policySnapshot: { policyKey: string; products?: { productId: string; productName: string; productCode: string; durationMonths: number; accessType: string }[] };
  redemptions: { id: string; email: string; organizationId: string; organizationName: string; firstLocationId: string; firstLocationName: string; redeemedAt: string }[];
  events: { id: string; action: string; operator: string; reason: string; createdAt: string }[];
};

type ProductOption = { id: string; code: string; name: string };

export default function RegistrationLinksManagement({ links, products }: { links: RegistrationLink[]; products: ProductOption[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const selectedProducts = products.flatMap((product) => values.get(`product:${product.id}`) === "on"
      ? [{ productId: product.id, durationMonths: values.get(`duration:${product.id}`) }]
      : []);
    const normalizedProducts = selectedProducts.map((product) => ({ productId: product.productId, durationMonths: Number(product.durationMonths) }));
    if (!normalizedProducts.length || normalizedProducts.some((product) => !Number.isInteger(product.durationMonths) || product.durationMonths < 1 || product.durationMonths > 12)) { setError("Select at least one Product and a duration from 1 to 12 months."); return; }
    const expiryValue = values.get("expiresAt");
    const parsedExpiry = typeof expiryValue === "string" && expiryValue ? new Date(expiryValue) : null;
    if (parsedExpiry && !Number.isFinite(parsedExpiry.getTime())) { setError("Enter a valid expiration date."); return; }
    const expiresAt = parsedExpiry?.toISOString() ?? null;
    setPending(true); setError(""); setCreatedUrl("");
    try {
      const response = await fetch("/api/v2/admin/registration-links", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ products: normalizedProducts, reason: values.get("reason"), expiresAt, maxRedemptions: values.get("maxRedemptions") || null }) });
      const result = await response.json().catch(() => ({})) as { url?: string; code?: string };
      if (!response.ok || !result.url) { setError(result.code ?? "Creation failed."); return; }
      setCreatedUrl(result.url); form.reset(); router.refresh();
    } catch { setError("Connection failed. Please retry."); }
    finally { setPending(false); }
  }

  async function disable(link: RegistrationLink, form: HTMLFormElement) {
    const values = new FormData(form);
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/v2/admin/registration-links/${encodeURIComponent(link.id)}`, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: values.get("confirm") === "on", reason: values.get("reason") }) });
      const result = await response.json().catch(() => ({})) as { code?: string };
      if (!response.ok) { setError(result.code ?? "Disable failed."); return; }
      form.reset(); router.refresh();
    } catch { setError("Connection failed. Please retry."); }
    finally { setPending(false); }
  }

  return <>
    {error && <p role="alert">{error}</p>}
    {createdUrl && <section className="admin-card" role="status"><h2>Copy this Registration Link now</h2><p>The raw token is shown once and is not available after leaving or refreshing this page.</p><input aria-label="Registration Link" readOnly value={createdUrl} onFocus={(event) => event.currentTarget.select()} /></section>}
    <section className="admin-card"><h2 className="admin-card-title">Create Registration Link</h2><form className="partner-offer-create-form" onSubmit={(event) => void create(event)}>
      <fieldset><legend>Free access for the first Location</legend>{products.map((product) => <div key={product.id} className="admin-form-row">
        <label><input type="checkbox" name={`product:${product.id}`} defaultChecked={product.code === "soundspa"} /> {product.name}</label>
        <label>Duration (months)<input type="number" name={`duration:${product.id}`} min="1" max="12" step="1" defaultValue="1" /></label>
      </div>)}</fieldset>
      <label>Expires at (optional)<input type="datetime-local" name="expiresAt" /></label>
      <label>Maximum redemptions (optional)<input type="number" name="maxRedemptions" min="1" max="100000" step="1" /></label>
      <label>Creation reason<input required minLength={12} maxLength={500} name="reason" /></label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create link"}</button>
    </form></section>
    {!links.length && <section className="admin-card"><p className="text-dim">No Registration Links have been created.</p></section>}
    {links.map((link) => <section className="admin-card" key={link.id}>
      <div className="admin-page-header"><div><h2 className="admin-card-title">{link.policyKey === "divnitsa" ? "Divnitsa legacy" : "Registration Link"} · {link.status.toUpperCase()}</h2><p className="text-dim">Created {new Date(link.createdAt).toLocaleString()} by {link.createdByOperator} · {link.redeemedCount}{link.maxRedemptions === null ? "" : ` / ${link.maxRedemptions}`} redemptions</p></div>{link.expiresAt && <span>Expires {new Date(link.expiresAt).toLocaleString()}</span>}</div>
      {link.policyKey === "universal" && <ul>{(link.policySnapshot.products ?? []).map((product) => <li key={product.productId}>{product.productName} · {product.durationMonths} month{product.durationMonths === 1 ? "" : "s"}</li>)}</ul>}
      {link.policyKey === "divnitsa" && <p>SoundSpa Basic · 30 days; Divnitsa · 30 days (legacy policy)</p>}
      <p>{link.creationReason}</p>
      {link.status === "active" && <form className="partner-offer-create-form" onSubmit={(event) => { event.preventDefault(); void disable(link, event.currentTarget); }}>
        <label><input type="checkbox" name="confirm" required /> Disable this link for future redemptions</label>
        <label>Reason<input required minLength={12} maxLength={500} name="reason" /></label>
        <button className="btn btn-danger" disabled={pending}>{pending ? "Saving…" : "Disable link"}</button>
      </form>}
      <details><summary>Redemption and audit history</summary>
        <h3>Redemptions</h3>{link.redemptions.length ? <ul>{link.redemptions.map((redemption) => <li key={redemption.id}>{redemption.organizationName} · {redemption.firstLocationName} · {redemption.email} · {new Date(redemption.redeemedAt).toLocaleString()}</li>)}</ul> : <p className="text-dim">No redemptions.</p>}
        <h3>Operator events</h3><ul>{link.events.map((event) => <li key={event.id}>{event.action} · {event.operator} · {event.reason} · {new Date(event.createdAt).toLocaleString()}</li>)}</ul>
      </details>
    </section>)}
  </>;
}

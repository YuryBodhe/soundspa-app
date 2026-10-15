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
  const [copyFeedback, setCopyFeedback] = useState("");

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
      setCreatedUrl(result.url); setCopyFeedback(""); form.reset(); router.refresh();
    } catch { setError("Connection failed. Please retry."); }
    finally { setPending(false); }
  }

  async function copyCreatedLink() {
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopyFeedback("Link copied.");
    } catch {
      setCopyFeedback("Copy failed. Select the link text to copy it manually.");
    }
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

  return <div className="registration-links-page">
    {error && <p role="alert" className="registration-links-alert">{error}</p>}
    {createdUrl && <section className="admin-card registration-link-reveal" aria-labelledby="created-registration-link-title">
      <div><h2 id="created-registration-link-title" className="admin-card-title">Registration Link created</h2><p className="text-dim">The full link is shown once. Copy it now; it is not available after leaving or refreshing this page.</p></div>
      <div className="registration-link-copy-row"><input aria-label="Registration Link" readOnly value={createdUrl} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="btn btn-primary" onClick={() => void copyCreatedLink()}>Copy link</button></div>
      {copyFeedback && <p role="status" aria-live="polite" className="partner-offer-feedback">{copyFeedback}</p>}
    </section>}

    <section className="admin-card registration-link-create-card">
      <div className="registration-link-section-heading"><div><p className="registration-link-eyebrow">FIRST LOCATION ACCESS</p><h2 className="admin-card-title">Create Registration Link</h2></div><p className="text-dim">Choose products and set each duration independently.</p></div>
      <form className="registration-link-create-form" onSubmit={(event) => void create(event)}>
        <fieldset className="registration-product-fieldset">
          <legend>Products and free-access duration</legend>
          <div className="registration-product-grid">{products.map((product) => {
            const checkboxId = `registration-product-${product.id}`;
            return <article className="registration-product-card" key={product.id}>
              <div className="registration-product-card-heading">
                <input id={checkboxId} type="checkbox" name={`product:${product.id}`} defaultChecked={product.code === "soundspa"} />
                <label htmlFor={checkboxId}>{product.name}</label>
              </div>
              <label className="registration-duration-label" htmlFor={`registration-duration-${product.id}`}>Duration <span>calendar months</span></label>
              <input id={`registration-duration-${product.id}`} className="registration-duration-input" type="number" name={`duration:${product.id}`} min="1" max="12" step="1" defaultValue="1" aria-label={`${product.name} duration in calendar months`} />
            </article>;
          })}</div>
        </fieldset>

        <fieldset className="registration-link-settings">
          <legend>Link settings</legend>
          <div className="registration-link-settings-grid">
            <label htmlFor="registration-link-expires">Expiration <span>optional</span><input id="registration-link-expires" type="datetime-local" name="expiresAt" /></label>
            <label htmlFor="registration-link-limit">Maximum redemptions <span>optional</span><input id="registration-link-limit" type="number" name="maxRedemptions" min="1" max="100000" step="1" /></label>
            <label className="registration-link-reason" htmlFor="registration-link-reason">Creation reason<input id="registration-link-reason" required minLength={12} maxLength={500} name="reason" /></label>
          </div>
        </fieldset>
        <div className="registration-link-submit-row"><p className="text-dim">A blank expiration means the link does not expire.</p><button className="btn btn-primary registration-link-create-button" disabled={pending}>{pending ? "Creating…" : "Create link"}</button></div>
      </form>
    </section>

    <section className="registration-link-list" aria-labelledby="registration-link-list-title">
      <div className="registration-link-list-heading"><div><p className="registration-link-eyebrow">ISSUED LINKS</p><h2 id="registration-link-list-title">Registration Links</h2></div><span className="text-dim">{links.length} total</span></div>
      {!links.length && <section className="admin-card registration-link-empty"><p className="text-dim">No Registration Links have been created.</p></section>}
      {links.map((link) => <article className="admin-card registration-link-card" key={link.id}>
        <div className="registration-link-card-header">
          <div className="registration-link-title-row"><h3>{link.policyKey === "divnitsa" ? "Divnitsa legacy link" : "Universal Registration Link"}</h3><span className={`registration-link-status registration-link-status-${link.status}`}>{link.status}</span></div>
          <p className="registration-link-meta">Created {new Date(link.createdAt).toLocaleString()} <span aria-hidden="true">·</span> {link.createdByOperator}</p>
        </div>
        <div className="registration-link-summary-grid">
          <div><span className="registration-link-meta-label">Products</span>
            {link.policyKey === "universal" ? <ul className="registration-link-products">{(link.policySnapshot.products ?? []).map((product) => <li key={product.productId}>{product.productName}<span>{product.durationMonths} month{product.durationMonths === 1 ? "" : "s"}</span></li>)}</ul> : <p className="registration-link-legacy-products">SoundSpa Basic · 30 days <span>Divnitsa · 30 days</span></p>}
          </div>
          <div><span className="registration-link-meta-label">Redemptions</span><strong>{link.redeemedCount}{link.maxRedemptions === null ? "" : ` / ${link.maxRedemptions}`}</strong></div>
          <div><span className="registration-link-meta-label">Expires</span><strong>{link.expiresAt ? new Date(link.expiresAt).toLocaleString() : "Never"}</strong></div>
          <div className="registration-link-reason-summary"><span className="registration-link-meta-label">Reason</span><p>{link.creationReason}</p></div>
        </div>
        <div className="registration-link-actions">
          {link.status === "active" && <details className="registration-link-action-disclosure"><summary>Revoke link</summary>
            <form className="registration-link-revoke-form" onSubmit={(event) => { event.preventDefault(); void disable(link, event.currentTarget); }}>
              <label className="registration-link-confirm"><input type="checkbox" name="confirm" required /> Disable future redemptions</label>
              <label>Reason<input required minLength={12} maxLength={500} name="reason" /></label>
              <button className="btn btn-danger" disabled={pending}>{pending ? "Saving…" : "Disable link"}</button>
            </form>
          </details>}
          <details className="registration-link-action-disclosure"><summary>Redemption &amp; audit history</summary>
            <div className="registration-link-history">
              <section><h4>Redemptions</h4>{link.redemptions.length ? <ul>{link.redemptions.map((redemption) => <li key={redemption.id}>{redemption.organizationName} · {redemption.firstLocationName} · {redemption.email} · {new Date(redemption.redeemedAt).toLocaleString()}</li>)}</ul> : <p className="text-dim">No redemptions.</p>}</section>
              <section><h4>Operator events</h4>{link.events.length ? <ul>{link.events.map((event) => <li key={event.id}>{event.action} · {event.operator} · {event.reason} · {new Date(event.createdAt).toLocaleString()}</li>)}</ul> : <p className="text-dim">No operator events.</p>}</section>
            </div>
          </details>
        </div>
      </article>)}
    </section>
  </div>;
}

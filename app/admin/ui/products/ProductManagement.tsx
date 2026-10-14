"use client";

import { FormEvent, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { productVisibilityConfirmationReducer, type VisibilityConfirmationState } from "./visibilityConfirmation";

type Channel = { id: string; name: string; kind: "music" | "ambient"; isPublished: boolean; isArchived: boolean };
type Visibility = "public" | "private" | "disabled";
type Product = { id: string; code: string; name: string; kind: "core" | "partner" | "addon"; isActive: boolean; visibility: Visibility; visibilityHistory: Array<{ previousVisibility: Visibility; newVisibility: Visibility; operator: string; reason: string; changedAt: Date | string }>; channelIds: string[]; channels: Array<{ id: string; name: string; kind: "music" | "ambient" }> };

function selectedChannels(form: HTMLFormElement): string[] {
  return new FormData(form).getAll("channelIds").filter((value): value is string => typeof value === "string");
}

export default function ProductManagement({ products, channels }: { products: Product[]; channels: Channel[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(key: string, url: string, method: "POST" | "PATCH", body: unknown, successMessage = "Product saved.") {
    setPending(key); setError(null); setMessage(null);
    try {
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message ?? "The Product could not be saved."); return false; }
      setMessage(successMessage); router.refresh(); return true;
    } catch { setError("Connection failed. Please retry."); return false; }
    finally { setPending(null); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await save("create", "/api/v2/admin/products", "POST", {
      name: data.get("name"), code: data.get("code"), kind: data.get("kind"),
      isActive: data.get("isActive") === "on", channelIds: selectedChannels(form),
    });
    if (created) form.reset();
  }

  async function update(event: FormEvent<HTMLFormElement>, product: Product) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await save(product.id, `/api/v2/admin/products/${encodeURIComponent(product.id)}`, "PATCH", {
      name: data.get("name"), isActive: data.get("isActive") === "on", channelIds: selectedChannels(form),
    });
  }

  async function updateVisibility(product: Product, visibility: Visibility, reason: string) {
    if (visibility === product.visibility) {
      setError(null); setMessage("Visibility is unchanged."); return true;
    }
    return save(`visibility-${product.id}`, `/api/v2/admin/products/${encodeURIComponent(product.id)}/visibility`, "PATCH", {
      visibility, reason, confirmed: true,
    }, "Product visibility updated.");
  }

  const channelOptions = (selected: string[]) => channels.map((channel) => <label className="product-channel-option" key={channel.id}>
    <input type="checkbox" name="channelIds" value={channel.id} defaultChecked={selected.includes(channel.id)} />
    <span>{channel.name}</span><span className="badge badge-neutral">{channel.kind}</span>
    {!channel.isPublished && <span className="badge badge-warn">unpublished</span>}
    {channel.isArchived && <span className="badge badge-neutral">archived</span>}
  </label>);

  return <>
    {error && <p role="alert" className="partner-offer-feedback">{error}</p>}
    {message && <p role="status" className="partner-offer-feedback partner-offer-success">{message}</p>}
    <section className="admin-card product-create-card">
      <h2 className="admin-card-title">Create Product</h2>
      <form className="admin-form product-management-form" onSubmit={(event) => void create(event)}>
        <label>Product name<input name="name" required maxLength={160} /></label>
        <label>Product code<input name="code" required maxLength={80} pattern="[A-Za-z0-9_-]+(\s+[A-Za-z0-9_-]+)*" autoCapitalize="none" /></label>
        <p className="text-dim">Code is normalized to lowercase with hyphens and cannot be changed after creation.</p>
        <label>Product kind<select name="kind" defaultValue="core"><option value="core">Core</option><option value="partner">Partner</option><option value="addon">Add-on</option></select></label>
        <label className="product-active-option"><input type="checkbox" name="isActive" defaultChecked /> Active Product</label>
        <fieldset className="product-channel-fieldset"><legend>Channel composition</legend>{channels.length ? channelOptions([]) : <p className="text-dim">No Channels exist yet.</p>}</fieldset>
        <button className="btn btn-primary" disabled={pending === "create"}>{pending === "create" ? "Creating…" : "Create Product"}</button>
      </form>
    </section>

    <section className="product-management-list" aria-label="Products">
      {!products.length && <section className="admin-card"><p className="text-dim">No Products configured.</p></section>}
      {products.map((product) => <details className="admin-card product-management-card" key={product.id}>
        <summary className="product-management-summary">
          <span><strong>{product.name}</strong><small>{product.code} · {product.kind}</small></span>
          <span className={`badge ${product.isActive ? "badge-ok" : "badge-neutral"}`}>{product.isActive ? "ACTIVE" : "INACTIVE"}</span>
          <span className="badge badge-neutral">{product.visibility.toUpperCase()}</span>
        </summary>
        <div className="product-management-content">
          <p><strong>Channels:</strong> {product.channels.length ? product.channels.map((channel) => channel.name).join(", ") : "None"}</p>
          <section className="product-visibility-management" aria-label={`${product.name} purchase visibility`}>
            <h3>Purchase visibility</h3>
            <p className="text-dim">Visibility controls new purchases only. It does not revoke existing trials, subscriptions, Partner Benefits, grants, or pending checkouts.</p>
            <ProductVisibilityEditor
              key={`${product.id}-${product.visibility}`}
              product={product}
              pending={pending === `visibility-${product.id}`}
              onSave={updateVisibility}
            />
            {product.visibilityHistory.length > 0 && <details className="product-visibility-history">
              <summary>Visibility change history</summary>
              <ul>{[...product.visibilityHistory].reverse().map((event, index) => <li key={`${event.changedAt}-${index}`}>
                {event.previousVisibility} → {event.newVisibility} · {new Date(event.changedAt).toLocaleString()} · {event.operator}<br />{event.reason}
              </li>)}</ul>
            </details>}
            <ProductAuthorizationManagement productId={product.id} productName={product.name} />
          </section>
          <form className="admin-form product-management-form" onSubmit={(event) => void update(event, product)}>
            <label>Product code<input value={product.code} readOnly aria-readonly="true" /></label>
            <label>Product kind<input value={product.kind} readOnly aria-readonly="true" /></label>
            <label>Product name<input name="name" required maxLength={160} defaultValue={product.name} /></label>
            <label className="product-active-option"><input type="checkbox" name="isActive" defaultChecked={product.isActive} /> Active Product</label>
            <fieldset className="product-channel-fieldset"><legend>Channel composition</legend>{channelOptions(product.channelIds)}</fieldset>
            <button className="btn btn-primary" disabled={pending === product.id}>{pending === product.id ? "Saving…" : "Save Product"}</button>
          </form>
        </div>
      </details>)}
    </section>
  </>;
}

function ProductVisibilityEditor({ product, pending, onSave }: {
  product: Product;
  pending: boolean;
  onSave: (product: Product, visibility: Visibility, reason: string) => Promise<boolean>;
}) {
  const [confirmation, dispatch] = useReducer(productVisibilityConfirmationReducer, {
    selectedVisibility: product.visibility,
    confirmedVisibility: null,
  } satisfies VisibilityConfirmationState);
  const [reason, setReason] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation.confirmedVisibility !== confirmation.selectedVisibility) return;
    const form = event.currentTarget;
    const saved = await onSave(product, confirmation.selectedVisibility, reason);
    if (saved) {
      dispatch({ type: "saved" });
      setReason("");
      form.reset();
    }
  }

  return <form className="admin-form product-management-form" onSubmit={(event) => void submit(event)}>
    <label>Visibility
      <select name="visibility" value={confirmation.selectedVisibility}
        onChange={(event) => dispatch({ type: "select", visibility: event.target.value as Visibility })}>
        <option value="public">Public — eligible Organizations may purchase</option>
        <option value="private">Private — only authorized Organizations may purchase</option>
        <option value="disabled">Disabled — no new purchases</option>
      </select>
    </label>
    <label>Reason for change<input name="reason" required minLength={12} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <label className="product-active-option"><input type="checkbox" name="confirmed" required
      checked={confirmation.confirmedVisibility === confirmation.selectedVisibility}
      onChange={(event) => dispatch({ type: "confirm", confirmed: event.target.checked })} /> I confirm this changes new-purchase visibility only.</label>
    <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save visibility"}</button>
  </form>;
}

type OrganizationOption = { id: string; name: string; archived: boolean };
type AuthorizationRecord = {
  id: string; organizationId: string; organizationName: string; grantedAt: string; grantedByOperator: string; grantReason: string;
  revokedAt: string | null; revokedByOperator: string | null; revokeReason: string | null; status: "active" | "revoked";
};

function ProductAuthorizationManagement({ productId, productName }: { productId: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [authorizations, setAuthorizations] = useState<AuthorizationRecord[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/v2/admin/products/${encodeURIComponent(productId)}/authorizations`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => ({})) as { message?: string; organizations?: OrganizationOption[]; authorizations?: AuthorizationRecord[] };
      if (!response.ok) throw new Error(result.message ?? "Authorization history could not be loaded.");
      setOrganizations(result.organizations ?? []); setAuthorizations(result.authorizations ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Authorization history could not be loaded."); }
    finally { setBusy(false); }
  }

  async function submitGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setMessage(null); setBusy(true);
    const form = event.currentTarget; const data = new FormData(form);
    try {
      const response = await fetch(`/api/v2/admin/products/${encodeURIComponent(productId)}/authorizations`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ organizationId: data.get("organizationId"), reason: data.get("grantReason") }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Purchase authorization could not be granted.");
      setMessage("Purchase authorization granted."); setOrganizationId(""); form.reset(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Purchase authorization could not be granted."); }
    finally { setBusy(false); }
  }

  async function revoke(event: FormEvent<HTMLFormElement>, authorization: AuthorizationRecord) {
    event.preventDefault(); setError(null); setMessage(null);
    if (!window.confirm(`Revoke ${productName} purchase authorization for ${authorization.organizationName}? Existing access and pending checkouts are not affected.`)) return;
    const data = new FormData(event.currentTarget); setBusy(true);
    try {
      const response = await fetch(`/api/v2/admin/products/${encodeURIComponent(productId)}/authorizations/${encodeURIComponent(authorization.id)}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ reason: data.get("revokeReason"), confirmed: true }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Purchase authorization could not be revoked.");
      setMessage("Purchase authorization revoked."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Purchase authorization could not be revoked."); }
    finally { setBusy(false); }
  }

  const activeOrganizationIds = new Set(authorizations.filter((record) => record.status === "active").map((record) => record.organizationId));
  return <details className="product-authorization-management" onToggle={(event) => {
    const nextOpen = event.currentTarget.open; setOpen(nextOpen); if (nextOpen && !organizations.length && !authorizations.length) void refresh();
  }}>
    <summary>Organization purchase authorizations</summary>
    <div className="product-authorization-content">
      <p className="text-dim">Grants allow new purchases while this Product is private. Revoking a grant preserves existing access and pending checkouts.</p>
      {error && <p role="alert" className="partner-offer-feedback">{error}</p>}
      {message && <p role="status" className="partner-offer-feedback partner-offer-success">{message}</p>}
      {busy && <p role="status">Loading or saving…</p>}
      {!busy && open && <>
        <form className="admin-form product-management-form" onSubmit={(event) => void submitGrant(event)}>
          <label>Organization
            <select name="organizationId" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required>
              <option value="">Select Organization</option>
              {organizations.filter((organization) => !organization.archived && !activeOrganizationIds.has(organization.id)).map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
            </select>
          </label>
          <label>Grant reason<input name="grantReason" required minLength={12} maxLength={500} /></label>
          <button className="btn btn-primary" disabled={!organizationId || busy}>Grant purchase access</button>
        </form>
        <h4>Grant and revocation history</h4>
        {!authorizations.length && <p className="text-dim">No Organizations have been authorized.</p>}
        <ul className="product-authorization-history">{authorizations.map((record) => <li key={record.id}>
          <strong>{record.organizationName}</strong> · {record.status === "active" ? "Active" : "Revoked"}<br />
          Granted {new Date(record.grantedAt).toLocaleString()} by {record.grantedByOperator}: {record.grantReason}
          {record.revokedAt && <><br />Revoked {new Date(record.revokedAt).toLocaleString()} by {record.revokedByOperator}: {record.revokeReason}</>}
          {record.status === "active" && <form className="admin-form product-management-form" onSubmit={(event) => void revoke(event, record)}>
            <label>Revocation reason<input name="revokeReason" required minLength={12} maxLength={500} /></label>
            <button className="btn btn-sm" disabled={busy}>Revoke authorization</button>
          </form>}
        </li>)}</ul>
      </>}
      {open && !busy && <button type="button" className="btn btn-sm" onClick={() => void refresh()}>Refresh authorizations</button>}
    </div>
  </details>;
}

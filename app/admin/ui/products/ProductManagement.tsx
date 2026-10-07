"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Channel = { id: string; name: string; kind: "music" | "ambient"; isPublished: boolean; isArchived: boolean };
type Product = { id: string; code: string; name: string; kind: "core" | "partner" | "addon"; isActive: boolean; channelIds: string[]; channels: Array<{ id: string; name: string; kind: "music" | "ambient" }> };

function selectedChannels(form: HTMLFormElement): string[] {
  return new FormData(form).getAll("channelIds").filter((value): value is string => typeof value === "string");
}

export default function ProductManagement({ products, channels }: { products: Product[]; channels: Channel[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(key: string, url: string, method: "POST" | "PATCH", body: unknown) {
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
      setMessage("Product saved."); router.refresh(); return true;
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
        </summary>
        <div className="product-management-content">
          <p><strong>Channels:</strong> {product.channels.length ? product.channels.map((channel) => channel.name).join(", ") : "None"}</p>
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

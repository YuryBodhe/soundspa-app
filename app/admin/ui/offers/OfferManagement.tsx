"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import InviteManagement from "./InviteManagement";

type Product = { id: string; code: string; name: string; kind: string; isActive: boolean };
type Grant = { id: string; productId: string; productName: string; productKind: string; productActive: boolean; grantType: "partner_benefit" | "trial"; durationDays: number | null };
type InviteClaim = { locationId: string; organizationName: string; locationName: string; locationSlug: string; claimedAt: string };
type Invite = { id: string; createdAt: string; expiresAt: string | null; maxClaims: number | null; claimCount: number; status: "ACTIVE" | "EXPIRED" | "EXHAUSTED" | "REVOKED"; claims: InviteClaim[] };
type Offer = { id: string; code: string; name: string; isActive: boolean; inviteCount: number; grantsLocked: boolean; grants: Grant[]; invites: Invite[] };
type Partner = { id: string; name: string; code: string; isActive: boolean; offers: Offer[] };
type ClaimLocation = { id: string; organizationName: string; locationName: string; locationSlug: string };

export default function OfferManagement({ partners, products, claimLocations }: { partners: Partner[]; products: Product[]; claimLocations: ClaimLocation[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function mutate(key: string, url: string, method: string, body: unknown) {
    setPending(key); setError(null); setMessage(null);
    try {
      const response = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message ?? "The change could not be saved."); return false; }
      setMessage("Saved."); router.refresh(); return true;
    } catch { setError("Connection failed. Please retry."); return false; }
    finally { setPending(null); }
  }

  async function createOffer(event: FormEvent<HTMLFormElement>, partnerId: string) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const created = await mutate(`offer-${partnerId}`, "/api/v2/admin/partner-offers", "POST", { partnerId, code: form.get("code"), name: form.get("name") });
    if (created) target.reset();
  }

  async function addGrant(event: FormEvent<HTMLFormElement>, offerId: string) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const result = await mutate(`grant-${offerId}`, `/api/v2/admin/partner-offers/${encodeURIComponent(offerId)}/grants`, "POST", {
      productId: form.get("productId"), grantType: form.get("grantType"), durationDays: form.get("durationDays"),
    });
    if (result) target.reset();
  }

  return <>
    {error && <p className="partner-offer-feedback" role="alert">{error}</p>}
    {message && <p className="partner-offer-feedback partner-offer-success" role="status">{message}</p>}
    {!partners.length && <section className="admin-card"><p className="text-dim">No Partners are configured yet.</p></section>}
    {partners.map((partner) => <section className="admin-card" key={partner.id}>
      <div className="partner-offer-heading"><div><h2 className="admin-card-title">{partner.name}</h2><span className="text-dim">{partner.code}</span></div><span className={`badge ${partner.isActive ? "badge-ok" : "badge-neutral"}`}>{partner.isActive ? "ACTIVE" : "INACTIVE PARTNER"}</span></div>
      {!partner.offers.length && <p className="text-dim">No Offers under this Partner yet.</p>}
      {partner.offers.map((offer) => <details className="partner-offer-details" key={offer.id}>
        <summary><span>{offer.name} <span className="text-dim">({offer.code})</span></span><span className={`badge ${offer.isActive ? "badge-ok" : "badge-neutral"}`}>{offer.isActive ? "ACTIVE" : "INACTIVE"}</span></summary>
        <div className="partner-offer-content">
          <div className="partner-offer-heading"><span className="text-dim">{offer.inviteCount} issued Invite{offer.inviteCount === 1 ? "" : "s"}</span>
            <button className="btn btn-sm" disabled={pending === `active-${offer.id}`} onClick={() => void mutate(`active-${offer.id}`, `/api/v2/admin/partner-offers/${encodeURIComponent(offer.id)}`, "PATCH", { isActive: !offer.isActive })}>
              {pending === `active-${offer.id}` ? "Saving…" : offer.isActive ? "Deactivate Offer" : "Activate Offer"}
            </button>
          </div>
          <h3 className="partner-offer-subtitle">Product grants</h3>
          {!offer.grants.length && <p className="text-dim">No grants configured.</p>}
          {offer.grants.length > 0 && <ul className="partner-offer-grants">{offer.grants.map((grant) => <li key={grant.id}>
            <span><strong>{grant.productName}</strong>{!grant.productActive && <span className="badge badge-warn">PRODUCT INACTIVE</span>}<small>{grant.grantType === "partner_benefit" ? "Partner benefit" : "Trial"} · {grant.durationDays === null ? "Permanent" : `${grant.durationDays} days`}</small></span>
            {!offer.grantsLocked && <button className="btn btn-sm btn-danger" disabled={pending === `remove-${grant.id}`} onClick={() => void mutate(`remove-${grant.id}`, `/api/v2/admin/partner-offers/${encodeURIComponent(offer.id)}/grants/${encodeURIComponent(grant.id)}`, "DELETE", undefined)}>{pending === `remove-${grant.id}` ? "Removing…" : "Remove"}</button>}
          </li>)}</ul>}
          {offer.grantsLocked ? <p className="partner-offer-lock-note">Grants are locked because this Offer has issued Invites. Create a new Offer to change its composition.</p> : <form className="partner-offer-grant-form" onSubmit={(event) => void addGrant(event, offer.id)}>
            <label>Product<select name="productId" required defaultValue=""><option value="" disabled>Select Product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.isActive ? "" : " (inactive)"}</option>)}</select></label>
            <label>Grant type<select name="grantType" defaultValue="partner_benefit"><option value="partner_benefit">Partner benefit</option><option value="trial">Trial</option></select></label>
            <label>Duration in days<input name="durationDays" type="number" min="1" step="1" placeholder="Blank = permanent benefit" /></label>
            <button className="btn btn-primary" disabled={pending === `grant-${offer.id}` || products.length === 0}>{pending === `grant-${offer.id}` ? "Adding…" : "Add grant"}</button>
            <p className="text-dim">A Trial requires a positive number of days. A Partner benefit may be permanent or time-limited.</p>
          </form>}
          <InviteManagement offerId={offer.id} offerActive={offer.isActive} partnerActive={partner.isActive} grants={offer.grants.map(({ productId, productName, productActive }) => ({ productId, productName, productActive }))} invites={offer.invites} claimLocations={claimLocations} />
        </div>
      </details>)}
      <form className="partner-offer-create-form" onSubmit={(event) => void createOffer(event, partner.id)}>
        <h3 className="partner-offer-subtitle">Create Offer</h3>
        <label>Offer name<input name="name" required maxLength={200} /></label>
        <label>Offer code<input name="code" required maxLength={120} /></label>
        <button className="btn btn-primary" disabled={pending === `offer-${partner.id}`}>{pending === `offer-${partner.id}` ? "Creating…" : "Create Offer"}</button>
      </form>
    </section>)}
  </>;
}

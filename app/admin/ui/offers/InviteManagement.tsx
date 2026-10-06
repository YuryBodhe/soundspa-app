"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Invite = { id: string; createdAt: string; expiresAt: string | null; maxClaims: number | null; claimCount: number; status: "ACTIVE" | "EXPIRED" | "EXHAUSTED" | "REVOKED" };

function formatTimestamp(value: string) {
  return `${value.replace("T", " ").replace(/(?:\.\d{3})?Z$/, " UTC")}`;
}

export default function InviteManagement({ offerId, offerActive, partnerActive, grants, invites }: {
  offerId: string;
  offerActive: boolean;
  partnerActive: boolean;
  grants: { productActive: boolean }[];
  invites: Invite[];
}) {
  const router = useRouter();
  const [unlimited, setUnlimited] = useState(true);
  const [neverExpires, setNeverExpires] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ inviteId: string; token: string } | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const inactiveGrant = grants.some((grant) => !grant.productActive);
  const eligibilityMessage = !offerActive ? "Activate this Offer before issuing an Invite."
    : !partnerActive ? "Activate this Partner before issuing an Invite."
      : !grants.length ? "Add at least one Product grant before issuing an Invite."
        : inactiveGrant ? "All Products in the Offer grants must be active before issuing an Invite."
          : null;

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    setPending("create"); setError(null); setCopyMessage(null);
    try {
      const expiryInput = String(form.get("expiresAt") ?? "");
      let expiresAt: string | null = null;
      if (!neverExpires) {
        const parsed = new Date(expiryInput);
        if (!expiryInput || Number.isNaN(parsed.getTime())) { setError("Choose a valid future expiry date and time."); return; }
        expiresAt = parsed.toISOString();
      }
      const maxClaims = unlimited ? null : Number(form.get("maxClaims"));
      const response = await fetch(`/api/v2/admin/partner-offers/${encodeURIComponent(offerId)}/invites`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ maxClaims, expiresAt }),
      });
      const result = await response.json().catch(() => ({})) as { token?: unknown; invite?: { id?: unknown }; message?: string };
      if (!response.ok || typeof result.token !== "string" || typeof result.invite?.id !== "string") {
        setError(result.message ?? "Invite could not be created.");
        return;
      }
      setReveal({ inviteId: result.invite.id, token: result.token });
      setCopyMessage(null);
      target.reset();
      setUnlimited(true);
      setNeverExpires(true);
      router.refresh();
    } catch {
      setError("Connection failed. Please retry.");
    } finally {
      setPending(null);
    }
  }

  async function revoke(inviteId: string) {
    setPending(inviteId); setError(null);
    try {
      const response = await fetch(`/api/v2/admin/partner-invites/${encodeURIComponent(inviteId)}`, { method: "DELETE", credentials: "same-origin", headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(result.message ?? "Invite could not be revoked."); return; }
      router.refresh();
    } catch { setError("Connection failed. Please retry."); }
    finally { setPending(null); }
  }

  async function copyToken() {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.token);
      setCopyMessage("Token copied. Store it securely; it will not be shown again.");
    } catch {
      setCopyMessage("Copy is unavailable here. Select and copy the token now; it will not be shown again.");
    }
  }

  return <section className="partner-invite-section">
    <h3 className="partner-offer-subtitle">Invites</h3>
    {error && <p className="partner-offer-feedback" role="alert">{error}</p>}
    {reveal && <div className="partner-invite-reveal" role="status">
      <strong>Invite created</strong>
      <p>Copy this token now. It will not be shown again.</p>
      <code className="partner-invite-token">{reveal.token}</code>
      <button type="button" className="btn btn-sm" onClick={() => void copyToken()}>Copy token</button>
      {copyMessage && <p className="text-dim" aria-live="polite">{copyMessage}</p>}
    </div>}
    {!invites.length && <p className="text-dim">No Invites issued.</p>}
    {!!invites.length && <div className="partner-invite-list">{invites.map((invite) => <article className="partner-invite-row" key={invite.id}>
      <div className="partner-invite-heading"><span className={`badge ${invite.status === "ACTIVE" ? "badge-ok" : invite.status === "EXHAUSTED" ? "badge-warn" : "badge-neutral"}`}>{invite.status}</span>
        <span className="text-dim">Created: {formatTimestamp(invite.createdAt)}</span></div>
      <span>Claims: {invite.claimCount} / {invite.maxClaims === null ? "Unlimited" : invite.maxClaims}</span>
      <span className="text-dim">Expires: {invite.expiresAt ? formatTimestamp(invite.expiresAt) : "Never"}</span>
      {invite.status === "ACTIVE" && <button className="btn btn-sm btn-danger" disabled={pending === invite.id} onClick={() => void revoke(invite.id)}>{pending === invite.id ? "Revoking…" : "Revoke"}</button>}
    </article>)}</div>}
    {eligibilityMessage ? <p className="partner-offer-lock-note">{eligibilityMessage}</p> : <form className="partner-invite-create-form" onSubmit={(event) => void createInvite(event)}>
      <label className="partner-invite-toggle"><input type="checkbox" checked={unlimited} onChange={(event) => setUnlimited(event.target.checked)} /> Unlimited claims</label>
      {!unlimited && <label>Maximum claims<input name="maxClaims" type="number" min="1" step="1" required /></label>}
      <label className="partner-invite-toggle"><input type="checkbox" checked={neverExpires} onChange={(event) => setNeverExpires(event.target.checked)} /> No expiry</label>
      {!neverExpires && <label>Expiry date/time<input name="expiresAt" type="datetime-local" required /></label>}
      <button className="btn btn-primary" disabled={pending === "create"}>{pending === "create" ? "Creating…" : "Create Invite"}</button>
    </form>}
  </section>;
}

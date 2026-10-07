"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ClaimHistory = { locationId: string; organizationName: string; locationName: string; locationSlug: string; claimedAt: string };
type Invite = { id: string; createdAt: string; expiresAt: string | null; maxClaims: number | null; claimCount: number; status: "ACTIVE" | "EXPIRED" | "EXHAUSTED" | "REVOKED"; claims: ClaimHistory[] };
type ClaimLocation = { id: string; organizationName: string; locationName: string; locationSlug: string };
type Grant = { productId: string; productName: string; productActive: boolean };
type ClaimResult = { status: "claimed" | "already_claimed"; benefits: { productId: string; endsAt: string | null }[]; trials: { productId: string; result: "created" | "skipped_active" | "skipped_already_used" | "skipped_paid_access" }[] };

function formatTimestamp(value: string) {
  return `${value.replace("T", " ").replace(/(?:\.\d{3})?Z$/, " UTC")}`;
}

export default function InviteManagement({ offerId, offerActive, partnerActive, grants, invites, claimLocations }: {
  offerId: string;
  offerActive: boolean;
  partnerActive: boolean;
  grants: Grant[];
  invites: Invite[];
  claimLocations: ClaimLocation[];
}) {
  const router = useRouter();
  const [unlimited, setUnlimited] = useState(true);
  const [neverExpires, setNeverExpires] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ inviteId: string; token: string } | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [selectedLocations, setSelectedLocations] = useState<Record<string, string>>({});
  const [claimResult, setClaimResult] = useState<{ inviteId: string; locationId: string; result: ClaimResult } | null>(null);

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

  async function claim(invite: Invite) {
    const locationId = selectedLocations[invite.id];
    const location = claimLocations.find((item) => item.id === locationId);
    if (!location) { setError("Select a Location first."); return; }
    const alreadyClaimedHere = invite.claims.some((item) => item.locationId === locationId);
    if (invite.status !== "ACTIVE" && !alreadyClaimedHere) { setError("This Invite can only be retried for a Location that has already claimed it."); return; }
    const locationLabel = `${location.organizationName} → ${location.locationName}`;
    if (!window.confirm(`Claim this Invite for:\n${locationLabel}\n\nThis may create real Partner Benefit or Trial access for this Location.`)) return;

    setPending(`claim-${invite.id}`); setError(null); setClaimResult(null);
    try {
      const response = await fetch(`/api/v2/admin/partner-invites/${encodeURIComponent(invite.id)}/claim`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ locationId }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string; result?: ClaimResult };
      if (!response.ok || !payload.result || !["claimed", "already_claimed"].includes(payload.result.status)) {
        setError(payload.message ?? "Invite claim failed.");
        return;
      }
      setClaimResult({ inviteId: invite.id, locationId, result: payload.result });
      router.refresh();
    } catch {
      setError("Connection failed. Please verify the claim status before retrying.");
    } finally {
      setPending(null);
    }
  }

  function describeClaimResult(result: ClaimResult) {
    if (result.status === "already_claimed") return "Already claimed for this Location; no additional grants were applied.";
    const benefitText = result.benefits.map((benefit) => {
      const grant = grants.find((item) => item.productId === benefit.productId);
      return `${grant?.productName ?? "Partner Benefit"} (${benefit.endsAt === null ? "permanent" : `through ${formatTimestamp(benefit.endsAt)}`})`;
    });
    const trialText = result.trials.map((trial) => {
      const grant = grants.find((item) => item.productId === trial.productId);
      const outcome = trial.result.replaceAll("_", " ");
      return `${grant?.productName ?? "Trial"} (${outcome})`;
    });
    const parts = [benefitText.length ? `Benefits: ${benefitText.join(", ")}` : "No Partner Benefits applied", trialText.length ? `Trials: ${trialText.join(", ")}` : "No Trials applied"];
    return `Claim completed. ${parts.join("; ")}.`;
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
      {invite.claims.length === 0 ? <p className="partner-invite-claims-empty">No claims yet.</p> : <div className="partner-invite-claims"><strong>Claim history</strong>{invite.claims.map((claim, index) => <p key={`${claim.locationSlug}-${claim.claimedAt}-${index}`}><span>{claim.organizationName} → {claim.locationName}</span><small>{claim.locationSlug} · {formatTimestamp(claim.claimedAt)}</small></p>)}</div>}
      {(invite.status === "ACTIVE" || invite.claims.length > 0) && <div className="partner-invite-claim-action">
        {eligibilityMessage && invite.status === "ACTIVE" ? <p className="partner-offer-lock-note">Claim unavailable: {eligibilityMessage}</p> : claimLocations.length === 0 ? <p className="partner-offer-lock-note">No active Locations are available for claims.</p> : <>
          <label>Test / Claim for Location<select value={selectedLocations[invite.id] ?? ""} onChange={(event) => { setSelectedLocations((current) => ({ ...current, [invite.id]: event.target.value })); setClaimResult((current) => current?.inviteId === invite.id ? null : current); }}>
            <option value="">Select Organization → Location</option>
            {claimLocations.map((location) => <option key={location.id} value={location.id}>{location.organizationName} → {location.locationName}</option>)}
          </select></label>
          {selectedLocations[invite.id] && <p className="partner-invite-claim-warning">{invite.claims.some((item) => item.locationId === selectedLocations[invite.id]) ? "This Location has claimed before; retry is idempotent." : "This action may create real commercial entitlements for the selected Location."}</p>}
          <button type="button" className="btn btn-sm" disabled={!selectedLocations[invite.id] || pending === `claim-${invite.id}` || (invite.status !== "ACTIVE" && !invite.claims.some((item) => item.locationId === selectedLocations[invite.id])) || (invite.status === "ACTIVE" && !!eligibilityMessage && !invite.claims.some((item) => item.locationId === selectedLocations[invite.id]))} onClick={() => void claim(invite)}>{pending === `claim-${invite.id}` ? "Claiming…" : invite.claims.some((item) => item.locationId === selectedLocations[invite.id]) ? "Retry / Verify" : "Test / Claim"}</button>
        </>}
      </div>}
      {claimResult?.inviteId === invite.id && <p className="partner-invite-claim-result" role="status">{claimLocations.find((location) => location.id === claimResult.locationId)?.organizationName} → {claimLocations.find((location) => location.id === claimResult.locationId)?.locationName}: {describeClaimResult(claimResult.result)}</p>}
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

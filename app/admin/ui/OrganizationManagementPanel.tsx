"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const blockerLabels: Record<string, string> = {
  orders: "Billing orders", payments: "Payments", subscriptions: "Subscriptions", trials: "Trials",
  partner_benefits: "Partner Benefits", promo_redemptions: "Spaquatoria promo redemptions",
  registration_history: "Registration Link history", product_authorizations: "Product authorization history",
  billing_resets: "Billing reset history", gift_history: "Gift access history", payer_references: "Payer references",
  partner_invite_history: "Partner invite claims",
};

type Action = "archive" | "restore" | "delete";
type ApiResult = { ok?: boolean; message?: string; blockers?: string[] };

export default function OrganizationManagementPanel({ organizationId, organizationName, archived, deletionBlockers, lifecycleHistory }: {
  organizationId: string; organizationName: string; archived: boolean; deletionBlockers: string[];
  lifecycleHistory: Array<{ action: string; operator: string; reason: string; occurredAt: string }>;
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverBlockers, setServerBlockers] = useState<string[] | null>(null);
  const matches = confirmation === organizationName;
  const canSubmit = matches && (action === "delete" || (reason.trim().length >= 12 && reason.trim().length <= 500)) && !pending;

  function begin(next: Action) {
    setAction(next); setConfirmation(""); setReason(""); setError(null); setServerBlockers(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !canSubmit) return;
    setPending(true); setError(null);
    try {
      const endpoint = action === "delete" ? `/api/v2/admin/organizations/${encodeURIComponent(organizationId)}` : `/api/v2/admin/organizations/${encodeURIComponent(organizationId)}/${action}`;
      const response = await fetch(endpoint, {
        method: action === "delete" ? "DELETE" : "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(action === "delete" ? { confirmationName: confirmation } : { confirmationName: confirmation, reason }),
      });
      const result = await response.json().catch(() => null) as ApiResult | null;
      if (!response.ok || !result?.ok) {
        if (Array.isArray(result?.blockers)) setServerBlockers(result.blockers);
        setError(result?.message ?? `Organization could not be ${action === "archive" ? "archived" : action === "restore" ? "restored" : "deleted"}.`);
        return;
      }
      setAction(null);
      router.refresh();
    } catch {
      setError("Connection failed. Refresh the Organization list before retrying.");
    } finally {
      setPending(false);
    }
  }

  const blockers = serverBlockers ?? deletionBlockers;
  return <details className="admin-organization-management">
    <summary className="cursor-pointer">Organization Management</summary>
    <div className="admin-organization-management-content">
      {!archived ? <button type="button" className="btn btn-sm" onClick={() => begin("archive")}>Archive Organization</button>
        : <button type="button" className="btn btn-sm" onClick={() => begin("restore")}>Restore Organization</button>}
      {blockers.length ? <div className="text-dim" role="status"><strong>Permanent deletion is unavailable.</strong> Protected history: {blockers.map((key) => blockerLabels[key] ?? "Related commercial history").join(", ")}.</div>
        : <button type="button" className="btn btn-sm" onClick={() => begin("delete")}>Delete Organization permanently</button>}
      {lifecycleHistory.length > 0 && <details className="admin-organization-lifecycle-history"><summary>Archive / restore history</summary><ul>{[...lifecycleHistory].reverse().map((entry, index) => <li key={`${entry.occurredAt}-${index}`}><strong>{entry.action === "archived" ? "Archived" : "Restored"}</strong> · {new Date(entry.occurredAt).toLocaleString()} · {entry.operator}<br />{entry.reason}</li>)}</ul></details>}
      {action && <form className="admin-form" onSubmit={(event) => { void submit(event); }}>
        <p>{action === "archive"
          ? "Archiving preserves billing and audit history but immediately disables customer account and player/device access for this Organization. Existing subscriptions and trials are not changed."
          : action === "restore"
            ? "Restoring only re-enables the Organization. It does not create or extend subscriptions or trials; expired access remains expired."
            : "This permanently removes the Organization and its unprotected Location data. Protected commercial history prevents this action."}</p>
        <label htmlFor={`organization-lifecycle-confirm-${organizationId}`}>Type “{organizationName}” to confirm</label>
        <input id={`organization-lifecycle-confirm-${organizationId}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
        {action !== "delete" && <>
          <label htmlFor={`organization-lifecycle-reason-${organizationId}`}>Reason (12–500 characters)</label>
          <textarea id={`organization-lifecycle-reason-${organizationId}`} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </>}
        {error && <p role="alert">{error}{serverBlockers?.length ? ` Protected history: ${serverBlockers.map((key) => blockerLabels[key] ?? "Related commercial history").join(", ")}.` : ""}</p>}
        <div className="form-actions"><button type="submit" className="btn btn-sm" disabled={!canSubmit}>{pending ? "Working…" : action === "archive" ? "Confirm archive" : action === "restore" ? "Confirm restore" : "Confirm permanent deletion"}</button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setAction(null)}>Cancel</button></div>
      </form>}
    </div>
  </details>;
}

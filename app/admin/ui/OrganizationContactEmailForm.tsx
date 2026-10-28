"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeContactEmail, ContactEmailValidationError } from "../../../lib/v2/contactEmail";

type Props = { organizationId: string; contactEmail: string | null };

export default function OrganizationContactEmailForm({ organizationId, contactEmail }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(contactEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    let normalized: string | null;
    try { normalized = normalizeContactEmail(value); }
    catch (error) {
      setMessage(error instanceof ContactEmailValidationError ? error.message : "Enter a valid contact email address.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v2/admin/organizations/${encodeURIComponent(organizationId)}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ contactEmail: normalized }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !result?.ok) {
        setMessage(result?.message ?? "Contact email could not be saved.");
        return;
      }
      setValue(normalized ?? "");
      setEditing(false);
      setMessage("Contact email saved.");
      router.refresh();
    } catch {
      setMessage("Connection failed. Contact email was not confirmed as saved.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="admin-contact-email">
    <div className="admin-contact-email-summary"><span className="text-dim">Contact:</span> <span>{contactEmail || "Not set"}</span>
      <button type="button" className="btn btn-sm" aria-expanded={editing} onClick={() => { setMessage(null); setEditing((open) => !open); }}>{editing ? "Cancel" : contactEmail ? "Edit email" : "Add email"}</button>
    </div>
    {editing && <form className="admin-contact-email-form" onSubmit={(event) => void submit(event)}>
      <label className="admin-sr-only" htmlFor={`organization-contact-email-${organizationId}`}>Organization contact email</label>
      <input id={`organization-contact-email-${organizationId}`} type="email" maxLength={254} autoComplete="email" value={value} onChange={(event) => setValue(event.target.value)} placeholder="name@example.com" />
      <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </form>}
    {message && <p role="status" aria-live="polite" className="admin-contact-email-feedback">{message}</p>}
  </div>;
}

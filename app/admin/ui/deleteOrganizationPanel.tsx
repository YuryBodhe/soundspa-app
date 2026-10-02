"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteResponse = { ok?: boolean; message?: string };

export default function DeleteOrganizationPanel({ organizationId, organizationName, locationCount, deviceCount }: {
  organizationId: string;
  organizationName: string;
  locationCount: number;
  deviceCount: number;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirmation === organizationName;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!matches) return setError("Type the exact Organization name to confirm deletion.");

    setPending(true);
    try {
      const response = await fetch(`/api/v2/admin/organizations/${encodeURIComponent(organizationId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ confirmationName: confirmation }),
      });
      const result = await response.json().catch(() => null) as DeleteResponse | null;
      if (!response.ok || !result?.ok) {
        setError(result?.message ?? "Organization could not be deleted.");
        return;
      }
      router.push(`/admin/ui?message=${encodeURIComponent(`Organization ${organizationName} deleted.`)}`);
      router.refresh();
    } catch {
      setError("Connection failed. Check the Organization list before retrying.");
    } finally {
      setPending(false);
    }
  }

  return <details className="text-dim">
    <summary className="cursor-pointer">Delete Organization</summary>
    <section className="admin-card mt-2" aria-label={`Delete Organization ${organizationName}`}>
      <p>Delete organization <strong>{organizationName}</strong>?</p>
      <p>This permanently deletes {locationCount} Location(s), {deviceCount} Player Device(s), and all Location-specific configuration. Global SoundSpa channels and Base configuration will not be affected. This action cannot be undone.</p>
      <form className="admin-form" onSubmit={submit}>
        <div className="form-row">
          <label htmlFor={`delete-organization-confirm-${organizationId}`}>Type “{organizationName}” to enable deletion</label>
          <input id={`delete-organization-confirm-${organizationId}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
        </div>
        <div className="form-actions"><button type="submit" className="btn btn-sm" disabled={!matches || pending}>{pending ? "Deleting…" : "Delete Organization permanently"}</button></div>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  </details>;
}

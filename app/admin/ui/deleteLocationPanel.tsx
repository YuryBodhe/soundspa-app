"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteResponse = { ok?: boolean; message?: string };

export default function DeleteLocationPanel({ locationId, locationName, organizationName, deviceCount }: {
  locationId: string;
  locationName: string;
  organizationName: string;
  deviceCount: number;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirmation.trim() === locationName;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!matches) return setError("Type the exact Location name to confirm deletion.");
    if (!window.confirm(`Delete Location "${locationName}" from "${organizationName}"?\n\nThis will permanently remove the Location, its ${deviceCount} Device(s), and Location-specific access/configuration. The Organization and global Channels will remain. This action cannot be undone.`)) return;

    setPending(true);
    try {
      const response = await fetch(`/api/v2/admin/locations/${encodeURIComponent(locationId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ confirmationName: confirmation.trim() }),
      });
      const result = await response.json().catch(() => null) as DeleteResponse | null;
      if (!response.ok || !result?.ok) {
        setError(result?.message ?? "Location could not be deleted.");
        return;
      }
      router.push(`/admin/ui?message=${encodeURIComponent(`Location ${locationName} deleted.`)}`);
      router.refresh();
    } catch {
      setError("Connection failed. Check the Location list before retrying.");
    } finally {
      setPending(false);
    }
  }

  return <section className="admin-card mt-4" aria-labelledby="delete-location-heading">
    <h2 id="delete-location-heading" className="admin-card-title">Danger zone · Delete Location</h2>
    <p className="text-dim">This permanently deletes <strong>{locationName}</strong> from <strong>{organizationName}</strong>, including {deviceCount} Device(s) and Location-specific access/configuration. The Organization, other Locations, Channels, Tracks and global Base remain unchanged.</p>
    <form className="admin-form" onSubmit={submit}>
      <div className="form-row">
        <label htmlFor={`delete-location-confirm-${locationId}`}>Type “{locationName}” to enable deletion</label>
        <input id={`delete-location-confirm-${locationId}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
      </div>
      <div className="form-actions"><button type="submit" className="btn btn-sm" disabled={!matches || pending}>{pending ? "Deleting…" : "Delete Location permanently"}</button></div>
      {error && <p role="alert" className="text-dim">{error}</p>}
    </form>
  </section>;
}

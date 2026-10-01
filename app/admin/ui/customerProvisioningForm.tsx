"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ProvisioningResponse = { ok?: boolean; message?: string; locationId?: string };

export default function CustomerProvisioningForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v2/admin/customers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          organizationName: form.get("organizationName"),
          locationName: form.get("locationName"),
          slug: form.get("slug"),
          timezone: form.get("timezone"),
        }),
      });
      const result = await response.json().catch(() => null) as ProvisioningResponse | null;
      if (!response.ok || !result?.locationId) {
        setError(result?.message ?? "Customer and Location could not be created. Please retry.");
        return;
      }
      router.push(`/admin/ui?location=${encodeURIComponent(result.locationId)}`);
      router.refresh();
    } catch {
      setError("Connection failed. Check the Customers list before retrying.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <div className="admin-page-header"><h2 className="admin-card-title">Customers</h2><button type="button" className="btn btn-primary" onClick={() => { setError(null); setOpen((value) => !value); }}>
      {open ? "Cancel" : "+ New Customer"}
    </button></div>
    {open && <form className="admin-form mt-4" onSubmit={submit}>
      <div className="form-row"><label htmlFor="customer-organization-name">Organization name</label><input id="customer-organization-name" name="organizationName" required maxLength={160} /></div>
      <div className="form-row"><label htmlFor="customer-location-name">First Location name</label><input id="customer-location-name" name="locationName" required maxLength={160} /></div>
      <div className="form-row"><label htmlFor="customer-location-slug">Location slug</label><input id="customer-location-slug" name="slug" required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="lowercase-with-hyphens" /></div>
      <div className="form-row"><label htmlFor="customer-location-timezone">Time zone</label><input id="customer-location-timezone" name="timezone" required maxLength={100} placeholder="Europe/Moscow or UTC" /></div>
      <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create Customer and Location"}</button></div>
      {error && <p role="alert" className="text-dim">{error}</p>}
    </form>}
  </>;
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ProvisioningResponse = { ok?: boolean; message?: string; locationId?: string };

export default function CustomerProvisioningForm({ timeZones }: { timeZones: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => {
      const field = form.get(name);
      return typeof field === "string" ? field.trim() : "";
    };
    const organizationName = value("organizationName");
    const locationName = value("locationName");
    const slug = value("slug");
    const timezone = value("timezone");

    if (!organizationName) return setError("Enter an Organization name.");
    if (!locationName) return setError("Enter the first Location name.");
    if (!slug) return setError("Enter a Location slug.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return setError("Use lowercase letters, numbers, and single hyphens in the Location slug.");
    }
    if (!timezone) return setError("Enter a time zone, for example Europe/Moscow or UTC.");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    } catch {
      return setError("Enter a valid IANA time zone, for example Europe/Moscow or UTC.");
    }

    setPending(true);
    try {
      const response = await fetch("/api/v2/admin/customers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ organizationName, locationName, slug, timezone }),
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
    {open && <form className="admin-form mt-4" noValidate onSubmit={submit}>
      <div className="form-row"><label htmlFor="customer-organization-name">Organization name</label><input id="customer-organization-name" name="organizationName" required maxLength={160} /></div>
      <div className="form-row"><label htmlFor="customer-location-name">First Location name</label><input id="customer-location-name" name="locationName" required maxLength={160} /></div>
      <div className="form-row"><label htmlFor="customer-location-slug">Location slug</label><input id="customer-location-slug" name="slug" required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="lowercase-with-hyphens" /></div>
      <div className="form-row"><label htmlFor="customer-location-timezone">Time zone</label><select id="customer-location-timezone" name="timezone" required defaultValue=""><option value="" disabled>Select an IANA time zone…</option>{timeZones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></div>
      <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create Customer and Location"}</button></div>
      {error && <p role="alert" className="text-dim">{error}</p>}
    </form>}
  </>;
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import CustomerProvisioningForm from "./customerProvisioningForm";
import DeleteOrganizationPanel from "./deleteOrganizationPanel";
import OrganizationContactEmailForm from "./OrganizationContactEmailForm";
import { filterOrganizations, paginateOrganizations } from "../../../lib/v2/organizationDirectory";
import { adminLocationPath } from "../../../lib/v2/adminLocationNavigation";

export type OrganizationOverview = {
  id: string;
  name: string;
  contactEmail: string | null;
  archived: boolean;
  locations: Array<{ id: string; name: string; slug: string; archived: boolean }>;
  deviceCount: number;
};

export default function CustomersDirectory({ organizations, timeZones }: { organizations: OrganizationOverview[]; timeZones: string[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filteredOrganizations = useMemo(() => filterOrganizations(organizations, query), [organizations, query]);
  const pagination = paginateOrganizations(filteredOrganizations, page, 20);
  const totalLocations = organizations.reduce((total, organization) => total + organization.locations.length, 0);

  return <details className="admin-card admin-collapsible admin-customers-card">
    <summary className="admin-collapsible-summary"><span>Customers</span><span className="admin-customers-summary-meta">{totalLocations} Locations · {organizations.length} Organizations</span><span className="admin-disclosure-indicator" aria-hidden="true">⌄</span></summary>
    <div className="admin-collapsible-content">
      <div className="admin-customers-toolbar"><CustomerProvisioningForm timeZones={timeZones} />
        <label className="admin-customer-search-label" htmlFor="customer-organization-search">Search Organizations</label>
        <input id="customer-organization-search" className="admin-customer-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Organization name or contact email" />
        <span className="text-dim" aria-live="polite">{filteredOrganizations.length} matching Organization(s)</span>
      </div>
      <div className="admin-customer-organizations">
        {pagination.items.map((organization) => <article className="admin-customer-organization" key={organization.id}>
          <div className="admin-customer-organization-heading"><h3>{organization.name}</h3><span className={`badge ${organization.archived ? "badge-neutral" : "badge-ok"}`}>{organization.archived ? "ARCHIVED" : "ACTIVE"}</span></div>
          <div className="admin-customer-organization-meta">
            <OrganizationContactEmailForm organizationId={organization.id} contactEmail={organization.contactEmail} />
            <span>{organization.locations.length} Location(s) · {organization.deviceCount} Device(s)</span>
          </div>
          {organization.locations.length ? <ul className="admin-customer-location-list">{organization.locations.map((location) => <li className="admin-customer-location-row" key={location.id}>
            <div><strong>{location.name}</strong><span className="text-dim">{location.slug}</span></div>
            <span className={`badge ${location.archived ? "badge-neutral" : "badge-ok"}`}>{location.archived ? "ARCHIVED" : "ACTIVE"}</span>
            {!organization.archived && !location.archived ? <Link className="btn btn-sm" href={adminLocationPath(location.id)}>Open Location</Link> : <span />}
          </li>)}</ul> : <p className="text-dim">No Locations yet.</p>}
          <div className="admin-customer-organization-actions"><DeleteOrganizationPanel organizationId={organization.id} organizationName={organization.name} locationCount={organization.locations.length} deviceCount={organization.deviceCount} /></div>
        </article>)}
        {!filteredOrganizations.length && <p className="text-dim">No matching Organizations.</p>}
      </div>
      {filteredOrganizations.length > 20 && <nav className="admin-customer-pagination" aria-label="Customers pages">
        <button type="button" className="btn btn-sm" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <span aria-live="polite">Page {pagination.page} of {pagination.pageCount}</span>
        <button type="button" className="btn btn-sm" disabled={pagination.page >= pagination.pageCount} onClick={() => setPage((current) => Math.min(pagination.pageCount, current + 1))}>Next</button>
      </nav>}
    </div>
  </details>;
}

"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMinorAmount, parseMajorAmount } from "./paymentAmount";

type Organization = { id: string; name: string; locations: Array<{ id: string; name: string }>; products: Product[] };
type Product = { id: string; code: string; name: string };
type Line = { locationId: string; locationName: string; productId: string; productName: string; amountMinor: string; currency: string; startsAt: string | null; endsAt: string | null };
type Event = { id: string; occurredAt: string | null; operator: string | null; reason: string | null; status: string };
type Order = { id: string; organizationName: string; status: string; currency: string; totalAmountMinor: string; invoiceNumber: string | null; invoiceIssuedAt: string | null; paymentDueAt: string | null; createdAt: string; createdByOperator: string | null; creationReason: string | null; paymentId: string | null; paymentStatus: string | null; paymentAmountMinor: string | null; paymentCurrency: string | null; bankTransactionReference: string | null; paidAt: string | null; lines: Line[]; events: Event[] };

function dateLabel(value: string | null) { return value ? new Date(value).toLocaleDateString() : "—"; }

export default function PaymentsManagement({ organizations, orders, initialCalendarMonth }: { organizations: Organization[]; orders: Order[]; initialCalendarMonth: string }) {
  const router = useRouter();
  const currentMonth = initialCalendarMonth;
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [productId, setProductId] = useState(organizations[0]?.products[0]?.id ?? "");
  const [currency, setCurrency] = useState("RUB");
  const [calendarMonth, setCalendarMonth] = useState(currentMonth);
  const [periodStart, setPeriodStart] = useState(`${currentMonth}-01`);
  const [periodEndExclusive, setPeriodEndExclusive] = useState(() => {
    const [year, month] = currentMonth.split("-").map(Number);
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filter, setFilter] = useState("all");
  const selectedOrganization = organizations.find((item) => item.id === organizationId);
  const displayedOrders = useMemo(() => filter === "all" ? orders : orders.filter((order) => order.status === filter), [filter, orders]);

  function toggleLocation(id: string) {
    setSelectedLocationIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setError(""); setSuccess("");
    const amountMinor = parseMajorAmount(String(form.get("amount") ?? ""), currency);
    if (!amountMinor) { setError("Enter a positive amount with valid currency precision."); setBusy(false); return; }
    try {
      const response = await fetch("/api/v2/admin/billing/orders", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, lines: selectedLocationIds.map((locationId) => ({ locationId, productId })), periodStart, periodEndExclusive,
          totalAmountMinor: amountMinor, currency, invoiceNumber: form.get("invoiceNumber"), invoiceIssuedAt: form.get("invoiceIssuedAt"), paymentDueAt: form.get("paymentDueAt"),
          reason: form.get("reason"), idempotencyKey: `manual-${crypto.randomUUID()}` }) });
      const result = await response.json().catch(() => ({})) as { code?: string; id?: string; duplicate?: boolean };
      if (!response.ok) { setError(result.code ?? "Invoice creation failed."); return; }
      setSuccess(result.duplicate ? "Existing invoice request returned." : "Pending bank-transfer invoice created. No access was changed.");
      formElement.reset(); setSelectedLocationIds([]); router.refresh();
    } catch { setError("Connection failed. Please retry."); }
    finally { setBusy(false); }
  }

  async function confirmPayment(order: Order, formElement: HTMLFormElement) {
    const form = new FormData(formElement); const confirmedCurrency = String(form.get("currency") ?? "");
    const amountMinor = parseMajorAmount(String(form.get("amount") ?? ""), confirmedCurrency);
    setBusy(true); setError(""); setSuccess("");
    if (!amountMinor) { setError("Enter the full received amount in the invoice currency."); setBusy(false); return; }
    try {
      const response = await fetch(`/api/v2/admin/billing/orders/${encodeURIComponent(order.id)}/confirm`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountMinor, currency: confirmedCurrency, bankTransactionReference: form.get("bankReference"), actualPaymentDate: form.get("paymentDate"), reason: form.get("reason") }) });
      const result = await response.json().catch(() => ({})) as { code?: string; duplicate?: boolean };
      if (!response.ok) { setError(result.code === "payment_conflict" ? "Amount, currency, or invoice state does not match. Review manually; nothing was confirmed." : result.code === "bank_reference_conflict" ? "This bank reference is already linked to another payment." : result.code ?? "Payment confirmation failed."); return; }
      setSuccess(result.duplicate ? "This payment was already recorded; no duplicate access was added." : "Full payment recorded and all linked salons updated atomically.");
      formElement.reset(); router.refresh();
    } catch { setError("Connection failed. Please retry."); }
    finally { setBusy(false); }
  }

  return <div className="admin-billing-page">
    {error && <p role="alert" className="admin-billing-feedback admin-billing-error">{error}</p>}
    {success && <p role="status" className="admin-billing-feedback">{success}</p>}
    <section className="admin-card admin-billing-create">
      <h2 className="admin-card-title">Create manual invoice</h2>
      <p className="text-dim">Choose one or more salons, one applicable Product, an exact coverage period, and one fixed total. The total is allocated deterministically across the selected salons. Access changes only after full payment confirmation.</p>
      <form onSubmit={(event) => void createOrder(event)} className="admin-billing-form">
        <label>Organization<select value={organizationId} onChange={(event) => { const next = organizations.find((item) => item.id === event.target.value); setOrganizationId(event.target.value); setSelectedLocationIds([]); setProductId(next?.products[0]?.id ?? ""); }} required>
          {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
        </select></label>
        <fieldset><legend>Select salons (one or more)</legend><div className="admin-billing-location-options">
          {(selectedOrganization?.locations ?? []).map((location) => <label key={location.id}><input type="checkbox" checked={selectedLocationIds.includes(location.id)} onChange={() => toggleLocation(location.id)} />{location.name}</label>)}
        </div></fieldset>
        <label>Product for selected salons<select value={productId} onChange={(event) => setProductId(event.target.value)} required>{(selectedOrganization?.products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.code}</option>)}</select></label>
        <div className="admin-billing-period-helper"><label>Calendar month shortcut<input type="month" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value)} /></label><button type="button" className="btn btn-sm" disabled={!/^\d{4}-(0[1-9]|1[0-2])$/.test(calendarMonth)} onClick={() => {
          const [year, month] = calendarMonth.split("-").map(Number);
          setPeriodStart(`${calendarMonth}-01`); setPeriodEndExclusive(new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10));
        }}>Use calendar month</button></div>
        <label>Coverage starts (inclusive)<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} required /></label>
        <label>Coverage ends (exclusive)<input type="date" value={periodEndExclusive} onChange={(event) => setPeriodEndExclusive(event.target.value)} required /></label>
        <label>Invoice total<input name="amount" type="number" min="0.01" step="any" inputMode="decimal" required /></label>
        <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} required><option value="RUB">RUB</option></select></label>
        <label>External invoice number<input name="invoiceNumber" maxLength={120} required /></label>
        <label>Issue date<input name="invoiceIssuedAt" type="date" required /></label>
        <label>Payment due date<input name="paymentDueAt" type="date" required /></label>
        <label className="admin-billing-wide">Reason<input name="reason" minLength={12} maxLength={500} required /></label>
        <button className="btn btn-primary" disabled={busy || selectedLocationIds.length < 1 || !organizationId || !productId || !periodStart || !periodEndExclusive || periodEndExclusive <= periodStart}>{busy ? "Saving…" : "Create pending invoice"}</button>
      </form>
    </section>

    <section aria-labelledby="manual-payment-list-title">
      <div className="admin-billing-list-heading"><h2 id="manual-payment-list-title" className="admin-card-title">Manual invoices and payment history</h2><label>Filter<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="cancelled">Cancelled</option></select></label></div>
      {!displayedOrders.length && <p className="text-dim">No manual invoices found.</p>}
      <div className="admin-billing-order-list">{displayedOrders.map((order) => <article className="admin-card admin-billing-order" key={order.id}>
        <header><div><h3>{order.organizationName} · {order.invoiceNumber ?? "Invoice details unavailable"}</h3><p className="text-dim">{order.status.toUpperCase()} · {formatMinorAmount(order.totalAmountMinor, order.currency)} {order.currency} · issued {dateLabel(order.invoiceIssuedAt)} · due {dateLabel(order.paymentDueAt)}</p></div><span className="admin-billing-status">{order.status}</span></header>
        <ul className="admin-billing-lines">{order.lines.map((line) => <li key={`${line.locationId}:${line.productId}`}><span>{line.locationName} · {line.productName}</span><span>{dateLabel(line.startsAt)} – {dateLabel(line.endsAt)} · {formatMinorAmount(line.amountMinor, line.currency)} {line.currency}</span></li>)}</ul>
        <p className="text-dim">Created {dateLabel(order.createdAt)} by {order.createdByOperator ?? "—"}{order.creationReason ? ` · ${order.creationReason}` : ""}{order.paidAt ? ` · paid ${dateLabel(order.paidAt)}` : ""}{order.bankTransactionReference ? ` · bank reference ${order.bankTransactionReference}` : ""}</p>
        {order.paymentStatus === "pending" && (!order.invoiceNumber || !order.invoiceIssuedAt || !order.paymentDueAt) && <p className="admin-billing-error">Invoice metadata is incomplete; review this legacy record manually before confirming funds.</p>}
        {order.paymentId && order.paymentStatus === "pending" && order.invoiceNumber && order.invoiceIssuedAt && order.paymentDueAt && (order.status === "pending" || order.status === "overdue") ? <details className="admin-billing-confirm"><summary>Confirm full bank payment</summary><form onSubmit={(event) => { event.preventDefault(); void confirmPayment(order, event.currentTarget); }}>
          <label>Received amount<input name="amount" type="number" min="0.01" step="any" defaultValue={formatMinorAmount(order.totalAmountMinor, order.currency)} required /></label>
          <label>Currency<input name="currency" defaultValue={order.currency} minLength={3} maxLength={3} required /></label>
          <label>Bank transaction reference<input name="bankReference" maxLength={200} required /></label>
          <label>Actual payment date<input name="paymentDate" type="date" required /></label>
          <label className="admin-billing-wide">Confirmation reason<input name="reason" minLength={12} maxLength={500} required /></label>
          <p className="text-dim admin-billing-wide">Only an exact full payment in the invoice currency is accepted. Partial payments, overpayments and mismatches require manual review.</p>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Confirm payment"}</button>
        </form></details> : null}
        <details className="admin-billing-history"><summary>Payment and audit history ({order.events.length})</summary><ul>{order.events.map((item) => <li key={item.id}>{dateLabel(item.occurredAt)} · {item.status} · {item.operator} · {item.reason}</li>)}{!order.events.length && <li className="text-dim">No confirmed payment events.</li>}</ul></details>
      </article>)}</div>
    </section>
  </div>;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";

export type BillingWizardPlan = {
  productId: string; productName: string;
  status: "trial" | "subscription" | "partner" | "expired" | "available";
  trialEndsAt: string | null; paidThrough: string | null; subscriptionId: string | null;
  subscriptionCanceled: boolean; routes: { id: string; providerName: string }[];
};
export type BillingWizardLocation = {
  id: string; organizationId: string; organizationName: string; name: string; timezone: string;
  marketCode: string | null; products: BillingWizardPlan[];
};
type Quote = {
  currency: string; totalAmountMinor: string;
  lines: Array<{ locationId: string; locationName: string; productId: string; productName: string; durationMonths: number; amountMinor: string }>;
};
type Order = { id: string; status: string; currency: string; totalAmountMinor: string; lines: Quote["lines"] };
type Checkout = { checkoutUrl: string; expiresAt: string; amountMinor: number; currency: string; providerName: string };
type Props = {
  organizationId: string; organizationName: string; locations: BillingWizardLocation[];
  onPaymentConfirmed?: () => Promise<void> | void;
  previewOnly?: boolean;
};
type WizardStep = 1 | 2 | 3;

function durationText(months: number, locale: string, t: (key: import("@/app/i18n/types").TranslationKey) => string) {
  const plural = new Intl.PluralRules(locale).select(months);
  const key = plural === "one" ? "billingWizardMonthOne" : plural === "few" ? "billingWizardMonthFew" : plural === "many" ? "billingWizardMonthMany" : "billingWizardMonths";
  return t(key).replace("{{count}}", String(months));
}

export default function AccountBillingWizard({ organizationId, organizationName, locations, onPaymentConfirmed, previewOnly = false }: Props) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedProducts, setSelectedProducts] = useState<Record<string, string>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [selectionError, setSelectionError] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [orderStatus, setOrderStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mutationLock = useRef(false);
  const paymentRefreshLock = useRef(false);

  const organizationLocations = useMemo(() => locations.filter((location) => location.organizationId === organizationId), [locations, organizationId]);
  const selectedLines = organizationLocations.flatMap((location) => {
    const productId = selectedProducts[location.id];
    const product = location.products.find((candidate) => candidate.productId === productId);
    return product ? [{ location, product, months: durations[location.id] ?? 1 }] : [];
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLButtonElement>("[data-wizard-initial-focus]")?.focus(); }
    else if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  useEffect(() => {
    if (!open || !order?.id || !checkout || ["paid", "canceled", "expired"].includes(orderStatus)) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/v2/customer/billing/orders/${encodeURIComponent(order.id)}`, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const current = await response.json() as Order;
        if (!active) return;
        setOrder(current);
        setOrderStatus(current.status);
        if (current.status === "paid" && !paymentRefreshLock.current) {
          paymentRefreshLock.current = true;
          try { await onPaymentConfirmed?.(); } finally { setError(""); }
        }
      } catch { /* Poll again; the order API remains authoritative. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [open, order?.id, orderStatus, checkout, onPaymentConfirmed]);

  function reset() {
    setStep(1); setSelectedProducts({}); setDurations({}); setSelectionError(false);
    setQuote(null); setOrder(null); setCheckout(null); setOrderStatus(""); setError(""); setCopied(false);
    mutationLock.current = false; paymentRefreshLock.current = false;
  }
  function begin() { reset(); setOpen(true); }
  function close() { setOpen(false); }
  function updateSelection(update: () => void) { setQuote(null); setError(""); update(); }
  function toggleLocation(location: BillingWizardLocation, checked: boolean) {
    setSelectionError(false);
    updateSelection(() => setSelectedProducts((current) => {
      const next = { ...current };
      if (!checked) delete next[location.id];
      else if (location.products[0]) next[location.id] = current[location.id] ?? location.products[0].productId;
      return next;
    }));
  }
  function errorMessage(code: string) {
    if (["unauthenticated_or_unverified", "unauthenticated", "not_authorized"].includes(code)) return t("billingUnauthorized");
    if (["market_unavailable", "market_not_configured"].includes(code)) return t("billingMarketUnavailable");
    if (["route_unavailable", "product_unavailable"].includes(code)) return t("billingNoRoutes");
    if (code === "checkout_expired" || code === "expired") return t("billingCheckoutExpired");
    if (["checkout_pending", "order_stale"].includes(code)) return t("billingCheckoutPending");
    if (code === "invalid_request" || code === "duplicate_line" || code === "invalid") return t("billingWizardInvalidSelection");
    return t("billingPaymentFailed");
  }
  async function requestQuote() {
    if (selectedLines.length === 0) { setSelectionError(true); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v2/customer/billing/orders/preview", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, lines: selectedLines.map(({ location, product, months }) => ({ locationId: location.id, productId: product.productId, durationMonths: months })) }),
      });
      const body = await response.json().catch(() => ({})) as Quote & { error?: string };
      if (!response.ok || !body.currency || !Array.isArray(body.lines)) { setError(errorMessage(body.error ?? "unavailable")); return; }
      setQuote(body); setStep(2);
    } catch { setError(t("billingUnavailable")); }
    finally { setBusy(false); }
  }
  async function createOrderAndCheckout() {
    if (mutationLock.current || busy) return;
    mutationLock.current = true; setBusy(true); setError(""); setOrderStatus(t("billingWizardCreatingOrder"));
    try {
      let currentOrder = order;
      if (!currentOrder) {
        const response = await fetch("/api/v2/customer/billing/orders", {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId, lines: selectedLines.map(({ location, product, months }) => ({ locationId: location.id, productId: product.productId, durationMonths: months })) }),
        });
        const body = await response.json().catch(() => ({})) as { order?: Order; error?: string };
        if (!response.ok || !body.order) { setError(errorMessage(body.error ?? "unavailable")); setOrderStatus(""); return; }
        currentOrder = body.order; setOrder(currentOrder); setOrderStatus(t("billingWizardOrderCreated"));
      }
      const response = await fetch(`/api/v2/customer/billing/orders/${encodeURIComponent(currentOrder.id)}/fake-checkout`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}",
      });
      const body = await response.json().catch(() => ({})) as Checkout & { error?: string };
      if (!response.ok || !body.checkoutUrl || !body.expiresAt || !body.currency) { setError(errorMessage(body.error ?? "unavailable")); setOrderStatus(""); return; }
      setCheckout(body); setOrderStatus("pending"); setStep(3);
    } catch { setError(t("billingPaymentFailed")); setOrderStatus(""); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  async function copyLink() {
    if (!checkout) return;
    try { await navigator.clipboard.writeText(checkout.checkoutUrl); setCopied(true); }
    catch { setError(t("billingWizardCopyFailed")); }
  }
  function formatAmount(amountMinor: string | number, currency: string) {
    const amount = Number(amountMinor) / 100;
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  }
  const statusLabel = (product: BillingWizardPlan) => product.status === "trial" ? t("billingTrial") : product.status === "subscription" ? (product.subscriptionCanceled ? t("billingCanceled") : t("billingSubscription")) : product.status === "partner" ? t("billingPartnerStatus") : product.status === "expired" ? t("billingExpired") : t("billingAvailable");
  const lineIssue = (location: BillingWizardLocation, product: BillingWizardPlan) => !location.marketCode ? t("billingMarketMissing") : product.routes.length === 0 ? t("billingNoRoute") : "";
  return <>
    <button type="button" className="customer-auth-submit customer-billing-wizard-open" onClick={begin}>{t("billingWizardOpen")}</button>
    <dialog ref={dialogRef} className="customer-billing-wizard-dialog customer-auth-card" aria-labelledby={`billing-wizard-title-${organizationId}`} onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => setOpen(false)} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <div className="customer-billing-wizard-header"><div><p className="customer-billing-wizard-eyebrow">{t("billingWizardOrganization")}</p><h2 id={`billing-wizard-title-${organizationId}`}>{t("billingWizardTitle")}</h2><p>{organizationName}</p></div><button data-wizard-initial-focus type="button" className="customer-billing-secondary" onClick={close} aria-label={t("billingWizardClose")}>×</button></div>
      <ol className="customer-billing-wizard-steps" aria-label={t("billingWizardProgress")}>{[1, 2, 3].map((item) => <li key={item} aria-current={step === item ? "step" : undefined} className={step === item ? "is-current" : step > item ? "is-complete" : ""}><span>{item}</span><span>{t(item === 1 ? "billingWizardStepSelect" : item === 2 ? "billingWizardStepReview" : "billingWizardStepLink")}</span></li>)}</ol>
      {step === 1 && <section className="customer-billing-wizard-content"><h3>{t("billingWizardStepSelect")}</h3>
        {organizationLocations.length === 0 ? <p role="status">{t("billingWizardNoLocations")}</p> : <div className="customer-billing-wizard-location-list">{organizationLocations.map((location) => {
          const checked = Boolean(selectedProducts[location.id]); const product = location.products.find((candidate) => candidate.productId === selectedProducts[location.id]); const issue = product ? lineIssue(location, product) : "";
          return <article className="customer-billing-wizard-location" key={location.id}><label className="customer-billing-wizard-check"><input type="checkbox" checked={checked} disabled={!location.products.length || busy} onChange={(event) => toggleLocation(location, event.target.checked)} /><span><strong>{location.name}</strong><small>{product ? statusLabel(product) : location.products.length ? t("billingWizardChooseProduct") : t("billingWizardNoEligibleProduct")}</small></span></label>
            {checked && product && <div className="customer-billing-wizard-line-controls">{location.products.length > 1 && <label>{t("billingWizardProduct")}<select disabled={busy} value={product.productId} onChange={(event) => updateSelection(() => setSelectedProducts((current) => ({ ...current, [location.id]: event.target.value })))}>{location.products.map((item) => <option key={item.productId} value={item.productId}>{item.productName}</option>)}</select></label>}
              <label>{t("billingWizardDuration")}<select disabled={busy} value={durations[location.id] ?? 1} onChange={(event) => updateSelection(() => setDurations((current) => ({ ...current, [location.id]: Number(event.target.value) })))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((months) => <option key={months} value={months}>{durationText(months, locale, t)}</option>)}</select></label>
              {issue && <p className="customer-billing-wizard-warning" role="status">{issue}</p>}</div>}
          </article>;
        })}</div>}
        {selectionError && <p className="customer-onboarding-error" role="alert">{t("billingWizardSelectAtLeastOne")}</p>}
        {error && <p className="customer-onboarding-error" role="alert">{error}</p>}
      </section>}
      {step === 2 && quote && <section className="customer-billing-wizard-content"><h3>{t("billingWizardStepReview")}</h3><p><strong>{organizationName}</strong></p>
        <ul className="customer-billing-wizard-review">{quote.lines.map((line) => <li key={line.locationId}><strong>{line.locationName}</strong><span>{line.productName} · {durationText(line.durationMonths, locale, t)}</span><span>{previewOnly ? t("billingWizardQuoteUnavailable") : formatAmount(line.amountMinor, quote.currency)}</span></li>)}</ul>
        <div className="customer-billing-wizard-total"><span>{t("billingWizardTotal")}</span><strong>{previewOnly ? t("billingWizardQuoteUnavailable") : formatAmount(quote.totalAmountMinor, quote.currency)}</strong></div>
        <p className="customer-billing-wizard-note">{previewOnly ? t("billingWizardPreviewOnly") : t("billingWizardPrepaidNotice")}</p>{error && <p className="customer-onboarding-error" role="alert">{error}</p>}
      </section>}
      {step === 3 && previewOnly && <section className="customer-billing-wizard-content"><h3>{t("billingWizardStepLink")}</h3><div className="customer-billing-wizard-total"><span>{t("billingWizardTotal")}</span><strong>{t("billingWizardQuoteUnavailable")}</strong></div><p className="customer-billing-wizard-note" role="status">{t("billingWizardPreviewOnly")}</p></section>}
      {step === 3 && checkout && order && <section className="customer-billing-wizard-content"><h3>{t("billingWizardStepLink")}</h3>
        <ul className="customer-billing-wizard-review">{order.lines.map((line) => <li key={line.locationId}><strong>{line.locationName}</strong><span>{line.productName} · {durationText(line.durationMonths, locale, t)}</span><span>{formatAmount(line.amountMinor, order.currency)}</span></li>)}</ul>
        <div className="customer-billing-wizard-total"><span>{t("billingWizardTotal")}</span><strong>{formatAmount(order.totalAmountMinor, order.currency)}</strong></div>
        <dl className="customer-billing-wizard-link-details"><dt>{t("billingWizardPaymentStatus")}</dt><dd>{orderStatus || order.status}</dd><dt>{t("billingWizardExpiry")}</dt><dd>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(checkout.expiresAt))}</dd><dt>{t("billingWizardPaymentLink")}</dt><dd><a href={checkout.checkoutUrl} target="_blank" rel="noopener noreferrer">{t("billingWizardOpenCheckout")}</a></dd></dl>
        <p>{checkout.providerName}</p><p className="customer-billing-wizard-note" role="status">{orderStatus === "paid" ? t("billingWizardPaymentConfirmed") : orderStatus === "expired" ? t("billingWizardOrderExpired") : orderStatus === "canceled" ? t("billingWizardOrderCanceled") : t("billingWizardAwaitingPayment")}</p>
        <div className="customer-billing-wizard-link-actions"><a className="customer-auth-submit" href={checkout.checkoutUrl} target="_blank" rel="noopener noreferrer">{t("billingWizardOpenCheckout")}</a><button type="button" className="customer-billing-secondary" onClick={() => void copyLink()}>{copied ? t("deviceLinkCopied") : t("billingWizardCopyLink")}</button></div>
        {error && <p className="customer-onboarding-error" role="alert">{error}</p>}
      </section>}
      {orderStatus && step < 3 && <p role="status" className="customer-billing-wizard-note">{orderStatus}</p>}
      {step === 1 && error && <p className="customer-onboarding-error" role="alert">{error}</p>}
      <div className="customer-billing-wizard-actions">{step === 2 && <button type="button" className="customer-billing-secondary" disabled={busy} onClick={() => { setStep(1); setError(""); }}>{t("billingWizardBack")}</button>}
        {step === 1 && !previewOnly && <button type="button" className="customer-auth-submit" disabled={busy || selectedLines.length === 0} onClick={() => void requestQuote()}>{busy ? t("billingLoading") : t("billingWizardGetQuote")}</button>}
        {step === 1 && previewOnly && <button type="button" className="customer-auth-submit" disabled={selectedLines.length === 0} onClick={() => { setSelectionError(selectedLines.length === 0); if (selectedLines.length) { setQuote({ currency: "USD", totalAmountMinor: "0", lines: selectedLines.map(({ location, product, months }) => ({ locationId: location.id, locationName: location.name, productId: product.productId, productName: product.productName, durationMonths: months, amountMinor: "0" })) }); setStep(2); } }}>{t("billingWizardContinue")}</button>}
        {step === 2 && !previewOnly && <button type="button" className="customer-auth-submit" disabled={busy || !quote} onClick={() => void createOrderAndCheckout()}>{busy ? t("billingLoading") : t("billingWizardConfirmOrder")}</button>}
        {step === 2 && previewOnly && <button type="button" className="customer-auth-submit" onClick={() => setStep(3)}>{t("billingWizardContinue")}</button>}
        {step < 3 && <button type="button" className="customer-billing-secondary" onClick={close}>{t("billingWizardClose")}</button>}
        {step === 3 && <><button type="button" className="customer-billing-secondary" onClick={() => { reset(); setOpen(true); }}>{t("billingWizardNewOrder")}</button><button type="button" className="customer-billing-secondary" onClick={close}>{t("billingClose")}</button></>}
      </div>
    </dialog>
  </>;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";
import { billingMarketSelectionState, billingOrderErrorKey, billingOrderStatusKey, canResumeBillingOrder, canPreviewBillingLines } from "./billingWizardModel";

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
export type BillingOrderHistoryItem = {
  id: string; organizationId: string; status: string; currency: string; totalAmountMinor: string; createdAt: string; expiresAt: string | null;
  lines: Array<Quote["lines"][number] & { id: string; billingPeriodStartsAt: string | null; billingPeriodEndsAt: string | null }>;
};
type Order = BillingOrderHistoryItem;
type Checkout = { checkoutUrl: string; expiresAt: string; amountMinor: number; currency: string; providerName: string };
type Props = {
  organizationId: string; organizationName: string; locations: BillingWizardLocation[];
  supportedMarkets?: string[];
  onSaveMarket?: (locationId: string, marketCode: string) => Promise<BillingWizardLocation>;
  orders?: BillingOrderHistoryItem[];
  ordersUnavailable?: boolean;
  onRefreshOrders?: () => Promise<void> | void;
  onPaymentConfirmed?: () => Promise<void> | void;
  previewOnly?: boolean;
};
type WizardStep = 1 | 2 | 3;

function durationText(months: number, locale: string, t: (key: import("@/app/i18n/types").TranslationKey) => string) {
  const plural = new Intl.PluralRules(locale).select(months);
  const key = plural === "one" ? "billingWizardMonthOne" : plural === "few" ? "billingWizardMonthFew" : plural === "many" ? "billingWizardMonthMany" : "billingWizardMonths";
  return t(key).replace("{{count}}", String(months));
}

export default function AccountBillingWizard({ organizationId, organizationName, locations, supportedMarkets = [], onSaveMarket, orders = [], ordersUnavailable = false, onRefreshOrders, onPaymentConfirmed, previewOnly = false }: Props) {
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
  const [pollingError, setPollingError] = useState("");
  const [pendingCheckoutConflict, setPendingCheckoutConflict] = useState(false);
  const [error, setError] = useState("");
  const [marketSelections, setMarketSelections] = useState<Record<string, string>>({});
  const [marketSaving, setMarketSaving] = useState<Record<string, boolean>>({});
  const [marketSaveErrors, setMarketSaveErrors] = useState<Record<string, string>>({});
  const [savedMarketIds, setSavedMarketIds] = useState<Record<string, boolean>>({});
  const [refreshedLocations, setRefreshedLocations] = useState<Record<string, BillingWizardLocation>>({});
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mutationLock = useRef(false);
  const paymentRefreshLock = useRef(false);
  const statusRequestLock = useRef(false);
  const statusRefreshRef = useRef<(() => Promise<void>) | null>(null);
  const paymentConfirmedRef = useRef(onPaymentConfirmed);
  paymentConfirmedRef.current = onPaymentConfirmed;

  const organizationLocations = useMemo(() => locations.filter((location) => location.organizationId === organizationId)
    .map((location) => refreshedLocations[location.id] ?? location), [locations, organizationId, refreshedLocations]);
  const selectedLines = organizationLocations.flatMap((location) => {
    const productId = selectedProducts[location.id];
    const product = location.products.find((candidate) => candidate.productId === productId);
    return product ? [{ location, product, months: durations[location.id] ?? 1 }] : [];
  });
  const matchingPendingOrder = orders.find((item) => canResumeBillingOrder(item.status) && item.lines.some((orderLine) =>
    selectedLines.some(({ location, product }) => location.id === orderLine.locationId && product.productId === orderLine.productId)));

  async function refreshPaymentStatus() {
    if (!order?.id || statusRequestLock.current) return;
    statusRequestLock.current = true;
    try {
      const response = await fetch(`/api/v2/customer/billing/orders/${encodeURIComponent(order.id)}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) { setPollingError(t("billingWizardStatusRefreshFailed")); return; }
      const current = await response.json() as Order;
      setPollingError(""); setOrder(current); setOrderStatus(current.status);
      if (current.status === "paid" && !paymentRefreshLock.current) {
        paymentRefreshLock.current = true;
        try { await paymentConfirmedRef.current?.(); } finally { setError(""); }
      }
    } catch { setPollingError(t("billingWizardStatusRefreshFailed")); }
    finally { statusRequestLock.current = false; }
  }
  statusRefreshRef.current = refreshPaymentStatus;

  useEffect(() => { setRefreshedLocations({}); }, [locations]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); dialog.querySelector<HTMLButtonElement>("[data-wizard-initial-focus]")?.focus(); }
    else if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  useEffect(() => {
    if (!open || !order?.id || !checkout || ["paid", "canceled", "expired", "failed"].includes(orderStatus)) return;
    void statusRefreshRef.current?.();
    const timer = window.setInterval(() => void statusRefreshRef.current?.(), 3000);
    return () => window.clearInterval(timer);
  }, [open, order?.id, orderStatus, checkout]);

  function reset() {
    setStep(1); setSelectedProducts({}); setDurations({}); setSelectionError(false);
    setQuote(null); setOrder(null); setCheckout(null); setOrderStatus(""); setPollingError(""); setPendingCheckoutConflict(false); setError(""); setCopied(false);
    setMarketSelections({}); setMarketSaveErrors({}); setSavedMarketIds({}); setRefreshedLocations({});
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
  function errorMessage(code: string, lineCount = selectedLines.length) {
    return t(billingOrderErrorKey(code, lineCount) as import("@/app/i18n/types").TranslationKey);
  }
  async function saveLocationMarket(location: BillingWizardLocation) {
    const marketCode = marketSelections[location.id];
    if (!marketCode || !onSaveMarket || marketSaving[location.id]) return;
    setMarketSaving((current) => ({ ...current, [location.id]: true }));
    setMarketSaveErrors((current) => ({ ...current, [location.id]: "" }));
    setSavedMarketIds((current) => ({ ...current, [location.id]: false }));
    try {
      const refreshed = await onSaveMarket(location.id, marketCode);
      if (refreshed.id !== location.id || refreshed.marketCode !== marketCode) throw new Error("market_refresh_failed");
      setRefreshedLocations((current) => ({ ...current, [location.id]: refreshed }));
      setMarketSelections((current) => { const next = { ...current }; delete next[location.id]; return next; });
      setSavedMarketIds((current) => ({ ...current, [location.id]: true }));
    } catch (saveError) {
      const code = saveError instanceof Error ? saveError.message : "unavailable";
      const message = ["unavailable", "market_refresh_failed"].includes(code) ? t("billingUnavailable") : errorMessage(code, 1);
      setMarketSaveErrors((current) => ({ ...current, [location.id]: message }));
    } finally {
      setMarketSaving((current) => ({ ...current, [location.id]: false }));
    }
  }
  async function requestQuote() {
    if (selectedLines.length === 0) { setSelectionError(true); return; }
    if (!canPreviewBillingLines(selectedLines.map(({ location }) => ({ marketCode: location.marketCode, selectedMarket: marketSelections[location.id] })))) {
      setError(t("billingWizardMarketsMustBeSaved")); return;
    }
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
    if (!canPreviewBillingLines(selectedLines.map(({ location }) => ({ marketCode: location.marketCode, selectedMarket: marketSelections[location.id] })))) {
      setError(t("billingWizardMarketsMustBeSaved")); setStep(1); return;
    }
    mutationLock.current = true; setBusy(true); setError(""); setPendingCheckoutConflict(false); setOrderStatus(t("billingWizardCreatingOrder"));
    try {
      let currentOrder = order;
      if (!currentOrder) {
        const response = await fetch("/api/v2/customer/billing/orders", {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId, lines: selectedLines.map(({ location, product, months }) => ({ locationId: location.id, productId: product.productId, durationMonths: months })) }),
        });
        const body = await response.json().catch(() => ({})) as { order?: Order; error?: string };
        if (!response.ok || !body.order) { setError(errorMessage(body.error ?? "unavailable")); setPendingCheckoutConflict(body.error === "checkout_pending"); setOrderStatus(""); await onRefreshOrders?.(); return; }
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
  async function resumeOrder(historyOrder: BillingOrderHistoryItem) {
    if (mutationLock.current || busy || !canResumeBillingOrder(historyOrder.status)) return;
    mutationLock.current = true; setBusy(true); setError(""); setPollingError(""); setOrderStatus(historyOrder.status);
    try {
      const response = await fetch(`/api/v2/customer/billing/orders/${encodeURIComponent(historyOrder.id)}/fake-checkout`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}",
      });
      const body = await response.json().catch(() => ({})) as Checkout & { error?: string };
      if (!response.ok || !body.checkoutUrl || !body.expiresAt || !body.currency) {
        setError(errorMessage(body.error ?? "unavailable", historyOrder.lines.length));
        await onRefreshOrders?.();
        return;
      }
      setOrder(historyOrder); setCheckout(body); setOrderStatus("pending"); setStep(3); setOpen(true);
    } catch { setError(t("billingUnavailable")); }
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
  const orderStatusLabel = (status: string) => t(billingOrderStatusKey(status) as import("@/app/i18n/types").TranslationKey);
  const displayOrderDate = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const lineIssue = (location: BillingWizardLocation, product: BillingWizardPlan) => !location.marketCode ? t("billingWizardMarketsMustBeSaved") : marketSelections[location.id] && marketSelections[location.id] !== location.marketCode ? t("billingWizardMarketUnsaved") : product.routes.length === 0 ? t("billingNoRoute") : "";
  return <>
    <details className="customer-billing-orders">
      <summary>{t("billingOrdersTitle")} <span>{orders.length}</span></summary>
      <div className="customer-billing-orders-content">
        <div className="customer-billing-orders-heading"><span>{t("billingOrdersTitle")}</span><button type="button" className="customer-billing-secondary" disabled={busy} onClick={() => void onRefreshOrders?.()}>{t("billingOrdersRefresh")}</button></div>
        {ordersUnavailable ? <p role="alert">{t("billingOrdersUnavailable")}</p> : orders.length === 0 ? <p>{t("billingOrdersEmpty")}</p> : <ul className="customer-billing-orders-list">{orders.map((item) => <li key={item.id}>
          <div><strong>{item.lines.map((line) => `${line.locationName} · ${line.productName}`).join(", ")}</strong><span>{orderStatusLabel(item.status)} · {formatAmount(item.totalAmountMinor, item.currency)}</span><small>{t("billingOrdersCreated").replace("{{date}}", displayOrderDate(item.createdAt))}</small>
            {item.status === "paid" && item.lines.map((line) => line.billingPeriodStartsAt && line.billingPeriodEndsAt ? <small key={line.id}>{line.locationName}: {t("billingPurchasedPeriod").replace("{{start}}", displayOrderDate(line.billingPeriodStartsAt)).replace("{{end}}", displayOrderDate(line.billingPeriodEndsAt))}</small> : null)}
          </div>
          {canResumeBillingOrder(item.status) && <button type="button" className="customer-auth-submit" disabled={busy} onClick={() => void resumeOrder(item)}>{t("billingOrdersContinue")}</button>}
        </li>)}</ul>}
      </div>
    </details>
    <button type="button" className="customer-billing-secondary customer-billing-wizard-open" onClick={begin}>{t("billingWizardOpen")}</button>
    <dialog ref={dialogRef} className="customer-billing-wizard-dialog customer-auth-card" aria-labelledby={`billing-wizard-title-${organizationId}`} onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => setOpen(false)} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <div className="customer-billing-wizard-header"><div><p className="customer-billing-wizard-eyebrow">{t("billingWizardOrganization")}</p><h2 id={`billing-wizard-title-${organizationId}`}>{t("billingWizardTitle")}</h2><p>{organizationName}</p></div><button data-wizard-initial-focus type="button" className="customer-billing-secondary" onClick={close} aria-label={t("billingWizardClose")}>×</button></div>
      <ol className="customer-billing-wizard-steps" aria-label={t("billingWizardProgress")}>{[1, 2, 3].map((item) => <li key={item} aria-current={step === item ? "step" : undefined} className={step === item ? "is-current" : step > item ? "is-complete" : ""}><span>{item}</span><span>{t(item === 1 ? "billingWizardStepSelect" : item === 2 ? "billingWizardStepReview" : "billingWizardStepLink")}</span></li>)}</ol>
      {step === 1 && <section className="customer-billing-wizard-content"><h3>{t("billingWizardStepSelect")}</h3>
        {organizationLocations.length === 0 ? <p role="status">{t("billingWizardNoLocations")}</p> : <div className="customer-billing-wizard-location-list">{organizationLocations.map((location) => {
          const checked = Boolean(selectedProducts[location.id]); const product = location.products.find((candidate) => candidate.productId === selectedProducts[location.id]); const issue = product ? lineIssue(location, product) : "";
          const selectionState = billingMarketSelectionState({ persistedMarket: location.marketCode, selectedMarket: marketSelections[location.id] ?? "", saving: Boolean(marketSaving[location.id]), error: marketSaveErrors[location.id] ?? "" });
          return <article className="customer-billing-wizard-location" key={location.id}><label className="customer-billing-wizard-check"><input type="checkbox" checked={checked} disabled={!location.products.length || busy} onChange={(event) => toggleLocation(location, event.target.checked)} /><span><strong>{location.name}</strong><small>{product ? statusLabel(product) : location.products.length ? t("billingWizardChooseProduct") : t("billingWizardNoEligibleProduct")}</small></span></label>
            {checked && product && <div className="customer-billing-wizard-line-controls">{location.products.length > 1 && <label>{t("billingWizardProduct")}<select disabled={busy} value={product.productId} onChange={(event) => updateSelection(() => setSelectedProducts((current) => ({ ...current, [location.id]: event.target.value })))}>{location.products.map((item) => <option key={item.productId} value={item.productId}>{item.productName}</option>)}</select></label>}
              <label>{t("billingWizardDuration")}<select disabled={busy} value={durations[location.id] ?? 1} onChange={(event) => updateSelection(() => setDurations((current) => ({ ...current, [location.id]: Number(event.target.value) })))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((months) => <option key={months} value={months}>{durationText(months, locale, t)}</option>)}</select></label>
              <p className="customer-billing-wizard-detail">{t("billingWizardPersistedMarket")}: <strong>{location.marketCode ?? t("billingWizardMarketNotSaved")}</strong></p>
              <label>{t("billingMarketLabel")}<select aria-label={`${t("billingMarketLabel")} · ${location.name}`} disabled={busy || Boolean(marketSaving[location.id]) || !onSaveMarket} value={marketSelections[location.id] ?? location.marketCode ?? ""} onChange={(event) => updateSelection(() => { setMarketSelections((current) => ({ ...current, [location.id]: event.target.value })); setMarketSaveErrors((current) => ({ ...current, [location.id]: "" })); setSavedMarketIds((current) => ({ ...current, [location.id]: false })); })}><option value="">—</option>{supportedMarkets.map((market) => <option key={market} value={market}>{market}</option>)}</select></label>
              {selectionState === "unsaved" && <button type="button" className="customer-billing-secondary" disabled={busy || Boolean(marketSaving[location.id]) || !marketSelections[location.id] || !onSaveMarket} onClick={() => void saveLocationMarket(location)}>{marketSaving[location.id] ? t("billingWizardMarketSaving") : t("billingWizardMarketSave")}</button>}
              {selectionState === "unsaved" && <p className="customer-billing-wizard-warning" role="status">{t("billingWizardMarketUnsaved")}</p>}
              {selectionState === "saving" && <p className="customer-billing-wizard-detail" role="status">{t("billingWizardMarketSaving")}</p>}
              {selectionState === "error" && <p className="customer-onboarding-error" role="alert">{marketSaveErrors[location.id]}</p>}
              {!supportedMarkets.length && <p className="customer-billing-wizard-warning" role="status">{t("billingMarketUnavailable")}</p>}
              {savedMarketIds[location.id] && selectionState === "saved" && <p className="customer-billing-wizard-detail" role="status">{t("billingWizardMarketSaved")}</p>}
              {issue && <p className="customer-billing-wizard-warning" role="status">{issue}</p>}</div>}
          </article>;
        })}</div>}
        {selectionError && <p className="customer-onboarding-error" role="alert">{t("billingWizardSelectAtLeastOne")}</p>}
      </section>}
      {step === 2 && quote && <section className="customer-billing-wizard-content"><h3>{t("billingWizardStepReview")}</h3><p><strong>{organizationName}</strong></p>
        <ul className="customer-billing-wizard-review">{quote.lines.map((line) => <li key={line.locationId}><strong>{line.locationName}</strong><span>{line.productName} · {durationText(line.durationMonths, locale, t)}</span><span>{previewOnly ? t("billingWizardQuoteUnavailable") : formatAmount(line.amountMinor, quote.currency)}</span></li>)}</ul>
        <div className="customer-billing-wizard-total"><span>{t("billingWizardTotal")}</span><strong>{previewOnly ? t("billingWizardQuoteUnavailable") : formatAmount(quote.totalAmountMinor, quote.currency)}</strong></div>
        <p className="customer-billing-wizard-note">{previewOnly ? t("billingWizardPreviewOnly") : t("billingWizardPrepaidNotice")}</p>
      </section>}
      {step === 3 && previewOnly && <section className="customer-billing-wizard-content"><h3>{t("billingWizardStepLink")}</h3><div className="customer-billing-wizard-total"><span>{t("billingWizardTotal")}</span><strong>{t("billingWizardQuoteUnavailable")}</strong></div><p className="customer-billing-wizard-note" role="status">{t("billingWizardPreviewOnly")}</p></section>}
      {step === 3 && checkout && order && <section className="customer-billing-wizard-content"><h3>{t("billingWizardStepLink")}</h3>
        <ul className="customer-billing-wizard-review">{order.lines.map((line) => <li key={line.locationId}><strong>{line.locationName}</strong><span>{line.productName} · {durationText(line.durationMonths, locale, t)}</span><span>{formatAmount(line.amountMinor, order.currency)}</span></li>)}</ul>
        <div className="customer-billing-wizard-total"><span>{t("billingWizardTotal")}</span><strong>{formatAmount(order.totalAmountMinor, order.currency)}</strong></div>
        <dl className="customer-billing-wizard-link-details"><dt>{t("billingWizardPaymentStatus")}</dt><dd>{orderStatusLabel(orderStatus || order.status)}</dd><dt>{t("billingWizardExpiry")}</dt><dd>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(checkout.expiresAt))}</dd><dt>{t("billingWizardPaymentLink")}</dt><dd><a href={checkout.checkoutUrl} target="_blank" rel="noopener noreferrer">{t("billingWizardOpenCheckout")}</a></dd></dl>
        <p>{checkout.providerName}</p><p className="customer-billing-wizard-note" role="status">{orderStatus === "paid" ? t("billingWizardPaymentConfirmed") : orderStatus === "expired" ? t("billingWizardOrderExpired") : orderStatus === "canceled" ? t("billingWizardOrderCanceled") : orderStatus === "failed" ? t("billingOrderFailed") : t("billingWizardAwaitingPayment")}</p>
        <div className="customer-billing-wizard-link-actions"><a className="customer-auth-submit" href={checkout.checkoutUrl} target="_blank" rel="noopener noreferrer">{t("billingWizardOpenCheckout")}</a><button type="button" className="customer-billing-secondary" onClick={() => void copyLink()}>{copied ? t("deviceLinkCopied") : t("billingWizardCopyLink")}</button><button type="button" className="customer-billing-secondary" onClick={() => void statusRefreshRef.current?.()}>{t("billingWizardRefreshStatus")}</button></div>
        {pollingError && <p role="alert" className="customer-onboarding-error">{pollingError}</p>}
      </section>}
      {orderStatus && step < 3 && <p role="status" className="customer-billing-wizard-note">{orderStatus}</p>}
      {error && <p className="customer-onboarding-error" role="alert">{error}</p>}
      {pendingCheckoutConflict && matchingPendingOrder && <button type="button" className="customer-auth-submit" disabled={busy} onClick={() => void resumeOrder(matchingPendingOrder)}>{t("billingOrdersContinue")}</button>}
      <div className="customer-billing-wizard-actions">{step === 2 && <button type="button" className="customer-billing-secondary" disabled={busy} onClick={() => { setStep(1); setError(""); }}>{t("billingWizardBack")}</button>}
        {step === 1 && !previewOnly && <button type="button" className="customer-auth-submit" disabled={busy || selectedLines.length === 0 || !canPreviewBillingLines(selectedLines.map(({ location }) => ({ marketCode: location.marketCode, selectedMarket: marketSelections[location.id] })))} onClick={() => void requestQuote()}>{busy ? t("billingLoading") : t("billingWizardGetQuote")}</button>}
        {step === 1 && previewOnly && <button type="button" className="customer-auth-submit" disabled={selectedLines.length === 0} onClick={() => { setSelectionError(selectedLines.length === 0); if (selectedLines.length) { setQuote({ currency: "USD", totalAmountMinor: "0", lines: selectedLines.map(({ location, product, months }) => ({ locationId: location.id, locationName: location.name, productId: product.productId, productName: product.productName, durationMonths: months, amountMinor: "0" })) }); setStep(2); } }}>{t("billingWizardContinue")}</button>}
        {step === 2 && !previewOnly && <button type="button" className="customer-auth-submit" disabled={busy || !quote} onClick={() => void createOrderAndCheckout()}>{busy ? t("billingLoading") : t("billingWizardConfirmOrder")}</button>}
        {step === 2 && previewOnly && <button type="button" className="customer-auth-submit" onClick={() => setStep(3)}>{t("billingWizardContinue")}</button>}
        {step < 3 && <button type="button" className="customer-billing-secondary" onClick={close}>{t("billingWizardClose")}</button>}
      {step === 3 && <><button type="button" className="customer-billing-secondary" onClick={() => { reset(); setOpen(true); }}>{t("billingWizardNewOrder")}</button><button type="button" className="customer-billing-secondary" onClick={close}>{t("billingClose")}</button></>}
      </div>
    </dialog>
  </>;
}

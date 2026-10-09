"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";

export type BillingWizardPlan = {
  productId: string;
  productName: string;
  status: "trial" | "subscription" | "partner" | "expired" | "available";
  trialEndsAt: string | null;
  paidThrough: string | null;
  subscriptionId: string | null;
  subscriptionCanceled: boolean;
  routes: { id: string; providerName: string }[];
};

export type BillingWizardLocation = {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  timezone: string;
  marketCode: string | null;
  products: BillingWizardPlan[];
};

type Props = {
  organizationId: string;
  organizationName: string;
  locations: BillingWizardLocation[];
};

type WizardStep = 1 | 2 | 3;

export default function AccountBillingWizard({ organizationId, organizationName, locations }: Props) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedProducts, setSelectedProducts] = useState<Record<string, string>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [selectionError, setSelectionError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const organizationLocations = useMemo(
    () => locations.filter((location) => location.organizationId === organizationId),
    [locations, organizationId],
  );
  const selectedLines = organizationLocations.flatMap((location) => {
    const productId = selectedProducts[location.id];
    const product = location.products.find((candidate) => candidate.productId === productId);
    return product ? [{ location, product, months: durations[location.id] ?? 1 }] : [];
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-wizard-initial-focus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  function begin() {
    setStep(1);
    setSelectedProducts({});
    setDurations({});
    setSelectionError(false);
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function toggleLocation(location: BillingWizardLocation, checked: boolean) {
    setSelectionError(false);
    if (!checked) {
      setSelectedProducts((current) => {
        const next = { ...current };
        delete next[location.id];
        return next;
      });
      return;
    }
    const firstProduct = location.products[0];
    if (!firstProduct) return;
    setSelectedProducts((current) => ({ ...current, [location.id]: current[location.id] ?? firstProduct.productId }));
  }

  function nextStep() {
    if (step === 1 && selectedLines.length === 0) {
      setSelectionError(true);
      return;
    }
    setSelectionError(false);
    setStep((current) => (current < 3 ? (current + 1) as WizardStep : current));
  }

  const statusLabel = (product: BillingWizardPlan) => {
    if (product.status === "trial") return t("billingTrial");
    if (product.status === "subscription") return product.subscriptionCanceled ? t("billingCanceled") : t("billingSubscription");
    if (product.status === "partner") return t("billingPartnerStatus");
    if (product.status === "expired") return t("billingExpired");
    return t("billingAvailable");
  };
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const lineIssue = (location: BillingWizardLocation, product: BillingWizardPlan) => {
    if (!location.marketCode) return t("billingMarketMissing");
    if (product.routes.length === 0) return t("billingNoRoute");
    return "";
  };

  return <>
    <button type="button" className="customer-auth-submit customer-billing-wizard-open" onClick={begin}>
      {t("billingWizardOpen")}
    </button>
    <dialog
      ref={dialogRef}
      className="customer-billing-wizard-dialog customer-auth-card"
      aria-labelledby={`billing-wizard-title-${organizationId}`}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClose={() => setOpen(false)}
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="customer-billing-wizard-header">
        <div>
          <p className="customer-billing-wizard-eyebrow">{t("billingWizardOrganization")}</p>
          <h2 id={`billing-wizard-title-${organizationId}`}>{t("billingWizardTitle")}</h2>
          <p>{organizationName}</p>
        </div>
        <button data-wizard-initial-focus type="button" className="customer-billing-secondary" onClick={close} aria-label={t("billingWizardClose")}>×</button>
      </div>

      <ol className="customer-billing-wizard-steps" aria-label={t("billingWizardProgress")}>
        {[1, 2, 3].map((item) => <li key={item} aria-current={step === item ? "step" : undefined} className={step === item ? "is-current" : step > item ? "is-complete" : ""}>
          <span>{item}</span><span>{t(item === 1 ? "billingWizardStepSelect" : item === 2 ? "billingWizardStepReview" : "billingWizardStepLink")}</span>
        </li>)}
      </ol>

      {step === 1 && <section className="customer-billing-wizard-content" aria-labelledby={`billing-wizard-step-${organizationId}`}>
        <h3 id={`billing-wizard-step-${organizationId}`}>{t("billingWizardStepSelect")}</h3>
        {organizationLocations.length === 0 ? <p role="status">{t("billingWizardNoLocations")}</p> : <div className="customer-billing-wizard-location-list">
          {organizationLocations.map((location) => {
            const checked = Boolean(selectedProducts[location.id]);
            const selectedProduct = location.products.find((product) => product.productId === selectedProducts[location.id]);
            const issue = selectedProduct ? lineIssue(location, selectedProduct) : "";
            return <article className="customer-billing-wizard-location" key={location.id}>
              <label className="customer-billing-wizard-check">
                <input type="checkbox" checked={checked} disabled={location.products.length === 0} onChange={(event) => toggleLocation(location, event.target.checked)} />
                <span><strong>{location.name}</strong><small>{selectedProduct ? statusLabel(selectedProduct) : location.products.length ? t("billingWizardChooseProduct") : t("billingWizardNoEligibleProduct")}</small></span>
              </label>
              {checked && selectedProduct && <div className="customer-billing-wizard-line-controls">
                {location.products.length > 1 && <label>{t("billingWizardProduct")}<select value={selectedProduct.productId} onChange={(event) => setSelectedProducts((current) => ({ ...current, [location.id]: event.target.value }))}>
                  {location.products.map((product) => <option key={product.productId} value={product.productId}>{product.productName}</option>)}
                </select></label>}
                <label>{t("billingWizardDuration")}<select value={durations[location.id] ?? 1} onChange={(event) => setDurations((current) => ({ ...current, [location.id]: Number(event.target.value) }))}>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((months) => <option key={months} value={months}>{t("billingWizardMonths").replace("{{count}}", String(months))}</option>)}
                </select></label>
                {selectedProduct.paidThrough && <p className="customer-billing-wizard-detail">{t("billingPaidThrough").replace("{{date}}", formatDate(selectedProduct.paidThrough))}</p>}
                {selectedProduct.status === "trial" && selectedProduct.trialEndsAt && <p className="customer-billing-wizard-detail">{t("billingTrialEnds").replace("{{date}}", formatDate(selectedProduct.trialEndsAt))}</p>}
                {selectedProduct.status === "partner" && <p className="customer-billing-wizard-detail">{t("billingWizardPartnerUnchanged")}</p>}
                <p className="customer-billing-wizard-price">{t("billingWizardPriceUnavailable")}</p>
                {issue && <p className="customer-billing-wizard-warning" role="status">{issue}</p>}
              </div>}
            </article>;
          })}
        </div>}
        <div className="customer-billing-wizard-total"><span>{t("billingWizardTotal")}</span><strong>{t("billingWizardQuoteUnavailable")}</strong></div>
        <p>{t("billingWizardRouteCompatibility")}</p>
        <p className="customer-billing-wizard-note" role="status">{t("billingWizardPreviewOnly")}</p>
        {selectionError && <p className="customer-onboarding-error" role="alert">{t("billingWizardSelectAtLeastOne")}</p>}
      </section>}

      {step === 2 && <section className="customer-billing-wizard-content">
        <h3>{t("billingWizardStepReview")}</h3>
        <p><strong>{organizationName}</strong></p>
        <ul className="customer-billing-wizard-review">
          {selectedLines.map(({ location, product, months }) => <li key={location.id}>
            <strong>{location.name}</strong><span>{product.productName} · {t("billingWizardMonths").replace("{{count}}", String(months))}</span>
            <span>{t("billingWizardPriceUnavailable")}</span>
            {product.status === "partner" && <span>{t("billingWizardPartnerUnchanged")}</span>}
          </li>)}
        </ul>
        <div className="customer-billing-wizard-total"><span>{t("billingWizardTotal")}</span><strong>{t("billingWizardQuoteUnavailable")}</strong></div>
        <p className="customer-billing-wizard-note">{t("billingWizardPrepaidNotice")}</p>
        <p>{t("billingWizardPreviewOnly")}</p>
      </section>}

      {step === 3 && <section className="customer-billing-wizard-content">
        <h3>{t("billingWizardStepLink")}</h3>
        <div className="customer-billing-wizard-total"><span>{t("billingWizardTotal")}</span><strong>{t("billingWizardQuoteUnavailable")}</strong></div>
        <dl className="customer-billing-wizard-link-details">
          <dt>{t("billingWizardPaymentStatus")}</dt><dd>{t("billingWizardNotCreated")}</dd>
          <dt>{t("billingWizardExpiry")}</dt><dd>{t("billingWizardUnavailable")}</dd>
          <dt>{t("billingWizardPaymentLink")}</dt><dd className="is-placeholder">{t("billingWizardNoLink")}</dd>
        </dl>
        <p className="customer-billing-wizard-note" role="status">{t("billingWizardPreviewOnly")}</p>
        <button type="button" className="customer-billing-secondary" disabled>{t("billingWizardCopyLink")}</button>
      </section>}

      <div className="customer-billing-wizard-actions">
        {step > 1 && <button type="button" className="customer-billing-secondary" onClick={() => setStep((current) => (current - 1) as WizardStep)}>{t("billingWizardBack")}</button>}
        {step < 3
          ? <button type="button" className="customer-auth-submit" onClick={nextStep}>{t("billingWizardContinue")}</button>
          : <button type="button" className="customer-auth-submit" onClick={close}>{t("billingWizardClose")}</button>}
        <button type="button" className="customer-billing-secondary" onClick={close}>{t("billingWizardClose")}</button>
      </div>
    </dialog>
  </>;
}

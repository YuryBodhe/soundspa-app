"use client";

import { AuthLanguageSelector } from "@/app/auth/AuthLanguageSelector";
import AccountBillingWizard, { type BillingWizardLocation } from "@/app/account/AccountBillingWizard";
import { useI18n } from "@/app/i18n/I18nProvider";

const organizationId = "00000000-0000-4000-8000-000000000631";
const organizationName = "Preview · North Shore Wellness & Spa Group with a deliberately long organization name";
const previewLocations: BillingWizardLocation[] = [
  {
    id: "00000000-0000-4000-8000-000000000632", organizationId, organizationName,
    name: "Preview · North Shore flagship wellness salon and spa location",
    timezone: "Europe/Moscow", marketCode: "RU",
    products: [
      { productId: "product-basic", productName: "SoundSpa Basic", status: "subscription", trialEndsAt: null, paidThrough: "2027-01-15T00:00:00.000Z", subscriptionId: "preview-subscription", subscriptionCanceled: false, routes: [{ id: "route-ru", providerName: "Preview payment route" }] },
      { productId: "product-divnitsa", productName: "Divnitsa", status: "available", trialEndsAt: null, paidThrough: null, subscriptionId: null, subscriptionCanceled: false, routes: [{ id: "route-ru-divnitsa", providerName: "Preview payment route" }] },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000633", organizationId, organizationName,
    name: "Preview · Riverside salon", timezone: "Asia/Ho_Chi_Minh", marketCode: "RU",
    products: [
      { productId: "product-basic-trial", productName: "SoundSpa Basic", status: "trial", trialEndsAt: "2026-12-10T00:00:00.000Z", paidThrough: null, subscriptionId: null, subscriptionCanceled: false, routes: [{ id: "route-ru-trial", providerName: "Preview payment route" }] },
      { productId: "product-spaquatoria", productName: "Spaquatoria", status: "partner", trialEndsAt: null, paidThrough: null, subscriptionId: null, subscriptionCanceled: false, routes: [{ id: "route-ru-partner", providerName: "Preview payment route" }] },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000634", organizationId, organizationName,
    name: "Preview · Lakeside salon with missing market and unavailable route",
    timezone: "Asia/Bangkok", marketCode: null,
    products: [
      { productId: "product-basic-expired", productName: "SoundSpa Basic", status: "expired", trialEndsAt: null, paidThrough: null, subscriptionId: null, subscriptionCanceled: false, routes: [] },
      { productId: "product-divnitsa-unavailable", productName: "Divnitsa", status: "available", trialEndsAt: null, paidThrough: null, subscriptionId: null, subscriptionCanceled: false, routes: [] },
    ],
  },
];

export default function BillingWizardPreviewClient() {
  const { t } = useI18n();
  const emptyOrganizationId = "00000000-0000-4000-8000-000000000635";
  return <main className="customer-auth-page customer-billing-preview-page">
    <section className="customer-auth-card customer-onboarding-card customer-billing-preview-card">
      <div className="customer-auth-top"><span className="customer-auth-brand">SOUND SPA</span><AuthLanguageSelector /></div>
      <p className="customer-billing-preview-banner" role="status">{t("billingWizardPreviewBanner")}</p>
      <h1>{t("billingWizardTitle")}</h1>
      <section className="customer-account-organization">
        <h2>{organizationName}</h2>
        <AccountBillingWizard organizationId={organizationId} organizationName={organizationName} locations={previewLocations} previewOnly />
      </section>
      <section className="customer-account-organization">
        <h2>{t("billingWizardEmptyPreviewLabel")}</h2>
        <AccountBillingWizard organizationId={emptyOrganizationId} organizationName={t("billingWizardEmptyPreviewLabel")} locations={[]} previewOnly />
      </section>
    </section>
  </main>;
}

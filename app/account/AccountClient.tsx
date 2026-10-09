"use client";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { I18nProvider, useI18n } from "@/app/i18n/I18nProvider";
import type { TranslationKey } from "@/app/i18n/types";
import { AuthLanguageSelector } from "../auth/AuthLanguageSelector";
import AccountBillingWizard from "./AccountBillingWizard";
import { trialCountdown, trialDaysMessageKey } from "@/lib/v2/customerOnboarding";

type Account = {
  email: string;
  emailVerifiedAt: string;
  organization: { id: string; name: string } | null;
  location: { id: string; name: string; slug: string; timezone: string } | null;
  trial: { status: string; startsAt: string; endsAt: string } | null;
};
type CustomerLocation = {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  timezone: string;
  devices: Array<{
    label: string | null;
    state: "active" | "revoked";
    activationState: "awaiting" | "activated" | "expired" | "revoked";
    createdAt: string;
  }>;
};
type LoadResult = { account: Account | null; partnerContext: boolean; partnerCompleted?: boolean; locations?: CustomerLocation[] };
type ActivationLink = { locationId: string; url: string; expiresAt: string };
type BillingPlan = {
  productId: string; productName: string;
  status: "trial" | "subscription" | "partner" | "expired" | "available";
  trialEndsAt: string | null; paidThrough: string | null; subscriptionId: string | null;
  subscriptionCanceled: boolean; routes: { id: string; providerName: string }[];
};
type BillingLocation = {
  id: string; organizationId: string; organizationName: string; name: string; timezone: string;
  marketCode: string | null; products: BillingPlan[];
};
type BillingSummary = { locations: BillingLocation[]; supportedMarkets: string[] };
type FakeCheckout = {
  confirmationToken: string; expiresAt: string; amountMinor: number; currency: string;
  providerName: string; phase: "checkout" | "done";
};

function Content() {
  const { locale, t } = useI18n();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [connectingLocationId, setConnectingLocationId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [deviceSaving, setDeviceSaving] = useState(false);
  const deviceSubmitLock = useRef(false);
  const [deviceError, setDeviceError] = useState("");
  const [activationLink, setActivationLink] = useState<ActivationLink | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [billingUnavailable, setBillingUnavailable] = useState(false);
  const [selectedBilling, setSelectedBilling] = useState<{ location: BillingLocation; plan: BillingPlan } | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [fakeCheckout, setFakeCheckout] = useState<FakeCheckout | null>(null);
  const [billingError, setBillingError] = useState("");
  const [billingNotice, setBillingNotice] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  const [marketChoices, setMarketChoices] = useState<Record<string, string>>({});
  const [marketSavingId, setMarketSavingId] = useState<string | null>(null);
  const billingCloseRef = useRef<HTMLButtonElement>(null);

  async function load() {
    try {
      const [response, billingResponse] = await Promise.all([
        fetch("/api/v2/customer/onboarding", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/v2/customer/billing", { cache: "no-store", credentials: "same-origin" }),
      ]);
      if (response.ok) setResult(await response.json() as LoadResult);
      else setResult(null);
      if (billingResponse.ok) {
        setBilling(await billingResponse.json() as BillingSummary);
        setBillingUnavailable(false);
      } else {
        setBilling(null);
        setBillingUnavailable(billingResponse.status !== 404 && billingResponse.status !== 401);
      }
    } catch { setResult(null); }
    finally { setLoaded(true); }
  }

  function openBilling(location: BillingLocation, plan: BillingPlan) {
    setSelectedBilling({ location, plan });
    setSelectedRouteId(plan.routes[0]?.id ?? "");
    setFakeCheckout(null);
    setBillingError("");
    setBillingNotice("");
  }

  function billingErrorKey(code: string): TranslationKey {
    if (code === "unauthenticated" || code === "unauthenticated_or_unverified") return "billingUnauthorized";
    if (code === "not_authorized") return "billingUnauthorized";
    if (code === "market_not_configured") return "billingMarketMissing";
    if (code === "market_unavailable") return "billingMarketUnavailable";
    if (code === "route_unavailable" || code === "product_unavailable") return "billingNoRoutes";
    if (code === "checkout_pending") return "billingCheckoutPending";
    if (code === "checkout_expired") return "billingCheckoutExpired";
    if (code === "provider_not_configured" || code === "unavailable") return "billingProviderUnavailable";
    return "billingPaymentFailed";
  }

  async function saveMarket(locationId: string) {
    const marketCode = marketChoices[locationId];
    if (!marketCode) return;
    setBillingError(""); setBillingNotice(""); setMarketSavingId(locationId);
    try {
      const response = await fetch("/api/v2/customer/billing/market", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId, marketCode }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setBillingError(t(billingErrorKey(body.error ?? "unavailable"))); return; }
      setBillingNotice(t("billingMarketSaved"));
      await load();
    } catch { setBillingError(t("billingUnavailable")); }
    finally { setMarketSavingId(null); }
  }

  async function beginCheckout() {
    if (!selectedBilling || !selectedRouteId) return;
    setBillingBusy(true); setBillingError("");
    try {
      const response = await fetch("/api/v2/customer/payments/fake/checkout", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId: selectedBilling.location.id, productId: selectedBilling.plan.productId, routeId: selectedRouteId }),
      });
      const body = await response.json().catch(() => ({})) as Partial<FakeCheckout> & { error?: string };
      if (!response.ok || !body.confirmationToken || !body.currency || !Number.isSafeInteger(body.amountMinor) || !body.expiresAt || !body.providerName) {
        setBillingError(t(billingErrorKey(body.error ?? "unavailable"))); return;
      }
      setFakeCheckout({ confirmationToken: body.confirmationToken, expiresAt: body.expiresAt, amountMinor: body.amountMinor!, currency: body.currency, providerName: body.providerName, phase: "checkout" });
    } catch { setBillingError(t("billingUnavailable")); }
    finally { setBillingBusy(false); }
  }

  async function confirmCheckout() {
    if (!fakeCheckout) return;
    setBillingBusy(true); setBillingError("");
    try {
      const response = await fetch("/api/v2/customer/payments/fake/confirm", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmationToken: fakeCheckout.confirmationToken }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setBillingError(t(billingErrorKey(body.error ?? "unavailable"))); return; }
      await load();
      setFakeCheckout((current) => current ? { ...current, phase: "done" } : null);
      setBillingNotice(t("billingPaymentDone"));
    } catch { setBillingError(t("billingPaymentFailed")); }
    finally { setBillingBusy(false); }
  }

  async function cancelSubscription(subscriptionId: string) {
    setBillingBusy(true); setBillingError(""); setBillingNotice("");
    try {
      const response = await fetch("/api/v2/customer/payments/fake/cancel", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setBillingError(t(billingErrorKey(body.error ?? "unavailable"))); return; }
      await load();
      setBillingNotice(t("billingCancellationDone"));
      setSelectedBilling(null);
    } catch { setBillingError(t("billingUnavailable")); }
    finally { setBillingBusy(false); }
  }
  useEffect(() => {
    void load();
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      new Intl.DateTimeFormat("en-US", { timeZone: detected }).format(0);
      setTimezone(detected);
    } catch { setTimezone(""); }
  }, []);
  useEffect(() => {
    if (!selectedBilling) return;
    billingCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !billingBusy) { setSelectedBilling(null); setFakeCheckout(null); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedBilling, billingBusy]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const response = await fetch("/api/v2/customer/onboarding", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationName, locationName, timezone }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        const errorKey = body.error === "invalid_details" ? "onboardingInvalid"
          : body.error === "partner_context" ? "partnerInvitePending"
          : body.error === "partner_invite_unavailable" ? "partnerInviteUnavailable"
            : body.error === "partner_claim_failure" ? "partnerClaimFailure"
            : body.error === "partner_invite_ambiguous" ? "partnerInviteAmbiguous"
              : body.error === "existing_organization" ? "existingOrganization" : "onboardingUnavailable";
        setError(t(errorKey));
        if (body.error === "partner_context") await load();
        return;
      }
      const completed = await response.json() as { account: Account; partnerCompleted?: boolean; locations?: CustomerLocation[] };
      setResult({ account: completed.account, partnerContext: false, partnerCompleted: completed.partnerCompleted, locations: completed.locations ?? [] });
    } catch { setError(t("onboardingUnavailable")); }
    finally { setSaving(false); }
  }

  async function createDevice(event: FormEvent<HTMLFormElement>, location: CustomerLocation) {
    event.preventDefault();
    if (deviceSubmitLock.current) return;
    const name = deviceName.trim();
    if (!name || name.length > 120) { setDeviceError(t("deviceNameRequired")); return; }
    deviceSubmitLock.current = true;
    setDeviceSaving(true); setDeviceError(""); setActivationLink(null); setLinkCopied(false);
    try {
      const response = await fetch("/api/v2/customer/devices", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId: location.id, deviceName: name }),
      });
      const body = await response.json().catch(() => null) as { activationUrl?: string; expiresAt?: string; error?: string } | null;
      if (!response.ok || !body?.activationUrl || !body.expiresAt) {
        const errorKey = body?.error === "unauthenticated" ? "deviceAuthRequired"
          : body?.error === "unverified" ? "deviceEmailUnverified"
            : body?.error === "location_unavailable" ? "deviceLocationUnavailable"
              : body?.error === "invalid" ? "deviceNameRequired" : "deviceProvisioningFailed";
        setDeviceError(t(errorKey));
        return;
      }
      setActivationLink({ locationId: location.id, url: body.activationUrl, expiresAt: body.expiresAt });
      setConnectingLocationId(null); setDeviceName("");
      void load();
    } catch { setDeviceError(t("deviceProvisioningFailed")); }
    finally { deviceSubmitLock.current = false; setDeviceSaving(false); }
  }

  async function copyActivationLink() {
    if (!activationLink) return;
    try { await navigator.clipboard.writeText(activationLink.url); setLinkCopied(true); }
    catch { setDeviceError(t("deviceCopyFailed")); }
  }

  async function logout() { await fetch("/api/v2/customer-auth/logout", { method: "POST" }); window.location.assign("/login"); }
  const account = result?.account;
  const complete = Boolean(account?.organization && account.location);
  const trialDisplay = account?.trial ? trialCountdown(account.trial) : { key: "trialEnded" as const };
  const trialKey = trialDisplay.key === "trialDays" ? trialDaysMessageKey(locale, trialDisplay.days ?? 0) : trialDisplay.key;
  const trialStatus = t(trialKey).replace("{{days}}", String(trialDisplay.days ?? ""));
  const displayDate = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const billingStatusText = (plan: BillingPlan) => {
    if (plan.status === "trial") {
      if (!plan.trialEndsAt) return t("billingTrial");
      const countdown = trialCountdown({ status: "active", startsAt: "1970-01-01T00:00:00.000Z", endsAt: plan.trialEndsAt });
      const key = countdown.key === "trialDays" ? trialDaysMessageKey(locale, countdown.days ?? 0) : countdown.key;
      return `${t("billingTrial")}: ${t(key).replace("{{days}}", String(countdown.days ?? ""))}`;
    }
    if (plan.status === "subscription") return plan.subscriptionCanceled
      ? `${t("billingCanceled")}${plan.paidThrough ? ` ${t("billingPaidThrough").replace("{{date}}", displayDate(plan.paidThrough))}` : ""}`
      : plan.paidThrough ? t("billingPaidThrough").replace("{{date}}", displayDate(plan.paidThrough)) : t("billingSubscription");
    if (plan.status === "partner") return t("billingPartnerStatus");
    return t(plan.status === "expired" ? "billingExpired" : "billingAvailable");
  };
  const actionText = (plan: BillingPlan) => plan.status === "trial" || plan.status === "available" || plan.status === "partner"
    ? t("billingSubscribe") : plan.status === "subscription" ? t("billingManage") : t("billingRenew");
  const locationGroups = new Map<string, { organizationName: string; locations: CustomerLocation[] }>();
  for (const location of result?.locations ?? []) {
    const group = locationGroups.get(location.organizationId) ?? { organizationName: location.organizationName, locations: [] };
    group.locations.push(location); locationGroups.set(location.organizationId, group);
  }

  return <main className="customer-auth-page"><section className="customer-auth-card customer-onboarding-card"><div className="customer-auth-top"><span className="customer-auth-brand">SOUND SPA</span><AuthLanguageSelector /></div>
    <h1>{t("authAccountTitle")}</h1>
    {!loaded ? <p>{t("authSending")}</p> : !account ? <><p>{t("authSignInRequired")}</p><Link href="/login">{t("authLoginLink")}</Link></> : <>
      <p>{t("authEmailVerified")}: <strong>{account.email}</strong></p>
      {complete ? <>
        {result?.partnerContext && <p role="status">{t("existingOrganization")}</p>}
        <p>{result?.partnerCompleted ? t("partnerSetupCompleted") : t("onboardingCompleted")}</p>
        <dl className="customer-account-details">
          {account.trial && <><dt>{t("trialLabel")}</dt><dd>{trialStatus}</dd></>}
        </dl>
        {[...locationGroups.entries()].map(([organizationId, group]) => <section className="customer-account-organization" key={organizationId}>
          <h2>{group.organizationName}</h2>
          {billing && <AccountBillingWizard
            organizationId={organizationId}
            organizationName={group.organizationName}
            locations={billing.locations.filter((location) => location.organizationId === organizationId)}
            onPaymentConfirmed={load}
          />}
          {group.locations.map((location) => <section className="customer-account-location" key={location.id}>
            <h3>{location.name}</h3><p>{location.timezone}</p>
            {billing && (() => {
              const billingLocation = billing.locations.find((item) => item.id === location.id);
              if (!billingLocation) return null;
              return <section className="customer-billing-location" aria-label={t("billingTitle")}>
                <h4>{t("billingTitle")}</h4>
                <p className="customer-billing-market-help">{t("billingMarketHelp")}</p>
                <div className="customer-billing-market">
                  <label>{t("billingMarketLabel")}<select value={marketChoices[location.id] ?? billingLocation.marketCode ?? ""} onChange={(event) => setMarketChoices((current) => ({ ...current, [location.id]: event.target.value }))}>
                    <option value="">—</option>
                    {billing.supportedMarkets.map((market) => <option key={market} value={market}>{market}</option>)}
                  </select></label>
                  {marketChoices[location.id] && marketChoices[location.id] !== billingLocation.marketCode && <button type="button" className="customer-auth-submit customer-billing-market-save" disabled={marketSavingId === location.id} onClick={() => void saveMarket(location.id)}>{marketSavingId === location.id ? t("billingCanceling") : t("billingMarketSave")}</button>}
                </div>
                {billingLocation.products.length > 0 && <div className="customer-billing-plans">
                  {billingLocation.products.map((plan) => <article className="customer-billing-plan" key={plan.productId}>
                    <div><strong>{plan.productName}</strong><p>{billingStatusText(plan)}</p></div>
                    <button type="button" className="customer-auth-submit customer-billing-action" disabled={!billingLocation.marketCode || plan.routes.length === 0} onClick={() => openBilling(billingLocation, plan)}>{actionText(plan)}</button>
                    {!billingLocation.marketCode && <p className="customer-billing-inline-help">{t("billingMarketMissing")}</p>}
                    {billingLocation.marketCode && plan.routes.length === 0 && <p className="customer-billing-inline-help">{t("billingNoRoute")}</p>}
                  </article>)}
                </div>}
              </section>;
            })()}
            <h4>{t("customerDevices")}</h4>
            {location.devices.length ? <ul className="customer-account-devices">{location.devices.map((device, index) => <li key={`${device.createdAt}-${index}`}>
              <span>{device.label || t("deviceUnnamed")}</span>
              {device.state === "revoked" ? <span>{t("deviceRevoked")}</span> : <><span>{t("deviceActive")}</span><span>{t(device.activationState === "activated" ? "deviceActivated" : device.activationState === "awaiting" ? "deviceAwaitingActivation" : "deviceActivationExpired")}</span></>}
            </li>)}</ul> : <p>{t("deviceNoDevices")}</p>}
            {connectingLocationId === location.id ? <form onSubmit={(event) => void createDevice(event, location)}>
              <label>{t("deviceNameLabel")}<input required maxLength={120} value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
              {deviceError && <p role="alert">{deviceError}</p>}
              <button className="customer-auth-submit" type="submit" disabled={deviceSaving}>{deviceSaving ? t("deviceCreating") : t("deviceCreateLink")}</button>
            </form> : <button className="customer-auth-submit" type="button" disabled={deviceSaving} onClick={() => { setConnectingLocationId(location.id); setDeviceError(""); setActivationLink(null); }}>{t("deviceConnect")}</button>}
            {activationLink?.locationId === location.id && <div className="customer-account-activation" role="status" aria-live="polite">
              <h4>{t("deviceLinkReady")}</h4><p>{t("deviceLinkInstruction")}</p>
              <a href={activationLink.url} target="_blank" rel="noreferrer">{activationLink.url}</a>
              <p>{t("deviceLinkExpires").replace("{{date}}", new Date(activationLink.expiresAt).toLocaleString())}</p>
              <button type="button" onClick={() => void copyActivationLink()}>{linkCopied ? t("deviceLinkCopied") : t("deviceCopyLink")}</button>
            </div>}
          </section>)}
        </section>)}
        {result?.locations?.length === 0 && <p role="status">{t("deviceNoAuthorizedLocations")}</p>}
        {billingNotice && !selectedBilling && <p role="status" className="customer-billing-notice">{billingNotice}</p>}
        {billingError && !selectedBilling && <p role="alert" className="customer-onboarding-error">{billingError}</p>}
        {result?.partnerCompleted && <section className="customer-account-partner-access" aria-label={t("partnerAccess")}>
          <h2>{t("partnerAccess")}</h2><p>{t("partnerAccessActive")}</p>
        </section>}
      </> : <>
        {result?.partnerContext && <p role="status">{t("partnerInvitePending")}</p>}
        <p>{t("onboardingIncomplete")}</p><h2>{t("onboardingTitle")}</h2><p>{t("onboardingDescription")}</p>
        <form onSubmit={submit}>
          <label>{t("organizationName")}<input required maxLength={160} autoComplete="organization" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} /></label>
          <label>{t("locationName")}<input required maxLength={160} autoComplete="organization-title" value={locationName} onChange={(event) => setLocationName(event.target.value)} /></label>
          <label>{t("timezone")}<input required maxLength={100} autoComplete="off" placeholder="Asia/Ho_Chi_Minh" value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
          <p className="customer-onboarding-help">{t("timezoneHelp")}</p>
          {error && <p role="alert" className="customer-onboarding-error">{error}</p>}
          <button className="customer-auth-submit" type="submit" disabled={saving}>{saving ? t("onboardingSubmitting") : t("onboardingSubmit")}</button>
        </form>
      </>}
      {billingUnavailable && account && <p role="status" className="customer-onboarding-error">{t("billingUnavailable")}</p>}
      {selectedBilling && <div className="customer-billing-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !billingBusy) { setSelectedBilling(null); setFakeCheckout(null); } }}>
        <section className="customer-billing-dialog customer-auth-card" role="dialog" aria-modal="true" aria-labelledby="customer-billing-dialog-title">
          <h2 id="customer-billing-dialog-title">{fakeCheckout ? t("billingCheckoutTitle") : t("billingModalTitle")}</h2>
          <p><strong>{selectedBilling.location.organizationName}</strong> · {selectedBilling.location.name}</p>
          <p>{selectedBilling.plan.productName}</p>
          <p>{billingStatusText(selectedBilling.plan)}</p>
          {!fakeCheckout && selectedBilling.plan.routes.length === 1 && <p>{selectedBilling.plan.routes[0].providerName}</p>}
          {!fakeCheckout && selectedBilling.plan.routes.length > 1 && <label className="customer-billing-route">{t("billingChooseRoute")}<select value={selectedRouteId} onChange={(event) => setSelectedRouteId(event.target.value)}>
            {selectedBilling.plan.routes.map((route) => <option key={route.id} value={route.id}>{route.providerName}</option>)}
          </select></label>}
          {fakeCheckout ? <>
            <p className="customer-billing-test-notice">{t("billingTestNotice")}</p>
            <p>{fakeCheckout.providerName}</p>
            <p><strong>{t("billingAmount")}: {new Intl.NumberFormat(locale, { style: "currency", currency: fakeCheckout.currency }).format(fakeCheckout.amountMinor / 100)}</strong></p>
            <p>{t("billingCheckoutExpires").replace("{{date}}", new Date(fakeCheckout.expiresAt).toLocaleString(locale))}</p>
            {fakeCheckout.phase === "done" ? <p role="status">{t("billingPaymentDone")}</p> : <button type="button" className="customer-auth-submit" disabled={billingBusy} onClick={() => void confirmCheckout()}>{billingBusy ? t("billingConfirming") : t("billingConfirmPayment")}</button>}
          </> : <>
            <p className="customer-billing-test-notice">{t("billingTestNotice")}</p>
            {selectedBilling.plan.status === "subscription" && selectedBilling.plan.subscriptionId && !selectedBilling.plan.subscriptionCanceled && <button type="button" className="customer-billing-secondary" disabled={billingBusy} onClick={() => void cancelSubscription(selectedBilling.plan.subscriptionId!)}>{billingBusy ? t("billingCanceling") : t("billingCancelSubscription")}</button>}
            {selectedBilling.plan.status !== "subscription" && <button type="button" className="customer-auth-submit" disabled={billingBusy || !selectedRouteId || !selectedBilling.location.marketCode} onClick={() => void beginCheckout()}>{billingBusy ? t("billingLoading") : t("billingContinue")}</button>}
          </>}
          {billingError && <p role="alert" className="customer-onboarding-error">{billingError}</p>}
          {billingNotice && <p role="status" className="customer-billing-notice">{billingNotice}</p>}
          <button ref={billingCloseRef} type="button" className="customer-billing-secondary" disabled={billingBusy} onClick={() => { setSelectedBilling(null); setFakeCheckout(null); }}>{t("billingClose")}</button>
        </section>
      </div>}
      <button className="customer-auth-submit customer-account-logout" onClick={logout}>{t("authLogout")}</button>
    </>}
  </section></main>;
}

export default function AccountClient() { return <I18nProvider><Content /></I18nProvider>; }

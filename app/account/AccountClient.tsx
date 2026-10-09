"use client";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { I18nProvider, useI18n } from "@/app/i18n/I18nProvider";
import type { TranslationKey } from "@/app/i18n/types";
import { AuthLanguageSelector } from "../auth/AuthLanguageSelector";
import AccountBillingWizard from "./AccountBillingWizard";
import { saveBillingMarketAndRefresh } from "./billingWizardModel";
import { accountPlanPresentation, shouldRefreshAccountOnReturn } from "./accountViewModel";
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
  trialEndsAt: string | null; paidStartsAt: string | null; paidThrough: string | null; trialActive: boolean;
  scheduledPaidPeriods: { startsAt: string; endsAt: string }[]; subscriptionId: string | null;
  subscriptionCanceled: boolean; routes: { id: string; providerName: string }[];
};
type PartnerBenefit = { id: string; partnerName: string; productId: string; productName: string; startsAt: string; endsAt: string | null };
type BillingLocation = {
  id: string; organizationId: string; organizationName: string; name: string; timezone: string;
  marketCode: string | null; products: BillingPlan[]; partnerBenefits: PartnerBenefit[];
};
type BillingSummary = { locations: BillingLocation[]; supportedMarkets: string[] };
type BillingOrderHistoryItem = {
  id: string; organizationId: string; status: "draft" | "quoted" | "pending" | "paid" | "expired" | "canceled" | "failed";
  currency: string; totalAmountMinor: string; createdAt: string; expiresAt: string | null;
  payment: { status: string; updatedAt: string; providerOccurredAt: string | null } | null;
  lines: Array<{ id: string; locationId: string; locationName: string; productId: string; productName: string; durationMonths: number; amountMinor: string; billingPeriodStartsAt: string | null; billingPeriodEndsAt: string | null }>;
};
type FakeCheckout = {
  confirmationToken: string; expiresAt: string; amountMinor: number; currency: string;
  providerName: string; phase: "checkout" | "done";
};

function Content() {
  const { locale, t } = useI18n();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
  const [billingOrders, setBillingOrders] = useState<BillingOrderHistoryItem[]>([]);
  const [billingOrdersUnavailable, setBillingOrdersUnavailable] = useState(false);
  const [selectedBilling, setSelectedBilling] = useState<{ location: BillingLocation; plan: BillingPlan } | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [fakeCheckout, setFakeCheckout] = useState<FakeCheckout | null>(null);
  const [billingError, setBillingError] = useState("");
  const [billingNotice, setBillingNotice] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);
  const [marketChoices, setMarketChoices] = useState<Record<string, string>>({});
  const [marketSavingId, setMarketSavingId] = useState<string | null>(null);
  const billingCloseRef = useRef<HTMLButtonElement>(null);
  const loadVersion = useRef(0);
  const loadInFlight = useRef<Promise<void> | null>(null);
  const loadController = useRef<AbortController | null>(null);

  async function load(force = false) {
    if (loadInFlight.current && !force) return loadInFlight.current;
    if (force) loadController.current?.abort();
    const version = ++loadVersion.current;
    const controller = new AbortController();
    loadController.current = controller;
    setRefreshing(true);
    const request = (async () => {
      try {
        const options = { cache: "no-store", credentials: "same-origin", signal: controller.signal } as const;
        const [response, billingResponse, ordersResponse] = await Promise.all([
          fetch("/api/v2/customer/onboarding", options),
          fetch("/api/v2/customer/billing", options),
          fetch("/api/v2/customer/billing/orders?limit=50", options).catch(() => null),
        ]);
        if (version !== loadVersion.current) return;
        const [accountBody, billingBody, ordersBody] = await Promise.all([
          response.ok ? response.json() as Promise<LoadResult> : Promise.resolve(null),
          billingResponse.ok ? billingResponse.json() as Promise<BillingSummary> : Promise.resolve(null),
          ordersResponse?.ok ? ordersResponse.json() as Promise<{ items?: BillingOrderHistoryItem[] }> : Promise.resolve(null),
        ]);
        if (version !== loadVersion.current) return;
        setResult(accountBody);
        setBilling(billingBody);
        if (billingBody) setSelectedBilling((current) => {
          if (!current) return current;
          const refreshedLocation = billingBody.locations.find((item) => item.id === current.location.id);
          const refreshedPlan = refreshedLocation?.products.find((item) => item.productId === current.plan.productId);
          return refreshedLocation && refreshedPlan ? { location: refreshedLocation, plan: refreshedPlan } : current;
        });
        setBillingUnavailable(!billingBody && billingResponse.status !== 404 && billingResponse.status !== 401);
        setBillingOrders(Array.isArray(ordersBody?.items) ? ordersBody.items : []);
        setBillingOrdersUnavailable(!ordersBody && (!ordersResponse || (ordersResponse.status !== 404 && ordersResponse.status !== 401)));
      } catch {
        if (version === loadVersion.current && !controller.signal.aborted) {
          setResult(null);
          setBillingUnavailable(true);
          setBillingOrdersUnavailable(true);
        }
      } finally {
        if (version === loadVersion.current) {
          setLoaded(true);
          setRefreshing(false);
          loadInFlight.current = null;
          loadController.current = null;
        }
      }
    })();
    loadInFlight.current = request;
    return request;
  }

  function openBilling(location: BillingLocation, plan: BillingPlan) {
    setSelectedBilling({ location, plan });
    setSelectedRouteId(plan.routes[0]?.id ?? "");
    setMarketChoices((current) => ({ ...current, [location.id]: location.marketCode ?? "" }));
    setFakeCheckout(null);
    setBillingError("");
    setBillingNotice("");
  }

  function billingErrorKey(code: string): TranslationKey {
    if (code === "unauthenticated" || code === "unauthenticated_or_unverified") return "billingUnauthorized";
    if (code === "not_authorized") return "billingUnauthorized";
    if (code === "market_not_configured") return "billingMarketMissing";
    if (code === "market_unavailable" || code === "invalid_market") return "billingMarketUnavailable";
    if (code === "market_refresh_failed") return "billingUnavailable";
    if (code === "route_unavailable" || code === "product_unavailable") return "billingNoRoutes";
    if (code === "checkout_pending") return "billingCheckoutPending";
    if (code === "checkout_expired") return "billingCheckoutExpired";
    if (code === "provider_not_configured" || code === "unavailable") return "billingProviderUnavailable";
    return "billingPaymentFailed";
  }

  async function persistMarket(locationId: string, marketCode: string): Promise<BillingLocation> {
    return saveBillingMarketAndRefresh({
      locationId,
      marketCode,
      save: async (id, market) => {
        const response = await fetch("/api/v2/customer/billing/market", {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ locationId: id, marketCode: market }),
        });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "unavailable");
      },
      refresh: async () => {
        const response = await fetch("/api/v2/customer/billing", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("unavailable");
        const refreshed = await response.json() as BillingSummary;
        setBilling(refreshed);
        setMarketChoices((current) => { const next = { ...current }; delete next[locationId]; return next; });
        return refreshed.locations;
      },
    });
  }

  async function saveMarket(locationId: string) {
    const marketCode = marketChoices[locationId];
    if (!marketCode) return;
    setBillingError(""); setBillingNotice(""); setMarketSavingId(locationId);
    try {
      const refreshedLocation = await persistMarket(locationId, marketCode);
      if (selectedBilling?.location.id === locationId) {
        const refreshedPlan = refreshedLocation.products.find((plan) => plan.productId === selectedBilling.plan.productId);
        if (refreshedPlan) {
          setSelectedBilling({ location: refreshedLocation, plan: refreshedPlan });
          setSelectedRouteId(refreshedPlan.routes[0]?.id ?? "");
        }
      }
      setBillingNotice(t("billingMarketSaved"));
    } catch (error) {
      const code = error instanceof Error ? error.message : "unavailable";
      setBillingError(t(code === "unavailable" ? "billingUnavailable" : billingErrorKey(code)));
    }
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
    let lastReturnRefreshAt = Date.now();
    const refreshOnReturn = () => {
      const now = Date.now();
      if (!shouldRefreshAccountOnReturn(now, lastReturnRefreshAt, document.visibilityState !== "hidden")) return;
      lastReturnRefreshAt = now;
      void load(true);
    };
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refreshOnReturn(); };
    window.addEventListener("focus", refreshOnReturn);
    window.addEventListener("pageshow", refreshOnReturn);
    document.addEventListener("visibilitychange", onVisibilityChange);
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      new Intl.DateTimeFormat("en-US", { timeZone: detected }).format(0);
      setTimezone(detected);
    } catch { setTimezone(""); }
    return () => {
      loadVersion.current += 1;
      loadController.current?.abort();
      loadInFlight.current = null;
      window.removeEventListener("focus", refreshOnReturn);
      window.removeEventListener("pageshow", refreshOnReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
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
  const displayDate = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const futurePaidPeriodText = (plan: BillingPlan) => plan.scheduledPaidPeriods
    .map((period) => `${t("billingPaidStarts").replace("{{date}}", displayDate(period.startsAt))} · ${t("billingPaidThrough").replace("{{date}}", displayDate(period.endsAt))}`)
    .join(" · ");
  const billingStatusText = (plan: BillingPlan) => {
    let statusText: string;
    if (plan.status === "trial") {
      statusText = !plan.trialEndsAt ? t("billingTrial") : (() => {
        const countdown = trialCountdown({ status: "active", startsAt: "1970-01-01T00:00:00.000Z", endsAt: plan.trialEndsAt });
        const key = countdown.key === "trialDays" ? trialDaysMessageKey(locale, countdown.days ?? 0) : countdown.key;
        return `${t("billingTrial")}: ${t(key).replace("{{days}}", String(countdown.days ?? ""))}`;
      })();
    } else if (plan.status === "subscription") statusText = plan.subscriptionCanceled
      ? `${t("billingCanceled")}${plan.paidThrough ? ` ${t("billingPaidThrough").replace("{{date}}", displayDate(plan.paidThrough))}` : ""}`
      : plan.paidThrough ? t("billingPaidThrough").replace("{{date}}", displayDate(plan.paidThrough)) : t("billingSubscription");
    else if (plan.status === "partner") statusText = t("billingPartnerStatus");
    else statusText = t(plan.status === "expired" ? "billingExpired" : "billingAvailable");
    const activeTrialText = plan.trialActive && plan.status !== "trial" && plan.trialEndsAt
      ? t("billingTrialEnds").replace("{{date}}", displayDate(plan.trialEndsAt)) : "";
    return [statusText, activeTrialText, futurePaidPeriodText(plan)].filter(Boolean).join(" · ");
  };
  const trialRemainingText = (days: number) => t(days === 0 ? "trialLessThanDay" : trialDaysMessageKey(locale, days)).replace("{{days}}", String(days));
  const locationGroups = new Map<string, { organizationName: string; locations: CustomerLocation[] }>();
  for (const location of result?.locations ?? []) {
    const group = locationGroups.get(location.organizationId) ?? { organizationName: location.organizationName, locations: [] };
    group.locations.push(location); locationGroups.set(location.organizationId, group);
  }

  return <main className="customer-auth-page"><section className="customer-auth-card customer-onboarding-card"><header className="customer-account-header"><span className="customer-auth-brand">SOUND SPA</span>{account && <strong>{account.email}</strong>}<AuthLanguageSelector />{account && <><button type="button" className="customer-billing-secondary" disabled={refreshing} onClick={() => void load(true)}>{refreshing ? t("accountRefreshing") : t("accountRefresh")}</button><button type="button" className="customer-billing-secondary" onClick={logout}>{t("authLogout")}</button></>}</header>
    <h1>{t("authAccountTitle")}</h1>
    {!loaded ? <p>{t("authSending")}</p> : !account ? <><p>{t("authSignInRequired")}</p><Link href="/login">{t("authLoginLink")}</Link></> : <>
      {complete ? <>
        {result?.partnerContext && <p role="status">{t("existingOrganization")}</p>}
        {[...locationGroups.entries()].map(([organizationId, group]) => <section className="customer-account-organization" key={organizationId}>
          <h2>{group.organizationName}</h2>
          {billing && <AccountBillingWizard
            organizationId={organizationId}
            organizationName={group.organizationName}
            locations={billing.locations.filter((location) => location.organizationId === organizationId)}
            supportedMarkets={billing.supportedMarkets}
            onSaveMarket={persistMarket}
            orders={billingOrders.filter((order) => order.organizationId === organizationId)}
            ordersUnavailable={billingOrdersUnavailable}
            onRefreshOrders={() => load(true)}
            onPaymentConfirmed={() => load(true)}
          />}
          {group.locations.map((location) => <section className="customer-account-location" key={location.id}>
            <div className="customer-account-location-heading"><h3>{location.name}</h3><small>{location.timezone}</small></div>
            {billing && (() => {
              const billingLocation = billing.locations.find((item) => item.id === location.id);
              if (!billingLocation) return null;
              return <section className="customer-billing-location" aria-label={t("billingTitle")}>
                {billingLocation.products.length > 0 && <div className="customer-billing-plans">
                  {billingLocation.products.map((plan) => {
                    const presentation = accountPlanPresentation(plan, billingLocation.partnerBenefits);
                    return <article className="customer-billing-plan" key={plan.productId}>
                      <div className="customer-billing-plan-info"><strong>{plan.productName}</strong><span className="customer-billing-access-status">{t(plan.status === "trial" ? "billingTrial" : plan.status === "subscription" ? (plan.subscriptionCanceled ? "billingCanceled" : "billingSubscription") : plan.status === "partner" ? "billingPartnerStatus" : plan.status === "expired" ? "billingExpired" : "billingAvailable")}</span>
                        {plan.trialActive && presentation.trialRemainingDays !== null && <small>{trialRemainingText(presentation.trialRemainingDays)}</small>}
                        {presentation.accessExpiresAt && <small>{t("billingAccessExpires").replace("{{date}}", displayDate(presentation.accessExpiresAt))}</small>}
                        {plan.scheduledPaidPeriods.map((period, index) => <small key={`${period.startsAt}-${index}`}>{t("billingPaidStarts").replace("{{date}}", displayDate(period.startsAt))} · {t("billingPaidThrough").replace("{{date}}", displayDate(period.endsAt))}</small>)}
                      </div>
                      <button type="button" className="customer-auth-submit customer-billing-action" onClick={() => openBilling(billingLocation, plan)}>{t("billingManage")}</button>
                    </article>;
                  })}
                </div>}
                {billingLocation.partnerBenefits.length > 0 && <section className="customer-account-partner-benefits" aria-label={t("partnerAccess")}><h4>{t("partnerAccess")}</h4><ul>{billingLocation.partnerBenefits.map((benefit) => <li key={benefit.id}><span><strong>{benefit.partnerName}</strong><small>{benefit.productName}</small></span><small>{new Date(benefit.startsAt).getTime() > Date.now() ? t("billingBenefitStarts").replace("{{date}}", displayDate(benefit.startsAt)) : benefit.endsAt ? t("billingAccessExpires").replace("{{date}}", displayDate(benefit.endsAt)) : t("partnerAccessActive")}</small></li>)}</ul></section>}
              </section>;
            })()}
            <details className="customer-account-devices-details"><summary>{t("customerDevices")}</summary>
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
            </details>
          </section>)}
        </section>)}
        {result?.locations?.length === 0 && <p role="status">{t("deviceNoAuthorizedLocations")}</p>}
        {billingNotice && !selectedBilling && <p role="status" className="customer-billing-notice">{billingNotice}</p>}
        {billingError && !selectedBilling && <p role="alert" className="customer-onboarding-error">{billingError}</p>}
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
          {!fakeCheckout && <section className="customer-billing-market-flow"><label>{t("billingMarketLabel")}<select value={marketChoices[selectedBilling.location.id] ?? selectedBilling.location.marketCode ?? ""} onChange={(event) => setMarketChoices((current) => ({ ...current, [selectedBilling.location.id]: event.target.value }))}><option value="">—</option>{billing?.supportedMarkets.map((market) => <option key={market} value={market}>{market}</option>)}</select></label>{marketChoices[selectedBilling.location.id] && marketChoices[selectedBilling.location.id] !== selectedBilling.location.marketCode && <button type="button" className="customer-billing-secondary" disabled={billingBusy || marketSavingId === selectedBilling.location.id} onClick={() => void saveMarket(selectedBilling.location.id)}>{marketSavingId === selectedBilling.location.id ? t("billingCanceling") : t("billingMarketSave")}</button>}</section>}
          {!fakeCheckout && !selectedBilling.location.marketCode && <p className="customer-billing-inline-help">{t("billingMarketMissing")}</p>}
          {!fakeCheckout && selectedBilling.location.marketCode && selectedBilling.plan.routes.length === 0 && <p className="customer-billing-inline-help">{t("billingNoRoute")}</p>}
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
            {selectedBilling.plan.status !== "subscription" && <button type="button" className="customer-auth-submit" disabled={billingBusy || !selectedRouteId || !selectedBilling.location.marketCode || selectedBilling.plan.routes.length === 0} onClick={() => void beginCheckout()}>{billingBusy ? t("billingLoading") : t("billingContinue")}</button>}
          </>}
          {billingError && <p role="alert" className="customer-onboarding-error">{billingError}</p>}
          {billingNotice && <p role="status" className="customer-billing-notice">{billingNotice}</p>}
          <button ref={billingCloseRef} type="button" className="customer-billing-secondary" disabled={billingBusy} onClick={() => { setSelectedBilling(null); setFakeCheckout(null); }}>{t("billingClose")}</button>
        </section>
      </div>}
    </>}
  </section></main>;
}

export default function AccountClient() { return <I18nProvider><Content /></I18nProvider>; }

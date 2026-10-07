"use client";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { I18nProvider, useI18n } from "@/app/i18n/I18nProvider";
import { AuthLanguageSelector } from "../auth/AuthLanguageSelector";
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

  async function load() {
    try {
      const response = await fetch("/api/v2/customer/onboarding", { cache: "no-store" });
      if (response.ok) setResult(await response.json() as LoadResult);
      else setResult(null);
    } catch { setResult(null); }
    finally { setLoaded(true); }
  }
  useEffect(() => {
    void load();
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      new Intl.DateTimeFormat("en-US", { timeZone: detected }).format(0);
      setTimezone(detected);
    } catch { setTimezone(""); }
  }, []);

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
          {group.locations.map((location) => <section className="customer-account-location" key={location.id}>
            <h3>{location.name}</h3><p>{location.timezone}</p>
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
      <button className="customer-auth-submit customer-account-logout" onClick={logout}>{t("authLogout")}</button>
    </>}
  </section></main>;
}

export default function AccountClient() { return <I18nProvider><Content /></I18nProvider>; }

"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
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
type LoadResult = { account: Account | null; partnerContext: boolean; partnerCompleted?: boolean };

function Content() {
  const { locale, t } = useI18n();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
      const completed = await response.json() as { account: Account; partnerCompleted?: boolean };
      setResult({ account: completed.account, partnerContext: false, partnerCompleted: completed.partnerCompleted });
    } catch { setError(t("onboardingUnavailable")); }
    finally { setSaving(false); }
  }

  async function logout() { await fetch("/api/v2/customer-auth/logout", { method: "POST" }); window.location.assign("/login"); }
  const account = result?.account;
  const complete = Boolean(account?.organization && account.location);
  const trialDisplay = account?.trial ? trialCountdown(account.trial) : { key: "trialEnded" as const };
  const trialKey = trialDisplay.key === "trialDays" ? trialDaysMessageKey(locale, trialDisplay.days ?? 0) : trialDisplay.key;
  const trialStatus = t(trialKey).replace("{{days}}", String(trialDisplay.days ?? ""));

  return <main className="customer-auth-page"><section className="customer-auth-card customer-onboarding-card"><div className="customer-auth-top"><span className="customer-auth-brand">SOUND SPA</span><AuthLanguageSelector /></div>
    <h1>{t("authAccountTitle")}</h1>
    {!loaded ? <p>{t("authSending")}</p> : !account ? <><p>{t("authSignInRequired")}</p><Link href="/login">{t("authLoginLink")}</Link></> : <>
      <p>{t("authEmailVerified")}: <strong>{account.email}</strong></p>
      {complete ? <>
        {result?.partnerContext && <p role="status">{t("existingOrganization")}</p>}
        <p>{result?.partnerCompleted ? t("partnerSetupCompleted") : t("onboardingCompleted")}</p>
        <dl className="customer-account-details">
          <dt>{t("accountOrganization")}</dt><dd>{account.organization!.name}</dd>
          <dt>{t("accountLocation")}</dt><dd>{account.location!.name}</dd>
          <dt>{t("accountTimezone")}</dt><dd>{account.location!.timezone}</dd>
          {account.trial && <><dt>{t("trialLabel")}</dt><dd>{trialStatus}</dd></>}
        </dl>
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

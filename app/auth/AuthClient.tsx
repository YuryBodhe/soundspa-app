"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";
import { AuthLanguageSelector } from "./AuthLanguageSelector";

export function AuthClient({ mode }: { mode: "signup" | "login" }) {
  const { locale, t } = useI18n();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState("");
  const [consuming, setConsuming] = useState(false);
  const partnerContext = search.get("source") === "partner";
  const contextUnavailable = search.get("context") === "unavailable";

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const authToken = hash.get("token");
    if (!authToken) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setToken(authToken);
  }, []);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setSentEmail("");
    try {
      const response = await fetch(mode === "signup" ? "/api/v2/customer-auth/signup" : "/api/v2/customer-auth/request-login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale, ...(mode === "signup" && partnerContext ? { partnerContext: true } : {}) }),
      });
      const data = await response.json() as { code?: string };
      if (!response.ok) setError(data.code === "invalid_email" ? t("authInvalidEmail") : t("authInvalidLink"));
      else setSentEmail(email.trim());
    } catch { setError(t("authInvalidLink")); }
    finally { setLoading(false); }
  }

  async function continueWithToken() {
    if (!token || consuming) return;
    setConsuming(true); setError("");
    try {
      const response = await fetch("/api/v2/customer-auth/consume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (!response.ok) setError(t("authInvalidLink"));
      else window.location.assign("/account");
    } catch { setError(t("authInvalidLink")); }
    finally { setConsuming(false); setToken(""); }
  }

  return <main className="customer-auth-page"><section className="customer-auth-card">
    <div className="customer-auth-top"><span className="customer-auth-brand">SOUND SPA</span><AuthLanguageSelector /></div>
    {token ? <><h1>{t("authContinueTitle")}</h1><p>{t("authLinkConfirmation")}</p><button className="customer-auth-submit" type="button" onClick={continueWithToken} disabled={consuming}>{consuming ? t("authSending") : t("authContinue")}</button></> : <>
      {sentEmail ? <div className="customer-auth-email-success" role="status" aria-live="polite">
        <h1>{t("authCheckEmailTitle")}</h1>
        <p>{t(mode === "signup" ? "authSignupCheckEmailDescription" : "authCheckEmailDescription")}</p>
        <p className="customer-auth-sent-address">{sentEmail}</p>
      </div> : <>
        <h1>{mode === "signup" ? t("authSignupTitle") : t("authLoginTitle")}</h1>
        <p>{mode === "signup" ? t("authSignupDescription") : t("authLoginDescription")}</p>
        {contextUnavailable && <p role="alert">{t("authPartnerUnavailable")}</p>}
        <form onSubmit={requestLink}>
          <label>{t("authEmail")}<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <button className="customer-auth-submit" type="submit" disabled={loading}>{loading ? t("authSending") : mode === "signup" ? t("authSendVerification") : t("authRequestLogin")}</button>
        </form>
        {error && <p role="alert">{error}</p>}
        <Link href={mode === "signup" ? "/login" : "/signup"}>{mode === "signup" ? t("authLoginLink") : t("authSignupLink")}</Link>
      </>}
    </>}
  </section></main>;
}

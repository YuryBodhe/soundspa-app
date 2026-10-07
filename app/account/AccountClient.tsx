"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { I18nProvider, useI18n } from "@/app/i18n/I18nProvider";
import { AuthLanguageSelector } from "../auth/AuthLanguageSelector";

type Customer = { id: string; email: string; emailVerifiedAt: string | null; preferredLocale: string | null } | null;
function Content() {
  const { t } = useI18n();
  const [user, setUser] = useState<Customer>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { fetch("/api/v2/customer-auth/session", { cache: "no-store" }).then((response) => response.json()).then((value: { user: Customer }) => setUser(value.user)).catch(() => setUser(null)).finally(() => setLoaded(true)); }, []);
  async function logout() { await fetch("/api/v2/customer-auth/logout", { method: "POST" }); window.location.assign("/login"); }
  return <main className="customer-auth-page"><section className="customer-auth-card"><div className="customer-auth-top"><span className="customer-auth-brand">SOUND SPA</span><AuthLanguageSelector /></div><h1>{t("authAccountTitle")}</h1>
    {!loaded ? <p>{t("authSending")}</p> : user ? <><p>{t("authEmailVerified")}: {user.email}</p><p>{t("authNoOrganization")}</p><button className="customer-auth-submit" onClick={logout}>{t("authLogout")}</button></> : <><p>{t("authSignInRequired")}</p><Link href="/login">{t("authLoginLink")}</Link></>}
  </section></main>;
}
export default function AccountClient() { return <I18nProvider><Content /></I18nProvider>; }

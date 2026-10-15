"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";
import { registrationTokenFromHash } from "@/lib/v2/registrationLinkUrl";

export function RegistrationLinkLanding() {
  const { t } = useI18n();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const token = registrationTokenFromHash(window.location.hash);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!token) { setUnavailable(true); return; }

    let active = true;
    void fetch("/api/v2/customer-auth/registration-link/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).then((response) => {
      if (!active) return;
      if (response.ok) window.location.replace("/signup?source=registration-link");
      else setUnavailable(true);
    }).catch(() => { if (active) setUnavailable(true); });

    return () => { active = false; };
  }, []);

  return <main className="customer-auth-page"><section className="customer-auth-card">
    <span className="customer-auth-brand">SOUND SPA</span>
    {unavailable ? <p role="alert">{t("registrationLinkUnavailable")}</p> : <p role="status">{t("authSending")}</p>}
  </section></main>;
}

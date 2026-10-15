"use client";

import { FormEvent, useState } from "react";
import { useI18n } from "@/app/i18n/I18nProvider";
import type { TranslationKey } from "@/app/i18n/types";

export default function SpaquatoriaPromoRedeemer({ locationId, onRedeemed }: { locationId: string; onRedeemed: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<TranslationKey | null>(null);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch("/api/v2/customer/spaquatoria-promos/redeem", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ locationId, code: code.trim() }),
      });
      const payload = await response.json().catch(() => ({})) as { result?: { status?: string }; error?: string };
      if (!response.ok) {
        setFeedback(payload.error === "location_unavailable" ? "promoRedeemLocationUnavailable" : payload.error === "promo_unavailable" ? "promoRedeemUnavailable" : "billingUnavailable");
        return;
      }
      const status = payload.result?.status;
      setFeedback(status === "already_covered" ? "promoRedeemCovered" : status === "already_redeemed" ? "promoRedeemRepeated" : "promoRedeemSuccess");
      if (status === "redeemed") { setCode(""); onRedeemed(); }
    } catch {
      setFeedback("billingUnavailable");
    } finally { setBusy(false); }
  }

  return <form className="customer-spaquatoria-promo-form" onSubmit={(event) => void redeem(event)}>
    <label>{t("promoRedeemTitle")}<span className="customer-spaquatoria-promo-controls"><input autoComplete="off" maxLength={128} minLength={32} value={code} onChange={(event) => setCode(event.target.value)} placeholder={t("promoRedeemPlaceholder")} /><button className="customer-billing-secondary" type="submit" disabled={busy || code.trim().length < 32}>{busy ? t("promoRedeemWorking") : t("promoRedeemButton")}</button></span></label>
    {feedback && <p role={feedback === "promoRedeemSuccess" ? "status" : "alert"}>{t(feedback)}</p>}
  </form>;
}

"use client";

import { useState } from "react";

type PayerState = "pending" | "paid" | "already_paid" | "expired" | "canceled" | "unavailable";

export function PayerCheckout(props: {
  capability: string;
  state: PayerState;
  organizationName?: string;
  currency?: string;
  total?: string;
  expiresAt?: string;
  lines?: Array<{ locationName: string; productName: string; durationMonths: number; amount: string }>;
}) {
  const [state, setState] = useState<PayerState>(props.state);
  const [busy, setBusy] = useState(false);

  async function pay() {
    if (busy || state !== "pending") return;
    setBusy(true);
    try {
      const response = await fetch("/api/v2/fake-provider/aggregate/confirm", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: props.capability }),
      });
      const result: { state?: PayerState } = await response.json();
      if (!response.ok || !result.state) setState("unavailable");
      else setState(result.state);
      if (result.state === "paid" || result.state === "already_paid") {
        window.history.replaceState(null, "", "/fake-checkout/completed");
      }
    } catch {
      setState("unavailable");
    } finally {
      setBusy(false);
    }
  }

  const message: Record<PayerState, string> = {
    pending: "Staging payment simulation. No real money will be charged.",
    paid: "Payment completed successfully.",
    already_paid: "This order has already been paid.",
    expired: "This checkout has expired. Ask the SoundSpa account manager for a new link.",
    canceled: "This checkout was canceled.",
    unavailable: "This checkout is unavailable. Contact the person who sent the link.",
  };

  return <main style={{ boxSizing: "border-box", maxWidth: 680, margin: "0 auto", padding: "32px 20px", color: "#f7f1dc", fontFamily: "Arial, sans-serif" }}>
    <section style={{ border: "1px solid rgba(212,175,55,.35)", borderRadius: 16, padding: 24, background: "#171613" }}>
      <p style={{ color: "#d4af37", marginTop: 0 }}>SoundSpa · Staging test checkout</p>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Payment for {props.organizationName ?? "this order"}</h1>
      {props.state === "pending" && props.lines && <>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", margin: "20px 0" }}>
            <thead><tr><th align="left">Location</th><th align="left">Product</th><th align="right">Duration</th><th align="right">Amount</th></tr></thead>
            <tbody>{props.lines.map((line, index) => <tr key={`${line.locationName}-${index}`}>
              <td style={{ padding: "12px 8px 12px 0", borderTop: "1px solid #45413a" }}>{line.locationName}</td>
              <td style={{ padding: "12px 8px", borderTop: "1px solid #45413a" }}>{line.productName}</td>
              <td style={{ padding: "12px 8px", borderTop: "1px solid #45413a", textAlign: "right" }}>{line.durationMonths} months</td>
              <td style={{ padding: "12px 0 12px 8px", borderTop: "1px solid #45413a", textAlign: "right", whiteSpace: "nowrap" }}>{line.amount}</td>
            </tr>)}</tbody>
            <tfoot><tr><th colSpan={3} align="right" style={{ paddingTop: 18 }}>Total · {props.currency}</th><th align="right" style={{ paddingTop: 18, whiteSpace: "nowrap" }}>{props.total}</th></tr></tfoot>
          </table>
        </div>
        {props.expiresAt && <p style={{ color: "#bdb7a8", fontSize: 13 }}>Link expires {new Date(props.expiresAt).toLocaleString()}.</p>}
      </>}
      <p role="status" aria-live="polite">{message[state]}</p>
      {state === "pending" && <button type="button" disabled={busy} onClick={pay} style={{ minHeight: 48, width: "100%", marginTop: 16, border: 0, borderRadius: 10, background: "#d4af37", color: "#171613", fontWeight: 700, fontSize: 16, cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Processing…" : "Simulate payment"}
      </button>}
      <p style={{ color: "#9d978a", fontSize: 12, marginBottom: 0 }}>This page is only a staging simulation. It does not collect card details.</p>
    </section>
  </main>;
}

import { headers } from "next/headers";
import type { Metadata } from "next";
import { fakeProviderPageIsEnabled } from "@/lib/v2/fakePaymentProvider";
import { PayerCheckout } from "./PayerCheckout";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata: Metadata = { robots: { index: false, follow: false, noarchive: true } };

function formatMinorAmount(value: string, currency: string) {
  const minor = BigInt(value);
  const fractionDigits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const scale = BigInt(10) ** BigInt(fractionDigits);
  const major = minor / scale;
  const fraction = minor % scale;
  return fractionDigits === 0
    ? `${major.toLocaleString("en-US")} ${currency}`
    : `${major.toLocaleString("en-US")}.${fraction.toString().padStart(fractionDigits, "0")} ${currency}`;
}

export default async function FakeAggregateCheckoutPage({ params }: { params: Promise<{ capability: string }> }) {
  const requestHeaders = await headers();
  const { capability } = await params;
  if (!fakeProviderPageIsEnabled(process.env, requestHeaders.get("host"))) {
    return <PayerCheckout capability="" state="unavailable" />;
  }
  try {
    const { getFakeBillingOrderPayerView } = await import("@/db/v2/services/fakeBillingOrderProvider");
    const view = await getFakeBillingOrderPayerView({ capability });
    return <PayerCheckout
      capability={capability}
      state={view.state}
      organizationName={view.organizationName}
      currency={view.currency}
      total={view.totalAmountMinor && view.currency ? formatMinorAmount(view.totalAmountMinor, view.currency) : undefined}
      expiresAt={view.expiresAt}
      lines={view.lines?.map((line) => ({
        ...line,
        amount: view.currency ? formatMinorAmount(line.amountMinor, view.currency) : line.amountMinor,
      }))}
    />;
  } catch {
    return <PayerCheckout capability="" state="unavailable" />;
  }
}

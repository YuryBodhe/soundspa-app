import { notFound } from "next/navigation";
import { I18nProvider } from "@/app/i18n/I18nProvider";
import BillingWizardPreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function BillingWizardPreviewPage() {
  if (process.env.NODE_ENV !== "development" || process.env.SOUNDSPA_BILLING_WIZARD_PREVIEW !== "1") {
    notFound();
  }
  return <I18nProvider><BillingWizardPreviewClient /></I18nProvider>;
}

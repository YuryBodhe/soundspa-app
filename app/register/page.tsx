import type { Metadata } from "next";
import { I18nProvider } from "@/app/i18n/I18nProvider";
import { RegistrationLinkLanding } from "./RegistrationLinkLanding";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false, noarchive: true } };

export default function RegistrationLinkPage() {
  return <I18nProvider><RegistrationLinkLanding /></I18nProvider>;
}

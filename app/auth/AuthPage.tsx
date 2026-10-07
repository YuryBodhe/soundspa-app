"use client";
import { Suspense } from "react";
import { I18nProvider } from "@/app/i18n/I18nProvider";
import { AuthClient } from "./AuthClient";

export function AuthPage({ mode }: { mode: "signup" | "login" }) {
  return <I18nProvider><Suspense fallback={<main className="customer-auth-page" />}><AuthClient mode={mode} /></Suspense></I18nProvider>;
}

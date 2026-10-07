import type { Locale } from "@/app/i18n/types";

export type CustomerAuthEmailKind = "verify_email" | "login_link";
export type RenderedCustomerEmail = { subject: string; body: string; cta: string; text: string; html: string };

const copy: Record<Locale, Record<CustomerAuthEmailKind, { subject: string; body: string; cta: string }>> = {
  en: {
    verify_email: { subject: "Verify your SoundSpa email", body: "Confirm your email to continue creating your SoundSpa account.", cta: "Continue in SoundSpa" },
    login_link: { subject: "Your SoundSpa sign-in link", body: "Use this secure link to sign in to SoundSpa.", cta: "Continue in SoundSpa" },
  },
  ru: {
    verify_email: { subject: "Подтвердите email SoundSpa", body: "Подтвердите email, чтобы продолжить создание аккаунта SoundSpa.", cta: "Продолжить в SoundSpa" },
    login_link: { subject: "Ссылка для входа в SoundSpa", body: "Используйте эту защищённую ссылку для входа в SoundSpa.", cta: "Продолжить в SoundSpa" },
  },
  vi: {
    verify_email: { subject: "Xác minh email SoundSpa", body: "Xác minh email để tiếp tục tạo tài khoản SoundSpa.", cta: "Tiếp tục với SoundSpa" },
    login_link: { subject: "Liên kết đăng nhập SoundSpa", body: "Dùng liên kết bảo mật này để đăng nhập SoundSpa.", cta: "Tiếp tục với SoundSpa" },
  },
  th: {
    verify_email: { subject: "ยืนยันอีเมล SoundSpa", body: "ยืนยันอีเมลเพื่อดำเนินการสร้างบัญชี SoundSpa ต่อ", cta: "ดำเนินการต่อใน SoundSpa" },
    login_link: { subject: "ลิงก์เข้าสู่ระบบ SoundSpa", body: "ใช้ลิงก์ที่ปลอดภัยนี้เพื่อเข้าสู่ระบบ SoundSpa", cta: "ดำเนินการต่อใน SoundSpa" },
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

export function renderCustomerAuthEmail(kind: CustomerAuthEmailKind, locale: string | null | undefined, url: string): RenderedCustomerEmail {
  const selected = locale === "ru" || locale === "vi" || locale === "th" ? locale : "en";
  const message = copy[selected][kind];
  const safeUrl = escapeHtml(url);
  return {
    ...message,
    text: `${message.body}\n\n${message.cta}: ${url}`,
    html: `<p>${message.body}</p><p><a href="${safeUrl}">${message.cta}</a></p>`,
  };
}

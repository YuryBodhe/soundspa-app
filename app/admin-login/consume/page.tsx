// Старый путь admin-login/consume больше не нужен — сразу редиректим на /admin-login

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminLoginConsumeRedirect() {
  redirect("/admin-login");
}

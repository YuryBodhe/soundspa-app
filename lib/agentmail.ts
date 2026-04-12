import "server-only";
import { AgentMailClient } from "agentmail";

const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;
const AGENTMAIL_FROM = process.env.AGENTMAIL_FROM || "soundspa@agentmail.to";

if (!AGENTMAIL_API_KEY) {
  console.warn("[agentmail] AGENTMAIL_API_KEY is not set; email sending will fail.");
}

const client = AGENTMAIL_API_KEY
  ? new AgentMailClient({ apiKey: AGENTMAIL_API_KEY })
  : null;

type SendMagicLinkParams = {
  to: string;
  magicLink: string;
  salonName?: string;
  context?: "signup" | "login" | "admin-login";
};

function buildHtml({ magicLink, salonName, context }: SendMagicLinkParams) {
  const title = context === "login" ? "Вход в Sound Spa" : "Добро пожаловать в Sound Spa";
  const intro =
    context === "login"
      ? "Вот ваша ссылка для входа в кабинет Sound Spa."
      : `Для салона "${salonName ?? "ваш салон"}" мы создали новый кабинет с тестовым доступом.`;

  return `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f4f4f5; padding:24px;">
      <div style="max-width:480px; margin:0 auto; background:#fff; border-radius:16px; padding:24px; box-shadow:0 12px 30px rgba(15, 23, 42, 0.08);">
        <h1 style="font-size:22px; margin:0 0 12px;">${title}</h1>
        <p style="margin:0 0 16px; color:#4b5563;">${intro}</p>
        <p style="margin:0 0 24px; color:#4b5563;">
          Нажмите на кнопку ниже, чтобы открыть кабинет. Ссылка сработает на этом устройстве и действует ограниченное время.
        </p>
        <p style="text-align:center; margin:0 0 24px;">
          <a href="${magicLink}" style="display:inline-block; padding:12px 24px; border-radius:999px; background:#111827; color:#fff; text-decoration:none; font-weight:600;">
            Открыть кабинет Sound Spa
          </a>
        </p>
        <p style="margin:0 0 8px; font-size:13px; color:#6b7280;">
          Если кнопка не работает, скопируйте и вставьте эту ссылку в адресную строку браузера:
        </p>
        <p style="margin:0; font-size:13px; color:#4b5563; word-break:break-all;">
          ${magicLink}
        </p>
      </div>
    </div>
  `;
}

function buildText({ magicLink, salonName, context }: SendMagicLinkParams) {
  const title = context === "login" ? "Вход в Sound Spa" : "Добро пожаловать в Sound Spa";
  const intro =
    context === "login"
      ? "Вот ваша ссылка для входа в кабинет Sound Spa."
      : `Для салона "${salonName ?? "ваш салон"}" мы создали новый кабинет с тестовым доступом.`;

  return [
    title,
    "",
    intro,
    "",
    "Перейдите по ссылке, чтобы войти:",
    magicLink,
  ].join("\n");
}

export async function sendMagicLinkEmail(params: SendMagicLinkParams) {
  if (!client) {
    throw new Error("AgentMail client is not configured");
  }

  const subject =
    params.context === "login" ? "Вход в Sound Spa" : "Добро пожаловать в Sound Spa";

  const sent = await client.inboxes.messages.send(AGENTMAIL_FROM, {
    to: params.to,
    subject,
    text: buildText(params),
    html: buildHtml(params),
  });

  console.log(
    "[agentmail] message sent",
    // разные версии SDK могут называть поле id по-разному
    (sent as any)?.id || (sent as any)?.message_id || "(no id)",
  );
}

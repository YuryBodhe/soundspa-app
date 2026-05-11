import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendMagicLinkEmail(params: { 
  to: string; 
  url?: string; 
  magicLink?: string; 
  context: string;
  [key: string]: any;
}) {
  const finalLink = params.url || params.magicLink;
  const subject = params.context === "login" ? "Вход в Sound Spa" : "Добро пожаловать в Sound Spa";

  try {
    const { data, error } = await resend.emails.send({
      // ТЕПЕРЬ МЫ ШЛЕМ ОТ ИМЕНИ ТВОЕГО ДОМЕНА
      from: 'Sound Spa <send@bodhemusic.com>',
      to: [params.to],
      subject: subject,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333; line-height: 1.5;">
          <h2 style="color: #000;">Привет!</h2>
          <p>Нажми на кнопку ниже, чтобы войти в свой аккаунт <strong>Sound Spa</strong>:</p>
          <div style="margin: 30px 0;">
            <a href="${finalLink}" style="background-color: #000; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Войти в Sound Spa</a>
          </div>
          <p style="font-size: 12px; color: #888;">Если кнопка не открывается, скопируй эту ссылку в браузер:</p>
          <p style="font-size: 12px; color: #888; word-break: break-all;">${finalLink}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;">
          <p style="font-size: 11px; color: #aaa;">Это письмо отправлено автоматически. Если ты его не ждал, просто проигнорируй.</p>
        </div>
      `,
    });

    if (error) {
      return console.error("❌ [Resend Error]:", error);
    }
    console.log("✅ [Resend Success]: Email sent!", data?.id);
  } catch (error) {
    console.error("🚨 [Resend Connection Error]:", error);
  }
}
import { Resend } from "resend";
import type { RenderedCustomerEmail } from "./customerAuthEmails";

export interface CustomerMailSender {
  send(input: { to: string; message: RenderedCustomerEmail }): Promise<void>;
}

export class ResendCustomerMailSender implements CustomerMailSender {
  async send(input: { to: string; message: RenderedCustomerEmail }): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.V2_AUTH_EMAIL_FROM;
    if (!apiKey || !from) throw new Error("Customer email delivery is not configured");
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: input.to,
      subject: input.message.subject,
      text: input.message.text,
      html: input.message.html,
    });
    if (result.error) throw new Error("Customer email delivery failed");
  }
}

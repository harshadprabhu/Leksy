import { interpolate, type Ctx } from "@leksy/template-engine";
import nodemailer from "nodemailer";

export type Channel = "whatsapp" | "sms" | "email";

export interface SendInput {
  to: string;
  ctx: Ctx;
  pageUrl: string;
  pdfUrl?: string;
  token: string;
  /** Brand-level channel settings from brands.settings.channels. */
  settings: ChannelSettings;
}

export interface SendResult {
  providerMessageId?: string;
  /** Dev mode: the message was only logged. */
  simulated?: boolean;
}

export interface ChannelSettings {
  whatsapp?: {
    phoneNumberId?: string;
    accessToken?: string;
    templateName?: string;
    language?: string;
    /** Body variables of the approved template, as Leksy expressions. */
    bodyParams?: string[];
    /** Attach the PDF as the template's document header. */
    attachPdf?: boolean;
  };
  sms?: { senderId?: string; dltTemplateId?: string; text?: string };
  email?: { from?: string; subject?: string };
}

export interface ChannelEnv {
  whatsappApiVersion: string;
  whatsappPhoneNumberId?: string;
  whatsappAccessToken?: string;
  smsHttpUrl?: string;
  smsHttpToken?: string;
  smtpUrl?: string;
  emailFrom: string;
  /** When true, nothing is sent; messages are logged. */
  dryRun: boolean;
  log: (msg: string, data?: unknown) => void;
}

export class ChannelError extends Error {
  constructor(
    message: string,
    /** Permanent errors (bad number, no consent) skip retries and fall through to the next channel. */
    public readonly permanent = false,
  ) {
    super(message);
  }
}

async function sendWhatsApp(input: SendInput, env: ChannelEnv): Promise<SendResult> {
  const s = input.settings.whatsapp ?? {};
  const phoneNumberId = s.phoneNumberId ?? env.whatsappPhoneNumberId;
  const token = s.accessToken ?? env.whatsappAccessToken;
  const templateName = s.templateName ?? "leksy_ebill";
  const params = (s.bodyParams ?? ["{{customer.name | default:'there'}}", "{{brand.name}}", "{{total | inr}}"]).map((p) => interpolate(p, input.ctx) || "-");
  const components: unknown[] = [
    { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
    // The approved template's URL button is https://<bill domain>/b/{{1}}; we pass the token.
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: input.token }] },
  ];
  if (s.attachPdf && input.pdfUrl) {
    components.unshift({ type: "header", parameters: [{ type: "document", document: { link: input.pdfUrl, filename: `${interpolate("{{invoice_no}}", input.ctx)}.pdf` } }] });
  }
  const body = {
    messaging_product: "whatsapp",
    to: input.to.replace(/^\+/, ""),
    type: "template",
    template: { name: templateName, language: { code: s.language ?? "en" }, components },
  };
  if (env.dryRun || !phoneNumberId || !token) {
    env.log("whatsapp (dry run)", { to: input.to, template: templateName, params, link: input.pageUrl });
    return { simulated: true, providerMessageId: `dry_${Date.now()}` };
  }
  const res = await fetch(`https://graph.facebook.com/${env.whatsappApiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string; code: number } };
  if (!res.ok) {
    // 131026: undeliverable / not a WhatsApp user; 131047: re-engagement window; 132xxx: template problems.
    const code = json.error?.code ?? 0;
    throw new ChannelError(`WhatsApp ${res.status}: ${json.error?.message ?? "unknown error"}`, [131026, 131047, 131051, 132000, 132001].includes(code) || res.status === 400);
  }
  return { providerMessageId: json.messages?.[0]?.id };
}

async function sendSms(input: SendInput, env: ChannelEnv): Promise<SendResult> {
  const s = input.settings.sms ?? {};
  const text = interpolate(s.text ?? "Thank you for shopping at {{brand.name}}. Your e-bill for {{total | inr}}: ", input.ctx) + input.pageUrl;
  if (env.dryRun || !env.smsHttpUrl) {
    env.log("sms (dry run)", { to: input.to, text });
    return { simulated: true, providerMessageId: `dry_${Date.now()}` };
  }
  // Generic HTTP gateway (MSG91, Gupshup, Kaleyra...). India requires DLT-registered sender and template.
  const res = await fetch(env.smsHttpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...(env.smsHttpToken ? { authorization: `Bearer ${env.smsHttpToken}` } : {}) },
    body: JSON.stringify({ to: input.to, text, sender: s.senderId, dlt_template_id: s.dltTemplateId }),
  });
  if (!res.ok) throw new ChannelError(`SMS gateway ${res.status}`, res.status >= 400 && res.status < 500);
  const json = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string };
  return { providerMessageId: json.id ?? json.message_id };
}

let transport: nodemailer.Transporter | null = null;

async function sendEmail(input: SendInput, env: ChannelEnv): Promise<SendResult> {
  const s = input.settings.email ?? {};
  const subject = interpolate(s.subject ?? "Your {{brand.name}} bill {{invoice_no}}", input.ctx);
  const name = interpolate("{{customer.name | default:'there'}}", input.ctx);
  const brand = interpolate("{{brand.name}}", input.ctx);
  const total = interpolate("{{total | inr}}", input.ctx);
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px"><h2 style="font-weight:500">Hi ${esc(name)},</h2><p>Thank you for shopping at ${esc(brand)}. Your bill for <b>${esc(total)}</b> is ready.</p><p><a href="${esc(input.pageUrl)}" style="display:inline-block;padding:12px 20px;background:#b08d57;color:#fff;border-radius:999px;text-decoration:none">View your bill</a></p><p style="color:#888;font-size:12px">Tell us how your visit went — it takes 10 seconds.</p></div>`;
  if (env.dryRun || !env.smtpUrl) {
    env.log("email (dry run)", { to: input.to, subject, link: input.pageUrl });
    return { simulated: true, providerMessageId: `dry_${Date.now()}` };
  }
  transport ??= nodemailer.createTransport(env.smtpUrl);
  const info = await transport.sendMail({ from: s.from ?? env.emailFrom, to: input.to, subject, html, text: `Your bill: ${input.pageUrl}` });
  return { providerMessageId: info.messageId };
}

export async function send(channel: Channel, input: SendInput, env: ChannelEnv): Promise<SendResult> {
  switch (channel) {
    case "whatsapp":
      return sendWhatsApp(input, env);
    case "sms":
      return sendSms(input, env);
    case "email":
      return sendEmail(input, env);
  }
}

/** Send a plain alert text (store manager notifications). */
export async function sendAlert(to: { phone?: string | null; email?: string | null }, text: string, env: ChannelEnv): Promise<void> {
  if (env.dryRun || (!env.smsHttpUrl && !env.smtpUrl && !env.whatsappAccessToken)) {
    env.log("alert (dry run)", { to, text });
    return;
  }
  if (to.email && env.smtpUrl) {
    transport ??= nodemailer.createTransport(env.smtpUrl);
    await transport.sendMail({ from: env.emailFrom, to: to.email, subject: "Leksy alert: unhappy customer", text });
  }
  if (to.phone && env.smsHttpUrl) {
    await fetch(env.smsHttpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: to.phone, text }) });
  }
}

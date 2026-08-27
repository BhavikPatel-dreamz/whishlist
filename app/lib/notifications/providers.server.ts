import type { ResolvedNotificationSettings } from "../shop.server";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

/**
 * Providers are plain fetch calls — no vendor SDKs — so the app stays dependency-light
 * and every provider fails the same way.
 */
export async function sendEmail(
  settings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  if (!settings.apiKey) return { ok: false, error: "No email provider API key configured" };
  if (!settings.senderEmail) return { ok: false, error: "No sender email configured" };

  try {
    switch (settings.provider) {
      case "sendgrid":
        return await sendWithSendgrid(settings, message);
      case "klaviyo":
        return await sendWithKlaviyo(settings, message);
      case "brevo":
        return await sendWithBrevo(settings, message);
      case "resend":
      default:
        return await sendWithResend(settings, message);
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const from = (s: ResolvedNotificationSettings) =>
  s.senderName ? `${s.senderName} <${s.senderEmail}>` : s.senderEmail;

async function sendWithResend(
  settings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from(settings),
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) return { ok: false, error: payload.message || `Resend HTTP ${response.status}` };
  return { ok: true, id: payload.id };
}

/**
 * Brevo (formerly Sendinblue) transactional email. Auth is the raw `xkeysib-…` key in the
 * `api-key` header (not a Bearer token). The sender email must be a verified sender/domain in
 * the Brevo account, or Brevo rejects the send with a "sender not valid" error.
 */
async function sendWithBrevo(
  settings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": settings.apiKey || process.env.BREVO_API_KEY || "",
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: settings.senderEmail || "hingurusali@gmail.com", name: settings.senderName || undefined },
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { messageId?: string; message?: string };
  if (!response.ok) return { ok: false, error: payload.message || `Brevo HTTP ${response.status}` };
  return { ok: true, id: payload.messageId };
}

async function sendWithSendgrid(
  settings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: settings.senderEmail, name: settings.senderName || undefined },
      subject: message.subject,
      content: [
        { type: "text/plain", value: message.text },
        { type: "text/html", value: message.html },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `SendGrid HTTP ${response.status} ${body.slice(0, 200)}` };
  }
  return { ok: true, id: response.headers.get("x-message-id") || undefined };
}

/**
 * Klaviyo has no generic "send this HTML" endpoint on the public API, so we push a
 * `Back in Stock` metric event carrying the rendered copy. Merchants bind that metric
 * to a Klaviyo flow that owns the actual delivery.
 */
async function sendWithKlaviyo(
  settings: ResolvedNotificationSettings,
  message: EmailMessage & { properties?: Record<string, unknown> },
): Promise<SendResult> {
  const response = await fetch("https://a.klaviyo.com/api/events/", {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${settings.apiKey}`,
      "Content-Type": "application/json",
      accept: "application/json",
      revision: "2024-10-15",
    },
    body: JSON.stringify({
      data: {
        type: "event",
        attributes: {
          properties: {
            subject: message.subject,
            html: message.html,
            ...(message.properties || {}),
          },
          metric: { data: { type: "metric", attributes: { name: "Back in Stock" } } },
          profile: {
            data: { type: "profile", attributes: { email: message.to } },
          },
        },
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `Klaviyo HTTP ${response.status} ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

/** Optional SMS delivery through Twilio's REST API. */
export async function sendSms(
  settings: ResolvedNotificationSettings,
  to: string,
  body: string,
): Promise<SendResult> {
  if (!settings.smsEnabled) return { ok: false, error: "SMS disabled" };
  const { twilioAccountSid: sid, twilioAuthToken: token, twilioFromNumber: sender } = settings;
  if (!sid || !token || !sender) return { ok: false, error: "Twilio credentials incomplete" };

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: sender, Body: body }).toString(),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!response.ok) return { ok: false, error: payload.message || `Twilio HTTP ${response.status}` };
    return { ok: true, id: payload.sid };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

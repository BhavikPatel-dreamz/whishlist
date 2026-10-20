import type { ResolvedNotificationSettings } from "../shop.server";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type SendResult =
  { ok: true; id?: string } | { ok: false; error: string };

type EmailProvider = ResolvedNotificationSettings["provider"];

/**
 * Brevo, Resend and SendGrid API keys carry an unambiguous vendor prefix. When a merchant
 * pastes (say) a Brevo `xkeysib-…` key while the provider dropdown still points at Resend, the
 * send fails with a cryptic "API key is invalid". Detecting the prefix lets us route the message
 * to the provider the key actually belongs to instead of dropping the notification.
 */
export function providerFromApiKey(apiKey: string): EmailProvider | null {
  const key = apiKey.trim();
  if (key.startsWith("xkeysib-")) return "brevo";
  if (key.startsWith("re_")) return "resend";
  if (key.startsWith("SG.")) return "sendgrid";
  return null;
}

/**
 * Live server ma settings ma apiKey / senderEmail khali hoy to .env / hosting env variables
 * ma thi fallback lo. (BREVO_API_KEY, DEFAULT_SENDER_EMAIL)
 */
function withEnvFallback(
  settings: ResolvedNotificationSettings,
): ResolvedNotificationSettings {
  return {
    ...settings,
    apiKey: settings.apiKey || process.env.BREVO_API_KEY || "",
    senderEmail:
      settings.senderEmail || process.env.DEFAULT_SENDER_EMAIL || "",
  };
}

/**
 * Public entry point. Wraps the real send and ALWAYS logs the outcome, so failures on the
 * live server show up in the hosting logs instead of failing silently.
 * (API key kyay log thati nathi.)
 */
export async function sendEmail(
  rawSettings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  const settings = withEnvFallback(rawSettings);
  const provider = providerFromApiKey(settings.apiKey || "") ?? settings.provider;

  const result = await sendEmailInner(settings, message);

  if (result.ok) {
    console.log("[EMAIL SENT]", {
      to: message.to,
      provider,
      id: result.id,
    });
  } else {
    console.error("[EMAIL FAILED]", {
      to: message.to,
      provider,
      sender: settings.senderEmail || "(missing)",
      hasApiKey: Boolean(settings.apiKey),
      error: result.error,
    });
  }
  return result;
}

/**
 * Providers are plain fetch calls — no vendor SDKs — so the app stays dependency-light
 * and every provider fails the same way.
 */
async function sendEmailInner(
  settings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  if (!settings.apiKey)
    return { ok: false, error: "No email provider API key configured" };

  const provider = providerFromApiKey(settings.apiKey) ?? settings.provider;
  if (provider !== "klaviyo" && !settings.senderEmail)
    return { ok: false, error: "No sender email configured" };

  try {
    switch (provider) {
      case "sendgrid":
        return await sendWithSendgrid(settings, message);
      case "klaviyo":
        return await sendWithKlaviyo(settings, message);
      case "mailgun":
        return await sendWithMailgun(settings, message);
      case "brevo":
        return await sendWithBrevo(settings, message);
      case "resend":
      default:
        return await sendWithResend(settings, message);
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const from = (s: ResolvedNotificationSettings) =>
  s.senderName ? `${s.senderName} <${s.senderEmail}>` : s.senderEmail;

/**
 * Every provider is a POST that yields the same success/failure shape, so the
 * transport (fetch + status/JSON/text error handling) lives here once.
 */
async function postProviderRequest(
  url: string,
  init: RequestInit,
  {
    label,
    idField,
    idHeader,
    textError = false,
    formatError,
  }: {
    label: string;
    /** Payload field carrying the provider message id. */
    idField?: string;
    /** Response header carrying the provider message id. */
    idHeader?: string;
    /** Read the failure body as text (SendGrid/Klaviyo style). */
    textError?: boolean;
    formatError?: (payload: Record<string, any>, status: number) => string;
  },
): Promise<SendResult> {
  const response = await fetch(url, init);

  if (!response.ok) {
    if (textError) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `${label} HTTP ${response.status} ${body.slice(0, 200)}` };
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    return {
      ok: false,
      error: formatError
        ? formatError(payload, response.status)
        : payload.message || `${label} HTTP ${response.status}`,
    };
  }

  if (idHeader) {
    return { ok: true, id: response.headers.get(idHeader) || undefined };
  }
  if (idField) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    return { ok: true, id: payload[idField] };
  }
  return { ok: true };
}

async function sendWithResend(
  settings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  return postProviderRequest(
    "https://api.resend.com/emails",
    {
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
        reply_to: message.replyTo,
      }),
    },
    { label: "Resend", idField: "id" },
  );
}

/**
 * Brevo (formerly Sendinblue) transactional email. Auth is the raw `xkeysib-…` key in the
 * `api-key` header (not a Bearer token). The sender email must be a verified sender/domain in
 * the Brevo account, or Brevo rejects the send with a "sender not valid" error.
 *
 * Common failures:
 *  - 401 "unrecognised IP address"  -> Brevo > Security > Authorized IPs is ON (turn it off)
 *  - 400 "sender not valid"         -> sender email not verified in Brevo > Senders
 *  - 401 "Key not found"            -> wrong / revoked API key
 */
async function sendWithBrevo(
  settings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  if (!settings.senderEmail) {
    return {
      ok: false,
      error: "Sender email required for Brevo but not configured",
    };
  }

  return postProviderRequest(
    "https://api.brevo.com/v3/smtp/email",
    {
      method: "POST",
      headers: {
        "api-key": settings.apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: settings.senderEmail,
          name: settings.senderName || undefined,
        },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        replyTo: message.replyTo ? { email: message.replyTo } : undefined,
      }),
    },
    {
      label: "Brevo",
      idField: "messageId",
      formatError: (payload, status) =>
        `Brevo HTTP ${status}${payload.code ? ` [${payload.code}]` : ""}: ${
          payload.message || "no message"
        }`,
    },
  );
}

/**
 * Mailgun transactional email. Auth is HTTP Basic with username `api` and the private API key.
 * The sending domain must be verified in Mailgun. The domain is taken from MAILGUN_DOMAIN when
 * set, otherwise derived from the sender email's domain.
 */
async function sendWithMailgun(
  settings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  if (!settings.senderEmail) {
    return {
      ok: false,
      error: "Sender email required for Mailgun but not configured",
    };
  }

  const domain =
    process.env.MAILGUN_DOMAIN || settings.senderEmail.split("@")[1] || "";
  if (!domain) {
    return { ok: false, error: "Mailgun sending domain not configured" };
  }

  const form = new URLSearchParams({
    from: from(settings),
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  if (message.replyTo) form.set("h:Reply-To", message.replyTo);

  return postProviderRequest(
    `https://api.mailgun.net/v3/${encodeURIComponent(domain)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${settings.apiKey}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
    { label: "Mailgun", idField: "id" },
  );
}

async function sendWithSendgrid(
  settings: ResolvedNotificationSettings,
  message: EmailMessage,
): Promise<SendResult> {
  return postProviderRequest(
    "https://api.sendgrid.com/v3/mail/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: {
          email: settings.senderEmail,
          name: settings.senderName || undefined,
        },
        reply_to: message.replyTo ? { email: message.replyTo } : undefined,
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      }),
    },
    { label: "SendGrid", idHeader: "x-message-id", textError: true },
  );
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
  return postProviderRequest(
    "https://a.klaviyo.com/api/events/",
    {
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
              ...(message.replyTo ? { reply_to: message.replyTo } : {}),
              ...(message.properties || {}),
            },
            metric: {
              data: { type: "metric", attributes: { name: "Back in Stock" } },
            },
            profile: {
              data: { type: "profile", attributes: { email: message.to } },
            },
          },
        },
      }),
    },
    { label: "Klaviyo", textError: true },
  );
}

/** Optional SMS delivery through Twilio's REST API. */
export async function sendSms(
  settings: ResolvedNotificationSettings,
  to: string,
  body: string,
): Promise<SendResult> {
  if (!settings.smsEnabled) return { ok: false, error: "SMS disabled" };

  try {
    return await sendWithTwilio(settings, to, body);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendWithTwilio(
  settings: ResolvedNotificationSettings,
  to: string,
  body: string,
): Promise<SendResult> {
  const {
    twilioAccountSid: sid,
    twilioAuthToken: token,
    twilioFromNumber: sender,
  } = settings;
  if (!sid || !token || !sender)
    return { ok: false, error: "Twilio credentials incomplete" };

  return postProviderRequest(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: sender,
        Body: body,
      }).toString(),
    },
    { label: "Twilio", idField: "sid" },
  );
}


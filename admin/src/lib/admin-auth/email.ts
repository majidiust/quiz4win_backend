import "server-only";

/**
 * Brevo (sendinblue) transactional email client.
 *
 * Configuration (env, all required at runtime):
 *   • BREVO_API_KEY     — issued from Brevo dashboard, kept server-side only
 *   • EMAIL_FROM        — defaults to noreply@quiz4win.com
 *   • EMAIL_FROM_NAME   — defaults to "Quiz4Win"
 *
 * Sending failures are logged but do not throw to the caller — the calling
 * route handler is expected to always succeed (eg /forgot-password returns
 * 200 even when no admin matches the email, to prevent enumeration).
 */

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("[email] BREVO_API_KEY is not set — refusing to send");
    return { ok: false, error: "email_provider_not_configured" };
  }

  const fromEmail = process.env.EMAIL_FROM ?? "noreply@quiz4win.com";
  const fromName = process.env.EMAIL_FROM_NAME ?? "Quiz4Win";

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email: input.to }],
    subject: input.subject,
    htmlContent: input.html,
    textContent: input.text,
    replyTo: input.replyTo ? { email: input.replyTo } : undefined,
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Brevo returned ${res.status} — ${body.slice(0, 200)}`);
      return { ok: false, error: `brevo_${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, messageId: data.messageId };
  } catch (err) {
    console.error("[email] Brevo request failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "brevo_network_error" };
  }
}

/** Base URL of the admin panel — used to build all admin-facing links. */
export function adminBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://panel.quiz4win.com";
  return base.replace(/\/$/, "");
}

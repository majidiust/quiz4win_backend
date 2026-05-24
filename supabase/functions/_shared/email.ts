/**
 * Deno-compatible email helpers for Supabase Edge Functions.
 *
 * Uses the Brevo (Sendinblue) transactional email REST API via `fetch`
 * so it works without any npm packages.
 *
 * Shares the same brand design language as admin/src/lib/admin-auth/email-brand.ts
 * (dark Q4W header, indigo CTA, responsible-play footer) but avoids any
 * Node.js / Next.js-specific imports.
 */

// ─── Brevo transactional API ────────────────────────────────────────────────

interface SendEmailOpts {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const from = Deno.env.get("EMAIL_FROM") ?? "noreply@quiz4win.com";
  if (!apiKey) {
    console.warn("[email] BREVO_API_KEY not set — email not sent");
    return;
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Quiz4Win", email: from },
      to: [opts.to],
      subject: opts.subject,
      htmlContent: opts.html,
      textContent: opts.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[email] Brevo error ${res.status}: ${body}`);
  }
}

// ─── Brand shell ─────────────────────────────────────────────────────────────

const BRAND = {
  primary: "#5B6BF5", dark: "#0F172A", darker: "#0B1124",
  textDark: "#0F172A", textMuted: "#475569", textFaint: "#94A3B8",
  bg: "#F4F5FB", surface: "#FFFFFF", border: "#E2E8F0",
  win: "#22C55E", gold: "#F59E0B",
} as const;

function logoUrl(): string {
  const override = Deno.env.get("EMAIL_LOGO_URL");
  if (override) return override;
  const panel = (Deno.env.get("NEXT_PUBLIC_ADMIN_URL") ?? "https://panel.quiz4win.com").replace(/\/$/, "");
  return `${panel}/email/q4w_text_logo.png`;
}

function ctaButton(label: string, url: string, bg: string, fg: string): string {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:32px auto"><tr><td align="center" bgcolor="${bg}" style="border-radius:10px">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:260px" arcsize="20%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:700">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${url}" target="_blank" style="display:inline-block;background:${bg};color:${fg};text-decoration:none;padding:14px 28px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:1">${label}</a><!--<![endif]-->
</td></tr></table>`;
}

interface BrandEmailInput {
  preheader: string;
  heroTitle: string;
  heroSubtitle?: string;
  bodyHtml: string;
  cta?: { label: string; url: string; bg?: string; fg?: string };
  ctaNote?: string;
  text: string;
}

function renderBrandEmail(input: BrandEmailInput): { html: string; text: string } {
  const cta = input.cta
    ? ctaButton(input.cta.label, input.cta.url, input.cta.bg ?? BRAND.primary, input.cta.fg ?? "#FFFFFF")
    : "";
  const ctaNote = input.ctaNote
    ? `<p style="margin:-12px 0 24px;text-align:center;font-size:12px;color:${BRAND.textFaint}">${input.ctaNote}</p>`
    : "";
  const subtitle = input.heroSubtitle
    ? `<p style="margin:8px 0 0;font-size:15px;line-height:1.55;color:${BRAND.textMuted}">${input.heroSubtitle}</p>`
    : "";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quiz4Win</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.textDark}">
<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${input.preheader}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${BRAND.bg}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${BRAND.surface};border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)">
<tr><td bgcolor="${BRAND.dark}" style="background:${BRAND.dark};padding:24px 32px">
<img src="${logoUrl()}" alt="Quiz4Win" height="36" style="display:block;height:36px;width:auto;border:0">
</td></tr>
<tr><td style="padding:36px 36px 8px">
<h1 style="margin:0;font-size:24px;line-height:1.25;color:${BRAND.textDark};font-weight:700">${input.heroTitle}</h1>${subtitle}
</td></tr>
<tr><td style="padding:20px 36px 8px;font-size:15px;line-height:1.65;color:${BRAND.textDark}">${input.bodyHtml}</td></tr>
${cta ? `<tr><td style="padding:0 36px" align="center">${cta}</td></tr>` : ""}
${ctaNote ? `<tr><td style="padding:0 36px">${ctaNote}</td></tr>` : ""}
<tr><td style="padding:16px 36px 32px"><div style="border-top:1px solid ${BRAND.border};margin-top:8px"></div></td></tr>
<tr><td bgcolor="${BRAND.darker}" style="background:${BRAND.darker};padding:24px 36px">
<p style="margin:0 0 6px;font-size:12px;color:#CBD5E1"><strong style="color:#FFFFFF">Quiz4Win</strong> · Live interactive trivia entertainment</p>
<p style="margin:0;font-size:11px;color:${BRAND.textFaint}">Skill-based platform. 18+ where applicable. <strong>Play responsibly.</strong></p>
<p style="margin:14px 0 0;font-size:11px;color:${BRAND.textFaint}">You're receiving this because you have a Quiz4Win account. Please do not reply to this email.</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = `${input.heroTitle}\n${input.heroSubtitle ? input.heroSubtitle + "\n" : ""}\n${input.text}${input.cta ? `\n\n${input.cta.label}: ${input.cta.url}` : ""}${input.ctaNote ? `\n${input.ctaNote}` : ""}\n\n— Quiz4Win · 18+ where applicable. Play responsibly.`;
  return { html, text };
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Sent immediately after a customer signs up successfully. */
export function welcomeTemplate(opts: { name: string; appUrl?: string }): { subject: string; html: string; text: string } {
  const subject = "Welcome to Quiz4Win 🎉";
  const app = (opts.appUrl ?? Deno.env.get("APP_URL") ?? "https://app.quiz4win.com").replace(/\/$/, "");
  const { html, text } = renderBrandEmail({
    preheader: `Welcome to Quiz4Win, ${opts.name}! Start competing and win today.`,
    heroTitle: `Welcome, ${escapeHtml(opts.name)}! 🎉`,
    heroSubtitle: "You're in. Let's play.",
    bodyHtml: `<p style="margin:0 0 12px">Your Quiz4Win account is ready. Jump into a live trivia round, answer faster than everyone else, and climb the leaderboard.</p>
<p style="margin:0;color:#475569">The faster and more accurately you answer, the better your placement. Pure skill — no luck involved.</p>`,
    cta: { label: "Play Now →", url: `${app}/play` },
    text: `Your Quiz4Win account is ready. Jump into a live trivia round and compete. Answer faster and more accurately than everyone else to climb the leaderboard — pure skill, no luck.`,
  });
  return { subject, html, text };
}

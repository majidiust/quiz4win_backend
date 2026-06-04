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
  // Served from the public static container (app.quiz4win.com) — no auth gate,
  // no Next.js middleware, reliably reachable by email-client image proxies.
  const app = (Deno.env.get("APP_URL") ?? "https://app.quiz4win.com").replace(/\/$/, "");
  return `${app}/q4w_text_logo.png`;
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

/** Sent when a customer requests a password reset. */
export function recoveryTemplate(opts: {
  name: string;
  actionUrl: string;
  otp?: string;
  ttlMinutes?: number;
}): { subject: string; html: string; text: string } {
  const subject = "Reset your Quiz4Win password";
  const ttl = opts.ttlMinutes ?? 60;
  const greeting = opts.name ? `Hi ${escapeHtml(opts.name)},` : "Hi,";
  const otpBlock = opts.otp
    ? `<p style="margin:20px 0 8px;font-size:13px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:.08em;font-weight:600">Or enter this code in the app</p>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 8px"><tr><td align="center" bgcolor="${BRAND.bg}" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;padding:18px 28px">
<p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:28px;letter-spacing:.35em;color:${BRAND.textDark};font-weight:700">${escapeHtml(opts.otp)}</p>
</td></tr></table>`
    : "";
  const { html, text } = renderBrandEmail({
    preheader: `Reset your Quiz4Win password — link expires in ${ttl} minutes.`,
    heroTitle: "Reset your password",
    heroSubtitle: "Choose a new password for your Quiz4Win account.",
    bodyHtml: `<p style="margin:0 0 12px">${greeting} we received a request to reset the password on your Quiz4Win account.</p>
<p style="margin:0 0 12px">Tap the button below to set a new password. The link is valid for ${ttl} minutes.</p>
${otpBlock}
<p style="margin:16px 0 0;color:${BRAND.textMuted}">If you didn't request this, you can safely ignore this email — your password will remain unchanged.</p>`,
    cta: { label: "Reset password →", url: opts.actionUrl },
    ctaNote: `This link expires in ${ttl} minutes.`,
    text: `${opts.name ? `Hi ${opts.name}, ` : ""}we received a request to reset your Quiz4Win password. Open this link to set a new password (expires in ${ttl} minutes): ${opts.actionUrl}${opts.otp ? `\n\nOr enter this code in the app: ${opts.otp}` : ""}\n\nIf you didn't request this, you can safely ignore this email.`,
  });
  return { subject, html, text };
}

/** Sent when a user requests an email 2FA code (setup / enable / disable). */
export function twoFactorCodeTemplate(opts: {
  name: string;
  code: string;
  purpose: "enable" | "disable";
  ttlMinutes?: number;
}): { subject: string; html: string; text: string } {
  const ttl = opts.ttlMinutes ?? 10;
  const greeting = opts.name ? `Hi ${escapeHtml(opts.name)},` : "Hi,";
  const action = opts.purpose === "enable" ? "turn on" : "turn off";
  const subject = `Your Quiz4Win verification code: ${opts.code}`;
  const codeBlock = `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:20px auto"><tr><td align="center" bgcolor="${BRAND.bg}" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;padding:18px 28px">
<p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:30px;letter-spacing:.35em;color:${BRAND.textDark};font-weight:700">${escapeHtml(opts.code)}</p>
</td></tr></table>`;
  const { html, text } = renderBrandEmail({
    preheader: `Your Quiz4Win verification code expires in ${ttl} minutes.`,
    heroTitle: "Your verification code",
    heroSubtitle: `Use this code to ${action} email-based two-factor authentication.`,
    bodyHtml: `<p style="margin:0 0 12px">${greeting} enter the code below in the Quiz4Win app to ${action} email two-factor authentication on your account.</p>
${codeBlock}
<p style="margin:8px 0 0;text-align:center;color:${BRAND.textFaint};font-size:12px">This code expires in ${ttl} minutes.</p>
<p style="margin:24px 0 0;color:${BRAND.textMuted}">If you didn't request this, you can ignore this email — your security settings will remain unchanged.</p>`,
    text: `${opts.name ? `Hi ${opts.name}, ` : ""}your Quiz4Win verification code is ${opts.code}. It expires in ${ttl} minutes. If you didn't request it, you can ignore this email.`,
  });
  return { subject, html, text };
}

/** Sent when a user submits a withdrawal request and must confirm it with an emailed code. */
export function withdrawalOtpTemplate(opts: {
  name: string;
  code: string;
  amountLabel: string;
  methodLabel: string;
  ttlMinutes?: number;
}): { subject: string; html: string; text: string } {
  const ttl = opts.ttlMinutes ?? 10;
  const greeting = opts.name ? `Hi ${escapeHtml(opts.name)},` : "Hi,";
  const subject = `Confirm your Quiz4Win withdrawal — code ${opts.code}`;
  const codeBlock = `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:20px auto"><tr><td align="center" bgcolor="${BRAND.bg}" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;padding:18px 28px">
<p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:30px;letter-spacing:.35em;color:${BRAND.textDark};font-weight:700">${escapeHtml(opts.code)}</p>
</td></tr></table>`;
  const { html, text } = renderBrandEmail({
    preheader: `Confirm your ${escapeHtml(opts.amountLabel)} withdrawal — code expires in ${ttl} minutes.`,
    heroTitle: "Confirm your withdrawal",
    heroSubtitle: `${escapeHtml(opts.amountLabel)} via ${escapeHtml(opts.methodLabel)}`,
    bodyHtml: `<p style="margin:0 0 12px">${greeting} we received a request to withdraw <strong>${escapeHtml(opts.amountLabel)}</strong> via <strong>${escapeHtml(opts.methodLabel)}</strong> from your Quiz4Win account.</p>
<p style="margin:0 0 12px">Enter the code below in the app to confirm. Your funds will only be debited and sent for review after you confirm.</p>
${codeBlock}
<p style="margin:8px 0 0;text-align:center;color:${BRAND.textFaint};font-size:12px">This code expires in ${ttl} minutes.</p>
<p style="margin:24px 0 0;color:${BRAND.textMuted}">If you didn't request this withdrawal, do not share this code — ignore this email and your balance will remain unchanged.</p>`,
    text: `${opts.name ? `Hi ${opts.name}, ` : ""}confirm your ${opts.amountLabel} withdrawal via ${opts.methodLabel} on Quiz4Win with this code: ${opts.code}. It expires in ${ttl} minutes. If you didn't request this, ignore this email.`,
  });
  return { subject, html, text };
}

/** Sent to mobile early-access sign-ups (iOS + Android). */
export function earlyBirdWelcomeTemplate(opts: {
  name: string;
  platform: "ios" | "android";
  appUrl?: string;
}): { subject: string; html: string; text: string } {
  const app = (opts.appUrl ?? Deno.env.get("APP_URL") ?? "https://app.quiz4win.com").replace(/\/$/, "");
  const platformLabel = opts.platform === "ios" ? "iOS" : "Android";
  const subject = `You're in, ${opts.name} — Quiz4Win early access on ${platformLabel} 🎉`;
  const perksBlock = `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:16px 0 8px">
<tr><td bgcolor="#F4F5FB" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;padding:20px 22px">
  <p style="margin:0 0 12px;font-size:13px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:.08em;font-weight:700">What early access gets you</p>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
    <tr><td style="padding:6px 0;font-size:14px;color:${BRAND.textDark}"><span style="display:inline-block;width:22px;color:${BRAND.primary};font-weight:800">★</span>First access when the ${platformLabel} app launches</td></tr>
    <tr><td style="padding:6px 0;font-size:14px;color:${BRAND.textDark}"><span style="display:inline-block;width:22px;color:${BRAND.primary};font-weight:800">★</span>Exclusive launch-day bonus credits</td></tr>
    <tr><td style="padding:6px 0;font-size:14px;color:${BRAND.textDark}"><span style="display:inline-block;width:22px;color:${BRAND.primary};font-weight:800">★</span>Behind-the-scenes updates from the team</td></tr>
    <tr><td style="padding:6px 0;font-size:14px;color:${BRAND.textDark}"><span style="display:inline-block;width:22px;color:${BRAND.primary};font-weight:800">★</span>Invite-only early shows with bigger prize pools</td></tr>
  </table>
</td></tr></table>`;
  const { html, text } = renderBrandEmail({
    preheader: `You're on the Quiz4Win ${platformLabel} early-access list, ${opts.name}.`,
    heroTitle: `You're on the list, ${escapeHtml(opts.name)}! 🚀`,
    heroSubtitle: `You'll be first in line when Quiz4Win launches on ${platformLabel}.`,
    bodyHtml: `<p style="margin:0 0 12px">Thanks for signing up for early access. The Quiz4Win ${platformLabel} app is almost here — and as an early bird, you get the best seat in the house.</p>
${perksBlock}
<p style="margin:16px 0 0;color:${BRAND.textMuted}">In the meantime, you can play right now in your browser. See you on the leaderboard.</p>`,
    cta: { label: "Play in browser →", url: `${app}/play` },
    ctaNote: "We'll email you the moment the mobile app drops.",
    text: `You're on the Quiz4Win ${platformLabel} early-access list. We'll email you the moment the app launches.\n\nEarly access perks:\n• First access when the ${platformLabel} app launches\n• Exclusive launch-day bonus credits\n• Behind-the-scenes updates\n• Invite-only early shows with bigger prize pools\n\nIn the meantime, play in your browser: ${app}/play`,
  });
  return { subject, html, text };
}

/** Sent to a host applicant immediately after they submit the public form. */
export function hostApplicationReceivedTemplate(opts: {
  name: string;
  appUrl?: string;
}): { subject: string; html: string; text: string } {
  const app = (opts.appUrl ?? Deno.env.get("APP_URL") ?? "https://app.quiz4win.com").replace(/\/$/, "");
  const subject = `Thanks for applying to host on Quiz4Win, ${opts.name} 🎤`;
  const stepsBlock = `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:18px 0 8px">
<tr><td bgcolor="#F4F5FB" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;padding:22px 24px">
  <p style="margin:0 0 14px;font-size:13px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:.08em;font-weight:700">What happens next</p>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" width="34" style="padding:0 0 12px"><div style="width:26px;height:26px;line-height:26px;text-align:center;background:${BRAND.primary};color:#fff;border-radius:999px;font-size:13px;font-weight:800">1</div></td>
      <td valign="top" style="padding:2px 0 12px;font-size:14px;color:${BRAND.textDark}"><strong style="color:${BRAND.textDark}">Review</strong><br><span style="color:${BRAND.textMuted}">Our team reviews your application within 5 business days.</span></td>
    </tr>
    <tr>
      <td valign="top" width="34" style="padding:0 0 12px"><div style="width:26px;height:26px;line-height:26px;text-align:center;background:${BRAND.primary};color:#fff;border-radius:999px;font-size:13px;font-weight:800">2</div></td>
      <td valign="top" style="padding:2px 0 12px;font-size:14px;color:${BRAND.textDark}"><strong style="color:${BRAND.textDark}">Screen test</strong><br><span style="color:${BRAND.textMuted}">If you're a fit, we'll invite you to a short video call.</span></td>
    </tr>
    <tr>
      <td valign="top" width="34" style="padding:0"><div style="width:26px;height:26px;line-height:26px;text-align:center;background:${BRAND.primary};color:#fff;border-radius:999px;font-size:13px;font-weight:800">3</div></td>
      <td valign="top" style="padding:2px 0 0;font-size:14px;color:${BRAND.textDark}"><strong style="color:${BRAND.textDark}">Go live</strong><br><span style="color:${BRAND.textMuted}">Onboarding, scheduling, and your first Quiz4Win show.</span></td>
    </tr>
  </table>
</td></tr></table>`;
  const { html, text } = renderBrandEmail({
    preheader: `We've received your host application, ${opts.name}. We'll be in touch within 5 business days.`,
    heroTitle: `Thanks for applying, ${escapeHtml(opts.name)}! 🎤`,
    heroSubtitle: "Your host application is in — here's what happens next.",
    bodyHtml: `<p style="margin:0 0 12px">We're thrilled you want to host on Quiz4Win. Live trivia is what we do best, and great hosts are at the heart of every show.</p>
${stepsBlock}
<p style="margin:16px 0 0;color:${BRAND.textMuted}">If we need anything else, we'll reach out to this email directly. Please don't reply to this message.</p>`,
    cta: { label: "Watch a live show →", url: `${app}/live`, bg: BRAND.primary },
    ctaNote: "See what hosting on Quiz4Win looks like.",
    text: `Thanks for applying to host on Quiz4Win, ${opts.name}.\n\nWhat happens next:\n1. Review — our team reviews your application within 5 business days.\n2. Screen test — if you're a fit, we'll invite you to a short video call.\n3. Go live — onboarding, scheduling, and your first Quiz4Win show.\n\nIf we need anything else, we'll reach out to this email directly.\n\nWatch a live show: ${app}/live`,
  });
  return { subject, html, text };
}

/** Sent when a player wins a prize and it is credited to their wallet. */
export function winTemplate(opts: {
  name: string;
  gameTitle: string;
  rank: number | null;
  prizeAmountCents: number;
  appUrl?: string;
}): { subject: string; html: string; text: string } {
  const app = (opts.appUrl ?? Deno.env.get("APP_URL") ?? "https://app.quiz4win.com").replace(/\/$/, "");
  const amount = `$${(opts.prizeAmountCents / 100).toFixed(2)}`;
  const rankBadge = opts.rank
    ? `<span style="display:inline-block;background:${BRAND.gold};color:#0F172A;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:700">#${opts.rank} place</span>`
    : "";
  const subject = `🏆 You won ${amount} on Quiz4Win!`;
  const { html, text } = renderBrandEmail({
    preheader: `Congratulations, ${opts.name}! ${amount} has been credited to your wallet.`,
    heroTitle: `🏆 Congratulations, ${escapeHtml(opts.name)}!`,
    heroSubtitle: `You won ${amount} on ${escapeHtml(opts.gameTitle)}.`,
    bodyHtml: `${rankBadge ? `<p style="margin:0 0 16px">${rankBadge}</p>` : ""}
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0 16px">
<tr><td align="center" bgcolor="#ECFDF5" style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#065F46;text-transform:uppercase;letter-spacing:.08em;font-weight:600">Prize credited</p>
<p style="margin:0;font-size:32px;line-height:1;color:${BRAND.win};font-weight:800">${amount}</p>
</td></tr></table>
<p style="margin:0 0 12px">Your winnings have been added to your Quiz4Win wallet. You can use the balance to enter new games or withdraw it once KYC is verified.</p>
<p style="margin:0;color:${BRAND.textMuted}">Thanks for playing — see you in the next round.</p>`,
    cta: { label: "View Wallet →", url: `${app}/wallet`, bg: BRAND.win },
    text: `Congratulations, ${opts.name}! You won ${amount} on ${opts.gameTitle}${opts.rank ? ` (#${opts.rank} place)` : ""}. Your winnings have been credited to your Quiz4Win wallet. Visit ${app}/wallet to view your balance.`,
  });
  return { subject, html, text };
}

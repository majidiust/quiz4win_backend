import "server-only";

/**
 * Premium Quiz4Win email brand shell.
 *
 * All transactional and broadcast emails go through renderBrandEmail() so the
 * visual language stays in lock-step with quiz4win.com (dark header, indigo
 * primary, "Play Live. Compete Fast." voice, 18+ responsible-play footer).
 *
 * Style choices target the lowest-common-denominator mail client (Outlook,
 * Gmail, Apple Mail, mobile): nested tables for layout, fully inline CSS,
 * web-safe fallbacks, no <style> tags, no flexbox or grid.
 */

export const BRAND = {
  primary: "#5B6BF5",
  primaryDark: "#4452E8",
  dark: "#0F172A",
  darker: "#0B1124",
  textDark: "#0F172A",
  textMuted: "#475569",
  textFaint: "#94A3B8",
  bg: "#F4F5FB",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  win: "#22C55E",
  gold: "#F59E0B",
  danger: "#EF4444",
} as const;

export type CtaVariant = "primary" | "gold" | "win" | "dark";

export interface BrandEmailInput {
  /** Hidden 80-char teaser shown in the inbox preview pane. */
  preheader: string;
  /** Large headline at the top of the body. */
  heroTitle: string;
  /** Optional subtitle under heroTitle. */
  heroSubtitle?: string;
  /** Pre-rendered HTML for the body (paragraphs, lists, etc.) — must be already escaped. */
  bodyHtml: string;
  /** Optional primary call-to-action button. */
  cta?: { label: string; url: string; variant?: CtaVariant };
  /** Small note shown under the CTA (eg "Link expires in 30 minutes"). */
  ctaNote?: string;
  /** Plain-text equivalent — required so deliverability isn't dragged down. */
  text: string;
}

function logoUrl(): string {
  const base = process.env.EMAIL_LOGO_URL;
  if (base) return base;
  const panel = (process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://panel.quiz4win.com").replace(/\/$/, "");
  return `${panel}/email/q4w_text_logo.png`;
}

function ctaColor(variant: CtaVariant): { bg: string; fg: string } {
  switch (variant) {
    case "gold": return { bg: BRAND.gold, fg: "#1F1300" };
    case "win": return { bg: BRAND.win, fg: "#06210F" };
    case "dark": return { bg: BRAND.dark, fg: "#FFFFFF" };
    default: return { bg: BRAND.primary, fg: "#FFFFFF" };
  }
}

function ctaButton(label: string, url: string, variant: CtaVariant = "primary"): string {
  const { bg, fg } = ctaColor(variant);
  // Bulletproof button: MSO-conditional VML for Outlook, table fallback for everyone else.
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:32px auto"><tr><td align="center" bgcolor="${bg}" style="border-radius:10px">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:260px" arcsize="20%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:.3px">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${url}" target="_blank" style="display:inline-block;background:${bg};color:${fg};text-decoration:none;padding:14px 28px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:.3px;line-height:1">${label}</a><!--<![endif]-->
</td></tr></table>`;
}

export function renderBrandEmail(input: BrandEmailInput): { html: string; text: string } {
  const cta = input.cta ? ctaButton(input.cta.label, input.cta.url, input.cta.variant ?? "primary") : "";
  const ctaNote = input.ctaNote
    ? `<p style="margin:-12px 0 24px;text-align:center;font-size:12px;color:${BRAND.textFaint};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">${input.ctaNote}</p>`
    : "";
  const subtitle = input.heroSubtitle
    ? `<p style="margin:8px 0 0;font-size:15px;line-height:1.55;color:${BRAND.textMuted};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">${input.heroSubtitle}</p>`
    : "";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>Quiz4Win</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.textDark};-webkit-font-smoothing:antialiased">
<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${input.preheader}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${BRAND.bg}" style="background:${BRAND.bg}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${BRAND.surface};border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)">
<tr><td bgcolor="${BRAND.dark}" style="background:${BRAND.dark};padding:24px 32px" align="left">
<img src="${logoUrl()}" alt="Quiz4Win" height="36" style="display:block;height:36px;width:auto;border:0;outline:none;text-decoration:none">
</td></tr>
<tr><td style="padding:36px 36px 8px">
<h1 style="margin:0;font-size:24px;line-height:1.25;color:${BRAND.textDark};font-weight:700;letter-spacing:-.01em">${input.heroTitle}</h1>
${subtitle}
</td></tr>
<tr><td style="padding:20px 36px 8px;font-size:15px;line-height:1.65;color:${BRAND.textDark}">
${input.bodyHtml}
</td></tr>
${cta ? `<tr><td style="padding:0 36px" align="center">${cta}</td></tr>` : ""}
${ctaNote ? `<tr><td style="padding:0 36px">${ctaNote}</td></tr>` : ""}
<tr><td style="padding:16px 36px 32px"><div style="border-top:1px solid ${BRAND.border};margin-top:8px"></div></td></tr>
<tr><td bgcolor="${BRAND.darker}" style="background:${BRAND.darker};padding:24px 36px" align="left">
<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#CBD5E1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><strong style="color:#FFFFFF">Quiz4Win</strong> · Live interactive trivia entertainment</p>
<p style="margin:0;font-size:11px;line-height:1.55;color:${BRAND.textFaint}">Skill-based platform. Placement is determined by accuracy and response speed — not chance. Premium rounds and reward conversion are available only where permitted by local law. <strong>18+ where applicable. Play responsibly.</strong></p>
<p style="margin:14px 0 0;font-size:11px;color:${BRAND.textFaint}">You're receiving this because you have a Quiz4Win account. This is an automated message; please do not reply.</p>
</td></tr>
</table></td></tr></table></body></html>`;

  const text = `${input.heroTitle}\n${input.heroSubtitle ? input.heroSubtitle + "\n" : ""}\n${input.text}${input.cta ? `\n\n${input.cta.label}: ${input.cta.url}` : ""}${input.ctaNote ? `\n${input.ctaNote}` : ""}\n\n— Quiz4Win\nLive interactive trivia entertainment\n18+ where applicable. Play responsibly.`;
  return { html, text };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

import "server-only";

/**
 * Quiz4Win transactional email templates.
 *
 * Every template returns { subject, html, text } and routes its HTML through
 * renderBrandEmail() so the visual language (dark header with the wordmark,
 * indigo CTA, responsible-play footer) stays identical across every email.
 */

import { renderBrandEmail, escapeHtml } from "./email-brand";

// ─── Admin transactional ────────────────────────────────────────────────────

export function passwordResetTemplate(opts: { name: string; resetUrl: string; ttlMinutes: number }) {
  const subject = "Reset your Quiz4Win admin password";
  const { html, text } = renderBrandEmail({
    preheader: `Reset your password — link expires in ${opts.ttlMinutes} minutes.`,
    heroTitle: "Reset your password",
    heroSubtitle: `Hi ${escapeHtml(opts.name)}, we received a request to reset the password on your Quiz4Win admin account.`,
    bodyHtml: `<p style="margin:0 0 12px">Click the button below to choose a new password.</p>
<p style="margin:0;color:#475569">If you didn't request this, you can safely ignore this email — your password will remain unchanged.</p>`,
    cta: { label: "Reset password", url: opts.resetUrl, variant: "primary" },
    ctaNote: `Link expires in ${opts.ttlMinutes} minutes.`,
    text: `We received a request to reset the password on your Quiz4Win admin account. Open the link below within ${opts.ttlMinutes} minutes to choose a new password. If you didn't request this, ignore this email.`,
  });
  return { subject, html, text };
}

export function inviteTemplate(opts: { name: string; activationUrl: string; role: string; inviterName: string; ttlHours: number }) {
  const subject = "You've been invited to the Quiz4Win admin console";
  const { html, text } = renderBrandEmail({
    preheader: `${opts.inviterName} invited you to Quiz4Win Admin as ${opts.role}.`,
    heroTitle: "Welcome to Quiz4Win Admin",
    heroSubtitle: `${escapeHtml(opts.inviterName)} has invited you to join as ${escapeHtml(opts.role)}.`,
    bodyHtml: `<p style="margin:0 0 12px">Hi ${escapeHtml(opts.name)}, activate your account to set a password and enrol multi-factor authentication.</p>
<p style="margin:0;color:#475569">This invitation is valid for ${opts.ttlHours} hours.</p>`,
    cta: { label: "Activate your account", url: opts.activationUrl, variant: "primary" },
    ctaNote: `Invitation expires in ${opts.ttlHours} hours.`,
    text: `${opts.inviterName} invited you to Quiz4Win Admin as ${opts.role}. Activate within ${opts.ttlHours} hours.`,
  });
  return { subject, html, text };
}

export function passwordChangedTemplate(opts: { name: string; ipAddress: string | null; at: Date }) {
  const subject = "Your Quiz4Win admin password was changed";
  const stamp = opts.at.toUTCString();
  const { html, text } = renderBrandEmail({
    preheader: `Security notice: your admin password was changed at ${stamp}.`,
    heroTitle: "Password changed",
    heroSubtitle: `This is a confirmation that the password on your Quiz4Win admin account was changed.`,
    bodyHtml: `<p style="margin:0 0 12px">Hi ${escapeHtml(opts.name)},</p>
<p style="margin:0 0 12px">Change recorded on <strong>${stamp}</strong>${opts.ipAddress ? ` from IP <code style="font-family:Menlo,Consolas,monospace;font-size:13px">${escapeHtml(opts.ipAddress)}</code>` : ""}.</p>
<p style="margin:0;color:#475569">If you did not perform this change, contact a super admin immediately — all your sessions have already been revoked.</p>`,
    text: `Your Quiz4Win admin password was changed at ${stamp}${opts.ipAddress ? ` from ${opts.ipAddress}` : ""}. If this wasn't you, contact a super admin immediately.`,
  });
  return { subject, html, text };
}

// ─── Customer transactional ─────────────────────────────────────────────────

export function customerMagicLinkTemplate(opts: { name: string; actionUrl: string }) {
  const subject = "Your Quiz4Win sign-in link";
  const greeting = opts.name ? ` ${escapeHtml(opts.name)}` : "";
  const { html, text } = renderBrandEmail({
    preheader: "One-click sign-in to Quiz4Win — link can be used only once.",
    heroTitle: "Sign in to Quiz4Win",
    heroSubtitle: "Your one-click sign-in link is ready.",
    bodyHtml: `<p style="margin:0 0 12px">Hi${greeting}, an administrator generated a one-click sign-in link for your account.</p>
<p style="margin:0;color:#475569">If you weren't expecting this email, you can safely ignore it.</p>`,
    cta: { label: "Sign in to Quiz4Win", url: opts.actionUrl, variant: "primary" },
    ctaNote: "This link can only be used once.",
    text: `An administrator generated a one-click sign-in link for your Quiz4Win account. Open the link below to sign in. The link can only be used once. If you weren't expecting this, ignore the email.`,
  });
  return { subject, html, text };
}

export function customerRecoveryTemplate(opts: { name: string; actionUrl: string }) {
  const subject = "Reset your Quiz4Win password";
  const greeting = opts.name ? ` ${escapeHtml(opts.name)}` : "";
  const { html, text } = renderBrandEmail({
    preheader: "Reset your Quiz4Win password.",
    heroTitle: "Reset your password",
    heroSubtitle: "Choose a new password for your Quiz4Win account.",
    bodyHtml: `<p style="margin:0 0 12px">Hi${greeting}, an administrator requested a password reset on your Quiz4Win account.</p>
<p style="margin:0;color:#475569">If you didn't request this, you can safely ignore this email — your password will remain unchanged.</p>`,
    cta: { label: "Reset password", url: opts.actionUrl, variant: "primary" },
    text: `An administrator requested a password reset on your Quiz4Win account. Open the link below to choose a new password. If you didn't request this, ignore the email.`,
  });
  return { subject, html, text };
}

import "server-only";

/**
 * HTML/text templates for admin transactional emails. Kept intentionally
 * simple (single-column, inline styles only) so they render reliably across
 * mail clients. The from address is always noreply@quiz4win.com.
 */

function wrap(title: string, body: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(15,23,42,.06)">
<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${title}</h1>
${body}
<hr style="border:0;border-top:1px solid #e2e8f0;margin:32px 0">
<p style="font-size:12px;color:#64748b;margin:0">This is an automated message from Quiz4Win Admin. Please do not reply.</p>
</div></body></html>`;
}

export function passwordResetTemplate(opts: { name: string; resetUrl: string; ttlMinutes: number }) {
  const subject = "Reset your Quiz4Win admin password";
  const html = wrap(
    "Password reset request",
    `<p>Hello ${escapeHtml(opts.name)},</p>
     <p>We received a request to reset the password on your Quiz4Win admin account.
        Click the button below to choose a new password. The link is valid for
        <strong>${opts.ttlMinutes} minutes</strong>.</p>
     <p style="margin:24px 0"><a href="${opts.resetUrl}"
        style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">
        Reset password</a></p>
     <p style="font-size:13px;color:#475569">If the button doesn't work, copy and paste this URL into your browser:<br>
        <a href="${opts.resetUrl}" style="color:#0f172a;word-break:break-all">${opts.resetUrl}</a></p>
     <p style="font-size:13px;color:#475569">If you didn't request this, you can safely ignore this email — your password will remain unchanged.</p>`,
  );
  const text = `Reset your Quiz4Win admin password\n\nHello ${opts.name},\n\nOpen this link within ${opts.ttlMinutes} minutes to choose a new password:\n${opts.resetUrl}\n\nIf you didn't request this, ignore this email.`;
  return { subject, html, text };
}

export function inviteTemplate(opts: { name: string; activationUrl: string; role: string; inviterName: string; ttlHours: number }) {
  const subject = "You've been invited to the Quiz4Win admin console";
  const html = wrap(
    "Welcome to Quiz4Win Admin",
    `<p>Hello ${escapeHtml(opts.name)},</p>
     <p>${escapeHtml(opts.inviterName)} has invited you to join the Quiz4Win admin console as
        <strong>${escapeHtml(opts.role)}</strong>.</p>
     <p>Click the button below to set your password and enrol multi-factor authentication.
        The invitation is valid for <strong>${opts.ttlHours} hours</strong>.</p>
     <p style="margin:24px 0"><a href="${opts.activationUrl}"
        style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">
        Activate your account</a></p>
     <p style="font-size:13px;color:#475569">Link not clickable? Copy and paste this URL:<br>
        <a href="${opts.activationUrl}" style="color:#0f172a;word-break:break-all">${opts.activationUrl}</a></p>`,
  );
  const text = `Welcome to Quiz4Win Admin\n\n${opts.inviterName} has invited you as ${opts.role}.\nActivate within ${opts.ttlHours} hours:\n${opts.activationUrl}`;
  return { subject, html, text };
}

export function passwordChangedTemplate(opts: { name: string; ipAddress: string | null; at: Date }) {
  const subject = "Your Quiz4Win admin password was changed";
  const html = wrap(
    "Password changed",
    `<p>Hello ${escapeHtml(opts.name)},</p>
     <p>This is a confirmation that the password on your Quiz4Win admin account was changed on
        <strong>${opts.at.toUTCString()}</strong>${opts.ipAddress ? ` from IP <code>${escapeHtml(opts.ipAddress)}</code>` : ""}.</p>
     <p>If you did not perform this change, contact a super admin immediately — all your sessions have already been revoked.</p>`,
  );
  const text = `Your Quiz4Win admin password was changed at ${opts.at.toUTCString()}${opts.ipAddress ? ` from ${opts.ipAddress}` : ""}. If this wasn't you, contact a super admin immediately.`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

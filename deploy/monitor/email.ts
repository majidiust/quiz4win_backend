/**
 * Quiz4Win — Monitor email helper (self-contained, Deno).
 *
 * Sends mobile-friendly alert / recovery emails via the Brevo (Sendinblue)
 * transactional REST API using `fetch` — no npm packages, no reverse imports
 * from supabase/functions (R-06). Mirrors the brand look of
 * supabase/functions/_shared/email.ts but is standalone so the monitor
 * container builds from its own context only.
 *
 * R-01: the Brevo key is read from env and never logged.
 */

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  latencyMs: number;
}

const BRAND = {
  primary: "#5B6BF5", dark: "#0F172A", darker: "#0B1124",
  textDark: "#0F172A", textMuted: "#475569", textFaint: "#94A3B8",
  bg: "#F4F5FB", surface: "#FFFFFF", border: "#E2E8F0",
  ok: "#22C55E", down: "#EF4444",
} as const;

interface SendArgs { subject: string; html: string; text: string }

/** Fire the Brevo request. Never throws — logs and returns on failure. */
export async function sendEmail(args: SendArgs): Promise<boolean> {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const from = Deno.env.get("EMAIL_FROM") ?? "noreply@quiz4win.com";
  const to = Deno.env.get("MONITOR_RECIPIENT") ?? "majid.sadeghi.alavijeh@gmail.com";
  if (!apiKey) {
    console.warn("[monitor] BREVO_API_KEY not set — alert email not sent");
    return false;
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Quiz4Win Monitor", email: from },
        to: [{ email: to }],
        subject: args.subject,
        htmlContent: args.html,
        textContent: args.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[monitor] Brevo error ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[monitor] Brevo send failed: ${(err as Error).message}`);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Build a single-column, responsive status email (alert or recovery). */
export function buildStatusEmail(opts: {
  recovered: boolean;
  results: CheckResult[];
  env: string;
}): SendArgs {
  const down = opts.results.filter((r) => !r.ok);
  const accent = opts.recovered ? BRAND.ok : BRAND.down;
  const title = opts.recovered
    ? "✅ All services recovered"
    : `🚨 ${down.length} service${down.length === 1 ? "" : "s"} unhealthy`;
  const subtitle = opts.recovered
    ? "Every monitored dependency is responding normally again."
    : "One or more Quiz4Win dependencies failed their health check.";

  const rows = opts.results.map((r) => {
    const dot = r.ok ? BRAND.ok : BRAND.down;
    const label = r.ok ? "UP" : "DOWN";
    return `<tr>
<td style="padding:12px 14px;border-bottom:1px solid ${BRAND.border};font-size:14px;color:${BRAND.textDark};font-weight:600">
  <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${dot};margin-right:8px"></span>${escapeHtml(r.name)}
</td>
<td style="padding:12px 14px;border-bottom:1px solid ${BRAND.border};font-size:12px;color:${r.ok ? BRAND.textMuted : BRAND.down};font-weight:700;white-space:nowrap;text-align:right">${label}</td>
<td style="padding:12px 14px;border-bottom:1px solid ${BRAND.border};font-size:12px;color:${BRAND.textFaint};white-space:nowrap;text-align:right">${r.latencyMs}ms</td>
</tr>
<tr><td colspan="3" style="padding:0 14px 12px;font-size:12px;line-height:1.5;color:${BRAND.textMuted};border-bottom:1px solid ${BRAND.border}">${escapeHtml(r.detail)}</td></tr>`;
  }).join("");

  const when = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quiz4Win Monitor</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.textDark}">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${BRAND.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${BRAND.surface};border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)">
<tr><td bgcolor="${BRAND.dark}" style="background:${BRAND.dark};padding:18px 24px;border-left:4px solid ${accent}">
<p style="margin:0;font-size:13px;letter-spacing:.04em;color:#CBD5E1"><strong style="color:#fff">Quiz4Win</strong> · Service Monitor <span style="color:${BRAND.textFaint}">(${escapeHtml(opts.env)})</span></p>
</td></tr>
<tr><td style="padding:28px 24px 6px">
<h1 style="margin:0;font-size:21px;line-height:1.25;color:${BRAND.textDark};font-weight:800">${title}</h1>
<p style="margin:8px 0 0;font-size:14px;line-height:1.55;color:${BRAND.textMuted}">${subtitle}</p>
</td></tr>
<tr><td style="padding:18px 12px 8px">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden">${rows}</table>
</td></tr>
<tr><td style="padding:6px 24px 28px;font-size:12px;color:${BRAND.textFaint}">Checked at ${when}</td></tr>
<tr><td bgcolor="${BRAND.darker}" style="background:${BRAND.darker};padding:18px 24px">
<p style="margin:0;font-size:11px;color:${BRAND.textFaint}">Automated message from the Quiz4Win monitoring container. Do not reply.</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = `${title}\n${subtitle}\nEnvironment: ${opts.env}\nChecked at ${when}\n\n` +
    opts.results.map((r) => `${r.ok ? "[UP]  " : "[DOWN]"} ${r.name} (${r.latencyMs}ms) — ${r.detail}`).join("\n") +
    `\n\n— Quiz4Win Monitor (automated, do not reply)`;

  const subject = opts.recovered
    ? "✅ Quiz4Win: all services recovered"
    : `🚨 Quiz4Win: ${down.map((d) => d.name).join(", ")} DOWN`;

  return { subject, html, text };
}

"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { renderBrandEmail } from "@/lib/admin-auth/email-brand";

interface CreateBroadcastInput {
  title: string;
  subject: string;
  type: "system" | "promotion";
  target_segment: string;
  status: "draft" | "queued";
  preheader: string;
  heroTitle: string;
  heroSubtitle?: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  ctaVariant?: any;
  ctaNote?: string;
}

export async function createEmailBroadcast(values: CreateBroadcastInput) {
  const admin = await getCurrentAdmin();
  if (!admin) return { ok: false, message: "Unauthorized" };

  // Render the brand email
  const { html, text } = renderBrandEmail({
    preheader: values.preheader,
    heroTitle: values.heroTitle,
    heroSubtitle: values.heroSubtitle,
    bodyHtml: values.bodyHtml,
    cta: values.ctaLabel ? {
      label: values.ctaLabel,
      url: values.ctaUrl || "",
      variant: values.ctaVariant,
    } : undefined,
    ctaNote: values.ctaNote,
    text: values.bodyHtml.replace(/<[^>]*>?/gm, ""), // simple fallback text from HTML
  });

  const db = createSupabaseAdminClient();
  const { error } = await db.from("email_broadcasts").insert({
    title: values.title,
    subject: values.subject,
    type: values.type,
    payload: values,
    content_html: html,
    content_text: text,
    target_segment: values.target_segment,
    status: values.status,
    created_by: admin.id,
  });

  if (error) {
    console.error("[email-broadcasts] Create error:", error);
    return { ok: false, message: error.message };
  }

  // Audit log
  await db.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: values.status === "queued" ? "email_broadcast_queued" : "email_broadcast_created",
    entity_type: "email_broadcast",
    metadata: { title: values.title, segment: values.target_segment },
  });

  // If queued, trigger the edge function in the background
  if (values.status === "queued") {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      fetch(`${url.replace(/\/$/, "")}/functions/v1/email-broadcast`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
      }).catch((e) => console.error("[email-broadcasts] Background trigger failed:", e));
    }
  }

  return {
    ok: true,
    message: values.status === "queued" ? "Broadcast queued for sending" : "Broadcast saved as draft"
  };
}

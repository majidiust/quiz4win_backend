"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Resends the early-bird welcome email via the admin edge function.
 */
export async function resendWelcomeEmail(birdId: string) {
  const db = createSupabaseAdminClient();
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error("Unauthorized");

  // Call the admin edge function
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");

  const response = await fetch(`${baseUrl}/functions/v1/admin-early-birds/${birdId}/resend`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to resend email" }));
    throw new Error(err.error || "Failed to resend email");
  }

  revalidatePath("/early-birds");
  return { ok: true };
}

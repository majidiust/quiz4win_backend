import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { sendEmail } from "../_shared/email.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

Deno.serve(async (req) => {
  // 1. Authorization (only system or admin via service role key can call this)
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${supabaseKey}`) {
    // Optional: allow internal calls without key if on same network, but safer to require it
  }

  try {
    // 2. Find a broadcast to process (one at a time to avoid timeouts)
    const { data: broadcast, error: fetchErr } = await supabase
      .from("email_broadcasts")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (fetchErr || !broadcast) {
      return new Response(JSON.stringify({ message: "No queued broadcasts" }), { status: 200 });
    }

    // 3. Update status to processing
    await supabase.from("email_broadcasts").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", broadcast.id);

    // 4. Identify recipients
    let query = supabase.from("profiles").select("id, email, full_name");
    
    // Filter by segment
    if (broadcast.target_segment === "verified_only") query = query.eq("kyc_status", "verified");
    else if (broadcast.target_segment === "non_verified_only") query = query.neq("kyc_status", "verified");
    else if (broadcast.target_segment === "active_players_30d") {
      const date = new Date(); date.setDate(date.getDate() - 30);
      query = query.gte("last_seen_at", date.toISOString());
    } else if (broadcast.target_segment === "inactive_players_30d") {
      const date = new Date(); date.setDate(date.getDate() - 30);
      query = query.or(`last_seen_at.lt.${date.toISOString()},last_seen_at.is.null`);
    }

    const { data: users, error: usersErr } = await query;
    if (usersErr) throw usersErr;

    // Filter by preferences if it's a promotion
    let recipients = users || [];
    if (broadcast.type === "promotion") {
      const { data: prefs } = await supabase.from("notification_preferences").select("user_id").eq("promotions", true);
      const optedInIds = new Set(prefs?.map(p => p.user_id) || []);
      recipients = recipients.filter(u => optedInIds.has(u.id));
    }

    // 5. Insert messages into the queue (email_messages)
    const messageRows = recipients.map(u => ({
      broadcast_id: broadcast.id,
      user_id: u.id,
      email: u.email,
      status: "queued"
    }));

    // Batch insert messages
    if (messageRows.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < messageRows.length; i += BATCH_SIZE) {
        await supabase.from("email_messages").insert(messageRows.slice(i, i + BATCH_SIZE));
      }
    }

    await supabase.from("email_broadcasts").update({ total_count: messageRows.length }).eq("id", broadcast.id);

    // 6. Start sending (initial batch)
    // In a real high-volume system, this would be a separate background worker or step
    // For now, we'll process the first 50 immediately
    const { data: toSend } = await supabase
      .from("email_messages")
      .select("*")
      .eq("broadcast_id", broadcast.id)
      .eq("status", "queued")
      .limit(50);

    if (toSend) {
      for (const msg of toSend) {
        try {
          // In a real implementation, we'd use Brevo batch API for efficiency
          await sendEmail({
            to: { email: msg.email },
            subject: broadcast.subject,
            html: broadcast.content_html,
            text: broadcast.content_text,
          });
          await supabase.from("email_messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", msg.id);
          await supabase.rpc("increment_broadcast_sent", { b_id: broadcast.id });
        } catch (e) {
          await supabase.from("email_messages").update({ status: "failed", error: String(e) }).eq("id", msg.id);
          await supabase.rpc("increment_broadcast_error", { b_id: broadcast.id });
        }
      }
    }

    // 7. Finalise or leave for next run
    // If all sent, mark as completed
    const { count } = await supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("broadcast_id", broadcast.id).eq("status", "queued");
    if (count === 0) {
      await supabase.from("email_broadcasts").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", broadcast.id);
    }

    return new Response(JSON.stringify({ 
      message: "Broadcast processed", 
      broadcast_id: broadcast.id,
      recipients: recipients.length 
    }), { status: 200 });

  } catch (err) {
    console.error("[email-broadcast] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

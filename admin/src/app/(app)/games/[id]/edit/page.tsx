import { notFound, redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { EditGameForm } from "./edit-game-form";

export const metadata = { title: "Edit game" };

export default async function EditGamePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: game, error } = await db.from("games").select("*").eq("id", id).maybeSingle();
  if (error || !game) notFound();

  // Server-side guard mirrors updateGame() in @/lib/actions/games — only
  // upcoming/open games are editable. If someone deep-links to /edit on a
  // started/ended/cancelled game we bounce them back to the detail view.
  if (!["upcoming", "open"].includes(game.status)) {
    redirect(`/games/${id}`);
  }

  return <EditGameForm gameId={id} game={game} />;
}

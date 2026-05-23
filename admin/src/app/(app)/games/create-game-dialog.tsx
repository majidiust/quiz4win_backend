"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createGame } from "@/lib/actions/games";

export function CreateGameDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("timed");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("Medium");
  const [entryFee, setEntryFee] = useState("0");
  const [prizePool, setPrizePool] = useState("0");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [description, setDescription] = useState("");

  function reset() {
    setTitle(""); setMode("timed"); setCategory(""); setDifficulty("Medium");
    setEntryFee("0"); setPrizePool("0"); setMaxPlayers(""); setScheduledAt(""); setDescription("");
  }

  function submit() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    start(async () => {
      const res = await createGame({
        title: title.trim(),
        mode: mode as "timed" | "battle" | "daily" | "tournament" | "live",
        category: category.trim() || undefined,
        difficulty: difficulty as "Easy" | "Medium" | "Hard" | undefined,
        entry_fee: parseFloat(entryFee) || 0,
        prize_pool: parseFloat(prizePool) || 0,
        max_players: maxPlayers ? parseInt(maxPlayers, 10) : undefined,
        scheduled_at: scheduledAt || undefined,
        description: description.trim() || undefined,
      });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        reset();
        if (res.id) router.push(`/games/${res.id}`);
        else router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="size-3.5" /> Create game</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create game</DialogTitle>
          <DialogDescription>Schedules a new game in 'upcoming' status.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="cg-title">Title *</Label>
            <Input id="cg-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Friday Night Trivia" />
          </div>
          <div className="space-y-1.5">
            <Label>Mode *</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["timed", "battle", "daily", "tournament", "live"].map((m) => (
                  <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Difficulty</Label>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Easy", "Medium", "Hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cg-category">Category</Label>
            <Input id="cg-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Sports" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cg-max">Max players</Label>
            <Input id="cg-max" type="number" min="1" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} placeholder="Unlimited" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cg-fee">Entry fee ($)</Label>
            <Input id="cg-fee" type="number" min="0" step="0.01" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cg-pool">Prize pool ($)</Label>
            <Input id="cg-pool" type="number" min="0" step="0.01" value={prizePool} onChange={(e) => setPrizePool(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="cg-schedule">Scheduled at</Label>
            <Input id="cg-schedule" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="cg-desc">Description</Label>
            <Textarea id="cg-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} onClick={submit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

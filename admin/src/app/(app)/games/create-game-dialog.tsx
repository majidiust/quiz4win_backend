"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { createGame } from "@/lib/actions/games";
import { SUPPORTED_CURRENCIES } from "@/lib/games-constants";

export function CreateGameDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // Basic fields
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("timed");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("Medium");
  const [entryFee, setEntryFee] = useState("0");
  const [prizePool, setPrizePool] = useState("0");
  const [prizePoolCurrency, setPrizePoolCurrency] = useState<string>("USD");
  const [isFeatured, setIsFeatured] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState("");
  const [timePerQuestion, setTimePerQuestion] = useState("15");
  const [allowedWrong, setAllowedWrong] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [description, setDescription] = useState("");
  // Styling fields
  const [accentColor, setAccentColor] = useState("#6366f1");
  const [glowColor, setGlowColor] = useState("#818cf8");
  const [gradientColors, setGradientColors] = useState<string[]>([]);
  const [gradientInput, setGradientInput] = useState("#6366f1");
  // Meta fields
  const [sponsor, setSponsor] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  // Host fields
  const [hostName, setHostName] = useState("");
  const [hostTitle, setHostTitle] = useState("");

  function reset() {
    setTitle(""); setMode("timed"); setCategory(""); setDifficulty("Medium");
    setEntryFee("0"); setPrizePool("0"); setPrizePoolCurrency("USD"); setIsFeatured(false);
    setMaxPlayers(""); setTimePerQuestion("15"); setAllowedWrong(""); setScheduledAt(""); setDescription("");
    setAccentColor("#6366f1"); setGlowColor("#818cf8"); setGradientColors([]); setGradientInput("#6366f1");
    setSponsor(""); setTagsInput(""); setHostName(""); setHostTitle("");
  }

  function addGradientColor() {
    if (gradientInput && !gradientColors.includes(gradientInput)) {
      setGradientColors([...gradientColors, gradientInput]);
    }
  }

  function submit() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    start(async () => {
      const res = await createGame({
        title: title.trim(),
        mode: mode as "timed" | "battle" | "daily" | "tournament" | "live",
        category: category.trim() || undefined,
        difficulty: difficulty as "Easy" | "Medium" | "Hard" | undefined,
        entry_fee: parseFloat(entryFee) || 0,
        prize_pool: parseFloat(prizePool) || 0,
        prize_pool_currency: prizePoolCurrency as (typeof SUPPORTED_CURRENCIES)[number],
        is_featured: isFeatured,
        max_players: maxPlayers ? parseInt(maxPlayers, 10) : undefined,
        time_per_question: timePerQuestion ? parseInt(timePerQuestion, 10) : undefined,
        allowed_wrong_answers: allowedWrong !== "" ? parseInt(allowedWrong, 10) : undefined,
        scheduled_at: scheduledAt || undefined,
        description: description.trim() || undefined,
        accent_color: accentColor || undefined,
        glow_color: glowColor || undefined,
        gradient_colors: gradientColors.length ? gradientColors : undefined,
        sponsor: sponsor.trim() || undefined,
        tags: tags.length ? tags : undefined,
        host_name: hostName.trim() || undefined,
        host_title: hostTitle.trim() || undefined,
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create game</DialogTitle>
          <DialogDescription>Schedules a new game in &apos;upcoming&apos; status.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="basic">
          <TabsList className="w-full">
            <TabsTrigger value="basic" className="flex-1">Basic</TabsTrigger>
            <TabsTrigger value="styling" className="flex-1">Styling &amp; Host</TabsTrigger>
          </TabsList>

          {/* ---- BASIC TAB ---- */}
          <TabsContent value="basic">
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
                <Label htmlFor="cg-tpq">Per question (s)</Label>
                <Input id="cg-tpq" type="number" min="3" max="300" value={timePerQuestion} onChange={(e) => setTimePerQuestion(e.target.value)} placeholder="15" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg-lives">Lives</Label>
                <Input id="cg-lives" type="number" min="0" max="100" value={allowedWrong} onChange={(e) => setAllowedWrong(e.target.value)} placeholder="Unlimited" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg-fee">Entry fee ($)</Label>
                <Input id="cg-fee" type="number" min="0" step="0.01" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg-pool">Prize pool</Label>
                <div className="flex gap-2">
                  <Input id="cg-pool" type="number" min="0" step="0.01" value={prizePool} onChange={(e) => setPrizePool(e.target.value)} className="flex-1" />
                  <Select value={prizePoolCurrency} onValueChange={setPrizePoolCurrency}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="cg-schedule">Scheduled at</Label>
                <Input id="cg-schedule" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-md border border-input px-3 py-2">
                <div className="space-y-0.5">
                  <Label htmlFor="cg-featured" className="cursor-pointer">Featured game</Label>
                  <p className="text-xs text-muted-foreground">Show in the home-screen hero carousel.</p>
                </div>
                <Switch id="cg-featured" checked={isFeatured} onCheckedChange={setIsFeatured} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="cg-desc">Description</Label>
                <Textarea id="cg-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
              </div>
            </div>
          </TabsContent>

          {/* ---- STYLING & HOST TAB ---- */}
          <TabsContent value="styling">
            <div className="grid grid-cols-2 gap-3">
              {/* Colors */}
              <div className="space-y-1.5">
                <Label htmlFor="cg-accent">Accent color</Label>
                <div className="flex gap-2">
                  <input type="color" id="cg-accent" value={accentColor} onChange={(e) => setAccentColor(e.target.value)}
                    className="h-9 w-10 cursor-pointer rounded border border-input p-0.5" />
                  <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} placeholder="#6366f1" className="font-mono" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg-glow">Glow color</Label>
                <div className="flex gap-2">
                  <input type="color" id="cg-glow" value={glowColor} onChange={(e) => setGlowColor(e.target.value)}
                    className="h-9 w-10 cursor-pointer rounded border border-input p-0.5" />
                  <Input value={glowColor} onChange={(e) => setGlowColor(e.target.value)} placeholder="#818cf8" className="font-mono" />
                </div>
              </div>
              {/* Gradient colors */}
              <div className="col-span-2 space-y-1.5">
                <Label>Gradient colors</Label>
                <div className="flex gap-2">
                  <input type="color" value={gradientInput} onChange={(e) => setGradientInput(e.target.value)}
                    className="h-9 w-10 cursor-pointer rounded border border-input p-0.5" />
                  <Input value={gradientInput} onChange={(e) => setGradientInput(e.target.value)} placeholder="#6366f1" className="font-mono flex-1" />
                  <Button type="button" size="sm" variant="outline" onClick={addGradientColor}>Add</Button>
                </div>
                {gradientColors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {gradientColors.map((c, i) => (
                      <span key={i} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-mono">
                        <span className="inline-block size-3 rounded-sm border" style={{ background: c }} />
                        {c}
                        <button type="button" onClick={() => setGradientColors(gradientColors.filter((_, j) => j !== i))}>
                          <X className="size-3 text-muted-foreground hover:text-destructive" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {/* Sponsor & Tags */}
              <div className="space-y-1.5">
                <Label htmlFor="cg-sponsor">Sponsor</Label>
                <Input id="cg-sponsor" value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="Sponsor name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg-tags">Tags (comma-separated)</Label>
                <Input id="cg-tags" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="football, sports" />
              </div>
              {/* Host info */}
              <div className="space-y-1.5">
                <Label htmlFor="cg-host-name">Host name</Label>
                <Input id="cg-host-name" value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="e.g. Alex Johnson" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg-host-title">Host title</Label>
                <Input id="cg-host-title" value={hostTitle} onChange={(e) => setHostTitle(e.target.value)} placeholder="e.g. Live Host" />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Host avatar and game images (icon, thumbnail) can be uploaded from the game detail page after creation.
              </p>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} onClick={submit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

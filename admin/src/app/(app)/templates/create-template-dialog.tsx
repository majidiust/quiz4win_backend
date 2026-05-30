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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { createTemplate } from "@/lib/actions/templates";
import { SUPPORTED_CURRENCIES } from "@/lib/games-constants";
import { AvatarPicker } from "./[id]/edit/avatar-picker";
import { VoicePicker } from "./[id]/edit/voice-picker";

const LANG_OPTIONS = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
  { value: "fa", label: "Persian" },
  { value: "tr", label: "Turkish" },
] as const;

// Common cron presets — admins can also enter a raw expression.
const CRON_PRESETS = [
  { label: "Every hour (top of hour)", value: "0 * * * *" },
  { label: "Every 30 minutes", value: "0,30 * * * *" },
  { label: "Every day at 18:00 UTC", value: "0 18 * * *" },
  { label: "Mon–Fri at 12:00 UTC", value: "0 12 * * 1-5" },
  { label: "Sat & Sun at 20:00 UTC", value: "0 20 * * 0,6" },
];

export function CreateTemplateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // Identity
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Schedule
  const [cron, setCron] = useState("0 * * * *");
  const [cronDescription, setCronDescription] = useState("Every hour");
  const [duration, setDuration] = useState("15");
  const [startBuffer, setStartBuffer] = useState("120");
  // Game
  const [mode] = useState<"live">("live");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState<string>("Medium");
  const [language, setLanguage] = useState("en");
  const [entryFee, setEntryFee] = useState("0");
  const [prizePool, setPrizePool] = useState("0");
  const [currency, setCurrency] = useState<string>("USD");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [questionsCount, setQuestionsCount] = useState("10");
  const [timePerQuestion, setTimePerQuestion] = useState("15");
  const [allowedWrong, setAllowedWrong] = useState("");
  // Filters
  const [qCategory, setQCategory] = useState("");
  const [qDifficulty, setQDifficulty] = useState<string>("");
  const [qLanguage, setQLanguage] = useState<string>("");
  // AI
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiAvatarId, setAiAvatarId] = useState("");
  const [aiSoundId, setAiSoundId] = useState("");
  const [aiDuration, setAiDuration] = useState("300");
  const [aiLanguage, setAiLanguage] = useState<string>("");

  function reset() {
    setName(""); setDescription("");
    setCron("0 * * * *"); setCronDescription("Every hour"); setDuration("15"); setStartBuffer("120");
    setCategory(""); setDifficulty("Medium"); setLanguage("en");
    setEntryFee("0"); setPrizePool("0"); setCurrency("USD"); setMaxPlayers("");
    setQuestionsCount("10"); setTimePerQuestion("15"); setAllowedWrong("");
    setQCategory(""); setQDifficulty(""); setQLanguage("");
    setAiEnabled(false); setAiAvatarId(""); setAiSoundId(""); setAiDuration("300"); setAiLanguage("");
  }

  function submit() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!cron.trim()) { toast.error("Cron expression is required"); return; }
    if (aiEnabled && (!aiAvatarId.trim() || !aiSoundId.trim())) {
      toast.error("Avatar ID and Voice ID are required when AI is enabled");
      return;
    }

    start(async () => {
      const res = await createTemplate({
        name: name.trim(),
        description: description.trim() || undefined,
        cron_expression: cron.trim(),
        cron_description: cronDescription.trim() || undefined,
        duration_minutes: parseInt(duration, 10) || 15,
        start_buffer_seconds: parseInt(startBuffer, 10) || 120,
        mode,
        category: category.trim() || undefined,
        difficulty: (difficulty || undefined) as "Easy" | "Medium" | "Hard" | undefined,
        language: language as "en" | "ar" | "fa" | "tr",
        entry_fee: parseFloat(entryFee) || 0,
        prize_pool: parseFloat(prizePool) || 0,
        prize_pool_currency: currency as (typeof SUPPORTED_CURRENCIES)[number],
        max_players: maxPlayers ? parseInt(maxPlayers, 10) : undefined,
        questions_count: parseInt(questionsCount, 10) || 10,
        time_per_question: parseInt(timePerQuestion, 10) || 15,
        allowed_wrong_answers: allowedWrong !== "" ? parseInt(allowedWrong, 10) : undefined,
        is_featured: false,
        question_category: qCategory.trim() || undefined,
        question_difficulty: (qDifficulty || undefined) as "Easy" | "Medium" | "Hard" | undefined,
        question_language: (qLanguage || undefined) as "en" | "ar" | "fa" | "tr" | undefined,
        enable_streaming: true,
        ai_enabled: aiEnabled,
        ai_avatar_id: aiEnabled ? aiAvatarId.trim() : undefined,
        ai_sound_id: aiEnabled ? aiSoundId.trim() : undefined,
        ai_duration: aiEnabled ? (parseInt(aiDuration, 10) || undefined) : undefined,
        ai_language: aiEnabled ? ((aiLanguage || language) as "en" | "ar" | "fa" | "tr") : undefined,
      });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        reset();
        if (res.id) router.push(`/templates/${res.id}`);
        else router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="size-3.5" /> Create template</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create game template</DialogTitle>
          <DialogDescription>
            Templates spawn new games on a cron schedule. Generated games start in &quot;upcoming&quot; status with mode &quot;live&quot;.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="basic">
          <TabsList className="w-full">
            <TabsTrigger value="basic" className="flex-1">Basic</TabsTrigger>
            <TabsTrigger value="schedule" className="flex-1">Schedule</TabsTrigger>
            <TabsTrigger value="questions" className="flex-1">Questions</TabsTrigger>
            <TabsTrigger value="ai" className="flex-1">AI Presenter</TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="ct-name">Name *</Label>
                <Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="e.g. Hourly Sports Trivia" />
              </div>
              <div className="space-y-1.5">
                <Label>Language *</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANG_OPTIONS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-cat">Category</Label>
                <Input id="ct-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Sports" />
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
                <Label htmlFor="ct-max">Max players</Label>
                <Input id="ct-max" type="number" min="1" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} placeholder="Unlimited" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-fee">Entry fee</Label>
                <Input id="ct-fee" type="number" min="0" step="0.01" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-pool">Prize pool</Label>
                <div className="flex gap-2">
                  <Input id="ct-pool" type="number" min="0" step="0.01" value={prizePool} onChange={(e) => setPrizePool(e.target.value)} className="flex-1" />
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="ct-desc">Description</Label>
                <Textarea id="ct-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="schedule">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Preset</Label>
                <Select value={cron} onValueChange={(v) => { setCron(v); const p = CRON_PRESETS.find((x) => x.value === v); if (p) setCronDescription(p.label); }}>
                  <SelectTrigger><SelectValue placeholder="Pick a preset…" /></SelectTrigger>
                  <SelectContent>
                    {CRON_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="ct-cron">Cron expression *</Label>
                <Input id="ct-cron" value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" placeholder="m h dom mon dow" />
                <p className="text-xs text-muted-foreground">5 fields: minute, hour, day-of-month, month, day-of-week. All times UTC.</p>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="ct-cron-desc">Description (human-friendly)</Label>
                <Input id="ct-cron-desc" value={cronDescription} onChange={(e) => setCronDescription(e.target.value)} placeholder="e.g. Every weekday at noon" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-dur">Duration (minutes)</Label>
                <Input id="ct-dur" type="number" min="1" max="1440" value={duration} onChange={(e) => setDuration(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-buf">Start buffer (seconds)</Label>
                <Input id="ct-buf" type="number" min="0" max="3600" value={startBuffer} onChange={(e) => setStartBuffer(e.target.value)} />
                <p className="text-xs text-muted-foreground">Gap between create + scheduled_at so players can join.</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="questions">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ct-qc">Questions count *</Label>
                <Input id="ct-qc" type="number" min="1" max="200" value={questionsCount} onChange={(e) => setQuestionsCount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-tpq">Per question (s)</Label>
                <Input id="ct-tpq" type="number" min="3" max="300" value={timePerQuestion} onChange={(e) => setTimePerQuestion(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-lives">Lives (wrong allowed)</Label>
                <Input id="ct-lives" type="number" min="0" max="100" value={allowedWrong} onChange={(e) => setAllowedWrong(e.target.value)} placeholder="Unlimited" />
              </div>
              <div className="col-span-2 space-y-1.5 border-t pt-3">
                <p className="text-xs text-muted-foreground">Filters used when picking questions for each generated game (leave blank for no filter):</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-qcat">Filter — category</Label>
                <Input id="ct-qcat" value={qCategory} onChange={(e) => setQCategory(e.target.value)} placeholder="Any" />
              </div>
              <div className="space-y-1.5">
                <Label>Filter — difficulty</Label>
                <Select value={qDifficulty || "__any__"} onValueChange={(v) => setQDifficulty(v === "__any__" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {["Easy", "Medium", "Hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Filter — language</Label>
                <Select value={qLanguage || "__any__"} onValueChange={(v) => setQLanguage(v === "__any__" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {LANG_OPTIONS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ai">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex items-center justify-between rounded-md border border-input px-3 py-2">
                <div className="space-y-0.5">
                  <Label htmlFor="ct-ai" className="cursor-pointer">Enable AI presenter</Label>
                  <p className="text-xs text-muted-foreground">Publishes quiz.show.start to RabbitMQ when the game starts so a LiveAvatar joins the LiveKit room.</p>
                </div>
                <Switch id="ct-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} />
              </div>
              {aiEnabled && (
                <>
                  <div className="col-span-2">
                    <AvatarPicker value={aiAvatarId} onChange={setAiAvatarId} disabled={pending} />
                  </div>
                  <div className="col-span-2">
                    <VoicePicker value={aiSoundId} onChange={setAiSoundId} disabled={pending} />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ct-ai-dur">Show duration (s)</Label>
                <Input id="ct-ai-dur" type="number" min="60" max="1800" value={aiDuration} onChange={(e) => setAiDuration(e.target.value)} disabled={!aiEnabled} />
              </div>
              <div className="space-y-1.5">
                <Label>Presenter language</Label>
                <Select value={aiLanguage || language} onValueChange={setAiLanguage} disabled={!aiEnabled}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANG_OPTIONS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
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

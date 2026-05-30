"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shell/page-header";
import { updateTemplate } from "@/lib/actions/templates";
import { SUPPORTED_CURRENCIES } from "@/lib/games-constants";
import { AvatarPicker } from "./avatar-picker";
import { VoicePicker } from "./voice-picker";

const LANG_OPTIONS = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
  { value: "fa", label: "Persian" },
  { value: "tr", label: "Turkish" },
] as const;

const CRON_PRESETS = [
  { label: "Every hour (top of hour)", value: "0 * * * *" },
  { label: "Every 30 minutes", value: "0,30 * * * *" },
  { label: "Every day at 18:00 UTC", value: "0 18 * * *" },
  { label: "Mon–Fri at 12:00 UTC", value: "0 12 * * 1-5" },
  { label: "Sat & Sun at 20:00 UTC", value: "0 20 * * 0,6" },
];

export interface EditableTemplate {
  name?: string | null;
  description?: string | null;
  cron_expression?: string | null;
  cron_description?: string | null;
  duration_minutes?: number | null;
  start_buffer_seconds?: number | null;
  mode?: string | null;
  category?: string | null;
  difficulty?: string | null;
  language?: string | null;
  entry_fee?: number | string | null;
  prize_pool?: number | string | null;
  prize_pool_currency?: string | null;
  max_players?: number | null;
  questions_count?: number | null;
  time_per_question?: number | null;
  allowed_wrong_answers?: number | null;
  is_featured?: boolean | null;
  question_category?: string | null;
  question_difficulty?: string | null;
  question_language?: string | null;
  ai_enabled?: boolean | null;
  ai_avatar_id?: string | null;
  ai_sound_id?: string | null;
  ai_duration?: number | null;
  ai_language?: string | null;
}

export function EditTemplateForm({ templateId, template }: { templateId: string; template: EditableTemplate }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [name, setName] = useState(template.name ?? "");
  const [description, setDescription] = useState(template.description ?? "");
  const [cron, setCron] = useState(template.cron_expression ?? "0 * * * *");
  const [cronDescription, setCronDescription] = useState(template.cron_description ?? "");
  const [duration, setDuration] = useState(String(template.duration_minutes ?? 15));
  const [startBuffer, setStartBuffer] = useState(String(template.start_buffer_seconds ?? 120));
  const [category, setCategory] = useState(template.category ?? "");
  const [difficulty, setDifficulty] = useState(template.difficulty ?? "Medium");
  const [language, setLanguage] = useState(template.language ?? "en");
  const [entryFee, setEntryFee] = useState(String(template.entry_fee ?? "0"));
  const [prizePool, setPrizePool] = useState(String(template.prize_pool ?? "0"));
  const [currency, setCurrency] = useState(template.prize_pool_currency ?? "USD");
  const [maxPlayers, setMaxPlayers] = useState(template.max_players ? String(template.max_players) : "");
  const [questionsCount, setQuestionsCount] = useState(String(template.questions_count ?? 10));
  const [timePerQuestion, setTimePerQuestion] = useState(String(template.time_per_question ?? 15));
  const [allowedWrong, setAllowedWrong] = useState(
    template.allowed_wrong_answers !== null && template.allowed_wrong_answers !== undefined
      ? String(template.allowed_wrong_answers) : "",
  );
  const [qCategory, setQCategory] = useState(template.question_category ?? "");
  const [qDifficulty, setQDifficulty] = useState(template.question_difficulty ?? "");
  const [qLanguage, setQLanguage] = useState(template.question_language ?? "");
  const [aiEnabled, setAiEnabled] = useState<boolean>(template.ai_enabled ?? false);
  const [aiAvatarId, setAiAvatarId] = useState(template.ai_avatar_id ?? "");
  const [aiSoundId, setAiSoundId] = useState(template.ai_sound_id ?? "");
  const [aiDuration, setAiDuration] = useState(String(template.ai_duration ?? 300));
  const [aiLanguage, setAiLanguage] = useState(template.ai_language ?? "");

  function save() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!cron.trim()) { toast.error("Cron expression is required"); return; }
    if (aiEnabled && (!aiAvatarId.trim() || !aiSoundId.trim())) {
      toast.error("Avatar ID and Voice ID are required when AI is enabled");
      return;
    }
    start(async () => {
      const res = await updateTemplate(templateId, {
        name: name.trim(),
        description: description.trim() || undefined,
        cron_expression: cron.trim(),
        cron_description: cronDescription.trim() || undefined,
        duration_minutes: parseInt(duration, 10) || 15,
        start_buffer_seconds: parseInt(startBuffer, 10) || 120,
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
        question_category: qCategory.trim() || undefined,
        question_difficulty: (qDifficulty || undefined) as "Easy" | "Medium" | "Hard" | undefined,
        question_language: (qLanguage || undefined) as "en" | "ar" | "fa" | "tr" | undefined,
        ai_enabled: aiEnabled,
        ai_avatar_id: aiEnabled ? aiAvatarId.trim() : undefined,
        ai_sound_id: aiEnabled ? aiSoundId.trim() : undefined,
        ai_duration: aiEnabled ? (parseInt(aiDuration, 10) || undefined) : undefined,
        ai_language: aiEnabled ? ((aiLanguage || language) as "en" | "ar" | "fa" | "tr") : undefined,
      });
      if (res.ok) {
        toast.success(res.message);
        router.push(`/templates/${templateId}`);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  const actions = (
    <>
      <Button asChild variant="outline" size="sm" disabled={pending}>
        <Link href={`/templates/${templateId}`}><ArrowLeft className="size-4" /> Cancel</Link>
      </Button>
      <Button size="sm" loading={pending} onClick={save}><Save className="size-4" /> Save changes</Button>
    </>
  );

  return (
    <>
      <PageHeader title="Edit template" description={template.name ?? templateId} actions={actions} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Basic info</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="et-name">Name *</Label>
              <Input id="et-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
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
              <Label htmlFor="et-cat">Category</Label>
              <Input id="et-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
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
              <Label htmlFor="et-max">Max players</Label>
              <Input id="et-max" type="number" min="1" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} placeholder="Unlimited" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="et-fee">Entry fee</Label>
              <Input id="et-fee" type="number" min="0" step="0.01" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="et-pool">Prize pool</Label>
              <div className="flex gap-2">
                <Input id="et-pool" type="number" min="0" step="0.01" value={prizePool} onChange={(e) => setPrizePool(e.target.value)} className="flex-1" />
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="et-desc">Description</Label>
              <Textarea id="et-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Schedule</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Preset</Label>
              <Select value={cron} onValueChange={(v) => { setCron(v); const p = CRON_PRESETS.find((x) => x.value === v); if (p && !cronDescription) setCronDescription(p.label); }}>
                <SelectTrigger><SelectValue placeholder="Pick a preset…" /></SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="et-cron">Cron expression *</Label>
              <Input id="et-cron" value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" placeholder="m h dom mon dow" />
              <p className="text-xs text-muted-foreground">5 fields: minute, hour, day-of-month, month, day-of-week. All times UTC.</p>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="et-cron-desc">Description (human-friendly)</Label>
              <Input id="et-cron-desc" value={cronDescription} onChange={(e) => setCronDescription(e.target.value)} placeholder="e.g. Every weekday at noon" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="et-dur">Duration (minutes)</Label>
              <Input id="et-dur" type="number" min="1" max="1440" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="et-buf">Start buffer (seconds)</Label>
              <Input id="et-buf" type="number" min="0" max="3600" value={startBuffer} onChange={(e) => setStartBuffer(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Gameplay</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="et-qcount">Questions</Label>
              <Input id="et-qcount" type="number" min="1" max="200" value={questionsCount} onChange={(e) => setQuestionsCount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="et-tpq">Per question (s)</Label>
              <Input id="et-tpq" type="number" min="3" max="300" value={timePerQuestion} onChange={(e) => setTimePerQuestion(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="et-lives">Lives (wrong answers)</Label>
              <Input id="et-lives" type="number" min="0" max="100" value={allowedWrong} onChange={(e) => setAllowedWrong(e.target.value)} placeholder="Unlimited" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Question filters</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="et-qcat">Question category</Label>
              <Input id="et-qcat" value={qCategory} onChange={(e) => setQCategory(e.target.value)} placeholder="Leave blank for any" />
            </div>
            <div className="space-y-1.5">
              <Label>Question difficulty</Label>
              <Select value={qDifficulty || "any"} onValueChange={(v) => setQDifficulty(v === "any" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {["Easy", "Medium", "Hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Question language</Label>
              <Select value={qLanguage || "any"} onValueChange={(v) => setQLanguage(v === "any" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {LANG_OPTIONS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">AI Presenter</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch id="et-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} />
              <Label htmlFor="et-ai">Enable AI presenter for games generated from this template</Label>
            </div>
            {aiEnabled && (
              <>
                <div className="sm:col-span-2">
                  <AvatarPicker value={aiAvatarId} onChange={setAiAvatarId} disabled={pending} />
                </div>
                <div className="sm:col-span-2">
                  <VoicePicker value={aiSoundId} onChange={setAiSoundId} disabled={pending} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="et-aidur">Max duration (s)</Label>
                  <Input id="et-aidur" type="number" min="60" max="1800" value={aiDuration} onChange={(e) => setAiDuration(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>AI language</Label>
                  <Select value={aiLanguage || language} onValueChange={setAiLanguage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANG_OPTIONS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

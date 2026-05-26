"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shell/page-header";
import { updateGame } from "@/lib/actions/games";
import { SUPPORTED_CURRENCIES } from "@/lib/games-constants";

export interface EditableGame {
  title?: string | null;
  subtitle?: string | null;
  mode?: string | null;
  category?: string | null;
  difficulty?: string | null;
  language?: string | null;
  entry_fee?: number | string | null;
  prize_pool?: number | string | null;
  prize_pool_currency?: string | null;
  is_featured?: boolean | null;
  max_players?: number | null;
  time_per_question?: number | null;
  allowed_wrong_answers?: number | null;
  questions_count?: number | null;
  scheduled_at?: string | null;
  description?: string | null;
  accent_color?: string | null;
  glow_color?: string | null;
  gradient_colors?: string[] | null;
  sponsor?: string | null;
  tags?: string[] | null;
  host_name?: string | null;
  host_title?: string | null;
  rules?: string[] | null;
}

// DB ISO timestamp → <input type="datetime-local"> value.
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditGameForm({ gameId, game }: { gameId: string; game: EditableGame }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [title, setTitle] = useState(game.title ?? "");
  const [subtitle, setSubtitle] = useState(game.subtitle ?? "");
  const [mode, setMode] = useState(game.mode ?? "timed");
  const [category, setCategory] = useState(game.category ?? "");
  const [difficulty, setDifficulty] = useState(game.difficulty ?? "Medium");
  const [language, setLanguage] = useState(game.language ?? "en");
  const [entryFee, setEntryFee] = useState(String(game.entry_fee ?? "0"));
  const [prizePool, setPrizePool] = useState(String(game.prize_pool ?? "0"));
  const [prizePoolCurrency, setPrizePoolCurrency] = useState<string>(game.prize_pool_currency ?? "USD");
  const [isFeatured, setIsFeatured] = useState<boolean>(game.is_featured ?? false);
  const [maxPlayers, setMaxPlayers] = useState(game.max_players ? String(game.max_players) : "");
  const [timePerQuestion, setTimePerQuestion] = useState(game.time_per_question ? String(game.time_per_question) : "15");
  const [allowedWrong, setAllowedWrong] = useState(
    game.allowed_wrong_answers !== null && game.allowed_wrong_answers !== undefined ? String(game.allowed_wrong_answers) : "",
  );
  const [questionsCount, setQuestionsCount] = useState(
    game.questions_count != null ? String(game.questions_count) : "",
  );
  const [scheduledAt, setScheduledAt] = useState(isoToLocalInput(game.scheduled_at));
  const [description, setDescription] = useState(game.description ?? "");
  const [accentColor, setAccentColor] = useState(game.accent_color ?? "#6366f1");
  const [glowColor, setGlowColor] = useState(game.glow_color ?? "#818cf8");
  const [gradientColors, setGradientColors] = useState<string[]>(game.gradient_colors ?? []);
  const [gradientInput, setGradientInput] = useState("#6366f1");
  const [sponsor, setSponsor] = useState(game.sponsor ?? "");
  const [tagsInput, setTagsInput] = useState((game.tags ?? []).join(", "));
  const [hostName, setHostName] = useState(game.host_name ?? "");
  const [hostTitle, setHostTitle] = useState(game.host_title ?? "");
  const [rulesText, setRulesText] = useState((game.rules ?? []).join("\n"));

  function addGradient() {
    if (gradientInput && !gradientColors.includes(gradientInput)) {
      setGradientColors([...gradientColors, gradientInput]);
    }
  }

  function save() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    const rules = rulesText.split("\n").map((r) => r.trim()).filter(Boolean);
    start(async () => {
      const res = await updateGame(gameId, {
        title: title.trim(),
        subtitle: subtitle.trim() || undefined,
        mode: mode as "timed" | "battle" | "daily" | "tournament" | "live",
        category: category.trim() || undefined,
        difficulty: difficulty as "Easy" | "Medium" | "Hard" | undefined,
        language: language as "en" | "ar" | "fa" | "tr",
        entry_fee: parseFloat(entryFee) || 0,
        prize_pool: parseFloat(prizePool) || 0,
        prize_pool_currency: prizePoolCurrency as (typeof SUPPORTED_CURRENCIES)[number],
        is_featured: isFeatured,
        max_players: maxPlayers ? parseInt(maxPlayers, 10) : undefined,
        time_per_question: timePerQuestion ? parseInt(timePerQuestion, 10) : undefined,
        allowed_wrong_answers: allowedWrong !== "" ? parseInt(allowedWrong, 10) : undefined,
        questions_count: questionsCount !== "" ? parseInt(questionsCount, 10) : undefined,
        scheduled_at: scheduledAt || undefined,
        description: description.trim() || undefined,
        accent_color: accentColor || undefined,
        glow_color: glowColor || undefined,
        gradient_colors: gradientColors.length ? gradientColors : undefined,
        sponsor: sponsor.trim() || undefined,
        tags: tags.length ? tags : undefined,
        host_name: hostName.trim() || undefined,
        host_title: hostTitle.trim() || undefined,
        rules: rules.length ? rules : undefined,
      });
      if (res.ok) {
        toast.success(res.message);
        router.push(`/games/${gameId}`);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  const actions = (
    <>
      <Button asChild variant="outline" size="sm" disabled={pending}>
        <Link href={`/games/${gameId}`}><ArrowLeft className="size-4" /> Cancel</Link>
      </Button>
      <Button size="sm" loading={pending} onClick={save}><Save className="size-4" /> Save changes</Button>
    </>
  );

  return (
    <>
      <PageHeader title="Edit game" description={game.title ?? gameId} actions={actions} />
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- Basic info ---- */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Basic info</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="eg-title">Title *</Label>
              <Input id="eg-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="eg-subtitle">Subtitle</Label>
              <Input id="eg-subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={300} />
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
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["en", "ar", "fa", "tr"].map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eg-category">Category</Label>
              <Input id="eg-category" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* ---- Gameplay ---- */}
        <Card>
          <CardHeader><CardTitle className="text-base">Gameplay</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="eg-max">Max players</Label>
              <Input id="eg-max" type="number" min="1" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} placeholder="Unlimited" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eg-tpq">Per question (s)</Label>
              <Input id="eg-tpq" type="number" min="3" max="300" value={timePerQuestion} onChange={(e) => setTimePerQuestion(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eg-lives">Lives</Label>
              <Input id="eg-lives" type="number" min="0" max="100" value={allowedWrong} onChange={(e) => setAllowedWrong(e.target.value)} placeholder="Unlimited" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eg-qcount">Questions</Label>
              <Input id="eg-qcount" type="number" min="1" max="1000" value={questionsCount} onChange={(e) => setQuestionsCount(e.target.value)} placeholder="e.g. 10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eg-fee">Entry fee</Label>
              <Input id="eg-fee" type="number" min="0" step="0.01" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="eg-pool">Prize pool</Label>
              <div className="flex gap-2">
                <Input id="eg-pool" type="number" min="0" step="0.01" value={prizePool} onChange={(e) => setPrizePool(e.target.value)} className="flex-1" />
                <Select value={prizePoolCurrency} onValueChange={setPrizePoolCurrency}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---- Schedule & visibility ---- */}
        <Card>
          <CardHeader><CardTitle className="text-base">Schedule &amp; visibility</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="eg-schedule">Scheduled at</Label>
              <Input id="eg-schedule" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
              <div className="space-y-0.5">
                <Label htmlFor="eg-featured" className="cursor-pointer">Featured game</Label>
                <p className="text-xs text-muted-foreground">Show in the home-screen hero carousel.</p>
              </div>
              <Switch id="eg-featured" checked={isFeatured} onCheckedChange={setIsFeatured} />
            </div>
          </CardContent>
        </Card>

        {/* ---- Description & rules ---- */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Description &amp; rules</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="eg-desc">Description</Label>
              <Textarea id="eg-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={1000} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eg-rules">Rules (one per line)</Label>
              <Textarea id="eg-rules" value={rulesText} onChange={(e) => setRulesText(e.target.value)} rows={5} placeholder="No external help.&#10;3 strikes and out." />
            </div>
          </CardContent>
        </Card>

        {/* ---- Styling ---- */}
        <Card>
          <CardHeader><CardTitle className="text-base">Styling</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Accent color</Label>
              <div className="flex gap-2">
                <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)}
                  className="h-9 w-10 cursor-pointer rounded border border-input p-0.5" />
                <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Glow color</Label>
              <div className="flex gap-2">
                <input type="color" value={glowColor} onChange={(e) => setGlowColor(e.target.value)}
                  className="h-9 w-10 cursor-pointer rounded border border-input p-0.5" />
                <Input value={glowColor} onChange={(e) => setGlowColor(e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Gradient colors</Label>
              <div className="flex gap-2">
                <input type="color" value={gradientInput} onChange={(e) => setGradientInput(e.target.value)}
                  className="h-9 w-10 cursor-pointer rounded border border-input p-0.5" />
                <Input value={gradientInput} onChange={(e) => setGradientInput(e.target.value)} className="font-mono flex-1" />
                <Button type="button" size="sm" variant="outline" onClick={addGradient}>Add</Button>
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
          </CardContent>
        </Card>

        {/* ---- Meta & host ---- */}
        <Card>
          <CardHeader><CardTitle className="text-base">Meta &amp; host</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Sponsor</Label>
              <Input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="Sponsor name" />
            </div>
            <div className="space-y-1.5">
              <Label>Tags (comma-separated)</Label>
              <Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="football, sports" />
            </div>
            <div className="space-y-1.5">
              <Label>Host name</Label>
              <Input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="e.g. Alex Johnson" />
            </div>
            <div className="space-y-1.5">
              <Label>Host title</Label>
              <Input value={hostTitle} onChange={(e) => setHostTitle(e.target.value)} placeholder="e.g. Live Host" />
            </div>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Icon, thumbnail, and host avatar are uploaded on the game detail page.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sticky bottom action bar so Save stays reachable on long forms. */}
      <div className="sticky bottom-0 mt-6 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:-mx-6 sm:px-6">
        <div className="flex justify-end gap-2">{actions}</div>
      </div>
    </>
  );
}

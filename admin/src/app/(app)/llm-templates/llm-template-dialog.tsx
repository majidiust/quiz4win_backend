"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createLlmTemplate, updateLlmTemplate } from "@/lib/actions/llm-templates";

export interface LlmTemplate {
  id: string;
  name: string;
  description: string | null;
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
}

// Common OpenAI models — admins can also type a raw model id.
const MODEL_SUGGESTIONS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];

export function LlmTemplateDialog({ template }: { template?: LlmTemplate }) {
  const router = useRouter();
  const isEdit = !!template;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [model, setModel] = useState(template?.model ?? "gpt-4o-mini");
  const [systemPrompt, setSystemPrompt] = useState(template?.system_prompt ?? "");
  const [temperature, setTemperature] = useState(String(template?.temperature ?? 0.8));
  const [maxTokens, setMaxTokens] = useState(String(template?.max_tokens ?? 1500));

  function reset() {
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setModel(template?.model ?? "gpt-4o-mini");
    setSystemPrompt(template?.system_prompt ?? "");
    setTemperature(String(template?.temperature ?? 0.8));
    setMaxTokens(String(template?.max_tokens ?? 1500));
  }

  function submit() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!systemPrompt.trim()) { toast.error("System prompt is required"); return; }
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      model: model.trim() || "gpt-4o-mini",
      system_prompt: systemPrompt.trim(),
      temperature: parseFloat(temperature),
      max_tokens: parseInt(maxTokens, 10) || 1500,
    };
    start(async () => {
      const res = isEdit
        ? await updateLlmTemplate(template!.id, payload)
        : await createLlmTemplate(payload);
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        if (!isEdit) reset();
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button size="sm" variant="outline"><Pencil className="size-3.5" /> Edit</Button>
        ) : (
          <Button size="sm"><Plus className="size-3.5" /> Create template</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit LLM template" : "Create LLM template"}</DialogTitle>
          <DialogDescription>
            The system prompt guides question generation. A mandatory JSON-output
            contract is always appended by the orchestrator, so it can never be broken here.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="lt-name">Name *</Label>
            <Input id="lt-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="e.g. Sports trivia generator" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lt-model">Model *</Label>
            <Input id="lt-model" value={model} onChange={(e) => setModel(e.target.value)} list="lt-models" className="font-mono" placeholder="gpt-4o-mini" />
            <datalist id="lt-models">
              {MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="lt-temp">Temperature</Label>
              <Input id="lt-temp" type="number" min="0" max="2" step="0.05" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lt-max">Max tokens</Label>
              <Input id="lt-max" type="number" min="256" max="8192" step="1" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
            </div>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="lt-desc">Description</Label>
            <Input id="lt-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="Internal note (optional)" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="lt-prompt">System prompt *</Label>
            <Textarea id="lt-prompt" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={10} maxLength={20000} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">
              Describe the persona, subject handling, and factual-accuracy rules.
              Do not include the output schema — it is appended automatically.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} onClick={submit}>{isEdit ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

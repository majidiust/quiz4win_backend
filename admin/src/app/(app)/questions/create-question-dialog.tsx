"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createQuestion, bulkImportQuestions } from "@/lib/actions/questions";

/* ------------------------------------------------------------------ */
/* Create single question                                               */
/* ------------------------------------------------------------------ */
export function CreateQuestionDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [text, setText] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState("0");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("Medium");
  const [language, setLanguage] = useState("en");
  const [explanation, setExplanation] = useState("");

  function setOpt(i: number, val: string) {
    setOptions((prev) => prev.map((o, j) => (j === i ? val : o)));
  }

  function reset() {
    setText(""); setOptions(["", "", "", ""]); setCorrectIndex("0");
    setCategory(""); setDifficulty("Medium"); setLanguage("en"); setExplanation("");
  }

  function submit() {
    if (!text.trim() || !category.trim() || options.some((o) => !o.trim())) {
      toast.error("All fields are required"); return;
    }
    start(async () => {
      const res = await createQuestion({
        text: text.trim(),
        options,
        correct_index: parseInt(correctIndex, 10),
        category: category.trim(),
        difficulty: difficulty as "Easy" | "Medium" | "Hard",
        language: language as "en" | "ar" | "fa" | "tr",
        explanation: explanation.trim() || undefined,
      });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        reset();
        if (res.id) router.push(`/questions/${res.id}`);
        else router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="size-3.5" /> New question</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create question</DialogTitle>
          <DialogDescription>Add a single question to the bank.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cq-text">Question *</Label>
            <Textarea id="cq-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {options.map((opt, i) => (
              <div key={i} className="space-y-1">
                <Label htmlFor={`cq-opt${i}`} className="text-xs">{["A","B","C","D"][i]}.</Label>
                <Input id={`cq-opt${i}`} value={opt} onChange={(e) => setOpt(i, e.target.value)} maxLength={300} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Correct</Label>
              <Select value={correctIndex} onValueChange={setCorrectIndex}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["A","B","C","D"].map((l,i) => <SelectItem key={i} value={String(i)}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Difficulty</Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Easy","Medium","Hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["en","ar","fa","tr"].map((l) => <SelectItem key={l} value={l} className="uppercase">{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cq-cat">Category</Label>
              <Input id="cq-cat" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cq-expl">Explanation (optional)</Label>
            <Input id="cq-expl" value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={1000} />
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

/* ------------------------------------------------------------------ */
/* Bulk import                                                          */
/* ------------------------------------------------------------------ */
export function BulkImportDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await bulkImportQuestions(json);
      if (res.ok) { toast.success(res.message); setOpen(false); setJson(""); router.refresh(); }
      else toast.error(res.message);
    });
  }

  const placeholder = `[
  {
    "text": "What is 2+2?",
    "options": ["3","4","5","6"],
    "correct_index": 1,
    "category": "Math",
    "difficulty": "Easy",
    "language": "en"
  }
]`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Upload className="size-3.5" /> Bulk import</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk import questions</DialogTitle>
          <DialogDescription>Paste a JSON array of up to 500 questions.</DialogDescription>
        </DialogHeader>
        <Textarea value={json} onChange={(e) => setJson(e.target.value)} rows={12} className="font-mono text-xs" placeholder={placeholder} />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" loading={pending} disabled={!json.trim()} onClick={submit}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

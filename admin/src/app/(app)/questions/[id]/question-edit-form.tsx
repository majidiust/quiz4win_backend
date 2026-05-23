"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateQuestion, toggleQuestion, deleteQuestion } from "@/lib/actions/questions";

interface Question {
  id: string;
  text: string;
  options: string[] | unknown;
  correct_index: number;
  category: string;
  difficulty: string;
  language: string;
  explanation: string | null;
  source: string | null;
  active: boolean;
}

interface Props { question: Question; options: string[] }

export function QuestionEditForm({ question, options: initialOptions }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [text, setText] = useState(question.text);
  const [options, setOptions] = useState<string[]>(initialOptions.length === 4 ? initialOptions : ["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(String(question.correct_index));
  const [category, setCategory] = useState(question.category);
  const [difficulty, setDifficulty] = useState(question.difficulty);
  const [language, setLanguage] = useState(question.language);
  const [explanation, setExplanation] = useState(question.explanation ?? "");

  function setOption(i: number, val: string) {
    setOptions((prev) => prev.map((o, j) => (j === i ? val : o)));
  }

  function save() {
    start(async () => {
      const res = await updateQuestion(question.id, {
        text: text.trim(),
        options,
        correct_index: parseInt(correctIndex, 10),
        category: category.trim(),
        difficulty: difficulty as "Easy" | "Medium" | "Hard",
        language: language as "en" | "ar" | "fa" | "tr",
        explanation: explanation.trim() || undefined,
      });
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  function toggle() {
    start(async () => {
      const res = await toggleQuestion(question.id, !question.active);
      if (res.ok) { toast.success(res.message); router.refresh(); }
      else toast.error(res.message);
    });
  }

  function softDelete() {
    if (!confirm("Soft-delete this question? It won't appear in games.")) return;
    start(async () => {
      const res = await deleteQuestion(question.id);
      if (res.ok) { toast.success(res.message); router.push("/questions"); }
      else toast.error(res.message);
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="qe-text">Question text</Label>
        <Textarea id="qe-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {options.map((opt, i) => (
          <div key={i} className="space-y-1">
            <Label htmlFor={`opt-${i}`} className="text-xs">{["A", "B", "C", "D"][i]}.</Label>
            <Input id={`opt-${i}`} value={opt} onChange={(e) => setOption(i, e.target.value)} maxLength={300} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Correct answer</Label>
          <Select value={correctIndex} onValueChange={setCorrectIndex}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["A", "B", "C", "D"].map((l, i) => <SelectItem key={i} value={String(i)}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} />
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
              {["en", "ar", "fa", "tr"].map((l) => <SelectItem key={l} value={l} className="uppercase">{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qe-expl">Explanation</Label>
        <Textarea id="qe-expl" value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} maxLength={1000} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex gap-2">
          <Button variant={question.active ? "outline" : "success"} size="sm" loading={pending} onClick={toggle}>
            {question.active ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="destructive" size="sm" loading={pending} onClick={softDelete}>Delete</Button>
        </div>
        <Button size="sm" loading={pending} onClick={save}>Save changes</Button>
      </div>
    </div>
  );
}

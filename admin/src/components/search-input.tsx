"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function SearchInput({ placeholder = "Search…", paramKey = "q" }: { placeholder?: string; paramKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get(paramKey) ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(paramKey, value);
    else sp.delete(paramKey);
    sp.delete("page");
    router.push(`${pathname}?${sp.toString()}`);
  };

  const clear = () => {
    setValue("");
    const sp = new URLSearchParams(params.toString());
    sp.delete(paramKey);
    sp.delete("page");
    router.push(`${pathname}?${sp.toString()}`);
  };

  return (
    <form onSubmit={submit} className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-9 pl-9 pr-9"
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={clear}
          className="absolute right-1 top-1/2 -translate-y-1/2"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </form>
  );
}

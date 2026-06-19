"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { updateConfigKey, toggleMaintenanceMode, toggleHostApplications, setMonetizationMode } from "@/lib/actions/config";

// Platform withdrawal minimum in USD (mirrors MIN_WITHDRAWAL in the
// withdrawals Edge Function). Used only to preview the coin-equivalent.
const PLATFORM_MIN_WITHDRAWAL_USD = 10;

/* ------------------------------------------------------------------ */
/* Inline editable config row                                           */
/* ------------------------------------------------------------------ */
export function ConfigValueCell({ configKey, value }: { configKey: string; value: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, start] = useTransition();

  function save() {
    if (draft === value) { setEditing(false); return; }
    start(async () => {
      const res = await updateConfigKey(configKey, draft);
      if (res.ok) {
        toast.success(res.message);
        setEditing(false);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 group">
        <span className="font-mono text-xs truncate max-w-xs">{value}</span>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 opacity-0 group-hover:opacity-100 shrink-0"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="h-7 text-xs font-mono w-64"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
        autoFocus
      />
      <Button size="icon" variant="ghost" className="size-7" loading={pending} onClick={save}>
        <Check className="size-3.5 text-green-600" />
      </Button>
      <Button size="icon" variant="ghost" className="size-7" onClick={cancel}>
        <X className="size-3.5 text-destructive" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Host applications toggle                                             */
/* ------------------------------------------------------------------ */
export function HostApplicationsToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [pending, start] = useTransition();

  function toggle(val: boolean) {
    setChecked(val);
    start(async () => {
      const res = await toggleHostApplications(val);
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
        setChecked(!val); // rollback
      }
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border p-4 mb-2">
      <div className="flex-1">
        <p className="text-sm font-medium">Host Applications</p>
        <p className="text-xs text-muted-foreground">
          When disabled, users cannot apply to become hosts. The mobile app reads this flag from{" "}
          <span className="font-mono">GET /config/app</span> and hides the &ldquo;Become a Host&rdquo; entry point.
        </p>
      </div>
      <Switch
        id="host-applications-toggle"
        checked={checked}
        onCheckedChange={toggle}
        disabled={pending}
      />
      <Label htmlFor="host-applications-toggle" className="sr-only">Toggle host applications</Label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monetization mode control                                            */
/* ------------------------------------------------------------------ */
type MonetizationMode = "none" | "coin" | "usd";

const MODE_LABEL: Record<MonetizationMode, string> = {
  usd: "USD — real money",
  coin: "Coin — virtual currency",
  none: "None — cash-out disabled",
};

const MODE_HELP: Record<MonetizationMode, string> = {
  usd: "Default. Withdrawals are entered and paid out in USD.",
  coin: "Balances and withdrawals are shown to players in your branded coin. The server converts coins to USD at the rate below before paying out.",
  none: "Withdrawals are blocked (the API returns 403). Use for App Store / Google Play review builds and regions where real-money cash-out is not licensed.",
};

function MODE_BADGE(mode: MonetizationMode): "default" | "secondary" | "destructive" {
  return mode === "none" ? "destructive" : mode === "coin" ? "secondary" : "default";
}

export function MonetizationModeControl({
  mode,
  coinName,
  coinSymbol,
  rateMicros,
}: {
  mode: MonetizationMode;
  coinName: string;
  coinSymbol: string;
  rateMicros: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [currentMode, setCurrentMode] = useState<MonetizationMode>(mode);
  const [name, setName] = useState(coinName);
  const [symbol, setSymbol] = useState(coinSymbol);
  // Admin-facing input: coins per 1 USD (e.g. 100 means 100 coins = $1).
  // Stored server-side as micro-USD per coin: coinsPerUsd = 1_000_000 / rateMicros.
  const [coinsPerUsd, setCoinsPerUsd] = useState(
    rateMicros > 0 ? String(Math.round(1_000_000 / rateMicros)) : "100",
  );

  const cpu = parseInt(coinsPerUsd, 10);
  const validCpu = Number.isFinite(cpu) && cpu > 0;
  const perCoinUsd = validCpu ? 1 / cpu : 0;
  const minWithdrawalCoins = validCpu ? PLATFORM_MIN_WITHDRAWAL_USD * cpu : 0;
  const coinLabel = name.trim() || "Coins";

  const dirty =
    currentMode !== mode ||
    (currentMode === "coin" &&
      (name !== coinName || symbol !== coinSymbol || (validCpu && Math.round(1_000_000 / cpu) !== rateMicros)));

  function save() {
    if (currentMode === "coin" && !validCpu) {
      toast.error("Enter a positive whole number of coins per $1");
      return;
    }
    const micros = validCpu ? Math.round(1_000_000 / cpu) : rateMicros;
    start(async () => {
      const res = await setMonetizationMode({
        mode: currentMode,
        coinName: name.trim() || "Coins",
        coinSymbol: symbol.trim() || "C",
        rateMicros: micros,
      });
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <div className="rounded-lg border p-4 mb-2 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Monetization Mode</p>
          <p className="text-xs text-muted-foreground">
            Controls real-money cash-out for App Store / Google Play compliance.
          </p>
        </div>
        <Badge variant={MODE_BADGE(mode)} className="shrink-0">Live: {mode}</Badge>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Mode</Label>
          <Select value={currentMode} onValueChange={(v) => setCurrentMode(v as MonetizationMode)}>
            <SelectTrigger className="w-56 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="usd">{MODE_LABEL.usd}</SelectItem>
              <SelectItem value="coin">{MODE_LABEL.coin}</SelectItem>
              <SelectItem value="none">{MODE_LABEL.none}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {currentMode === "coin" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Coin name</Label>
              <Input className="h-8 text-xs w-32" value={name} onChange={(e) => setName(e.target.value)} placeholder="Coins" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Symbol</Label>
              <Input className="h-8 text-xs w-20" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="C" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Coins per $1 USD</Label>
              <Input
                className="h-8 text-xs w-28"
                type="number"
                min={1}
                step={1}
                value={coinsPerUsd}
                onChange={(e) => setCoinsPerUsd(e.target.value)}
                placeholder="100"
              />
            </div>
          </>
        )}

        <Button size="sm" className="h-8 text-xs" loading={pending} disabled={!dirty} onClick={save}>
          Save changes
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{MODE_HELP[currentMode]}</p>

      {currentMode === "coin" && validCpu && (
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <p>
            Exchange rate:{" "}
            <span className="font-medium text-foreground">
              {cpu.toLocaleString()} {coinLabel} = $1.00
            </span>{" "}
            (1 {coinLabel} = ${perCoinUsd.toFixed(4)})
          </p>
          <p>
            The ${PLATFORM_MIN_WITHDRAWAL_USD.toFixed(2)} platform minimum withdrawal is{" "}
            <span className="font-medium text-foreground">
              {minWithdrawalCoins.toLocaleString()} {coinLabel}
            </span>{" "}
            at this rate.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Maintenance mode toggle                                              */
/* ------------------------------------------------------------------ */
export function MaintenanceModeToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [pending, start] = useTransition();

  function toggle(val: boolean) {
    setChecked(val);
    start(async () => {
      const res = await toggleMaintenanceMode(val);
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
        setChecked(!val); // rollback
      }
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border p-4 mb-4">
      <div className="flex-1">
        <p className="text-sm font-medium">Maintenance Mode</p>
        <p className="text-xs text-muted-foreground">
          When enabled, the app shows a maintenance screen to all players.
        </p>
      </div>
      <Switch
        id="maintenance-toggle"
        checked={checked}
        onCheckedChange={toggle}
        disabled={pending}
      />
      <Label htmlFor="maintenance-toggle" className="sr-only">Toggle maintenance mode</Label>
    </div>
  );
}

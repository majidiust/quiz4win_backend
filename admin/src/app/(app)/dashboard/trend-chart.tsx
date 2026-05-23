"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoneyDecimal, formatNumber } from "@/lib/utils";

interface TrendChartProps {
  data: readonly object[];
  dataKey: string;
  color: string;
  valueFormat: "number" | "money";
}

export function TrendChart({ data, dataKey, color, valueFormat }: TrendChartProps) {
  const valueFormatter = valueFormat === "money" ? formatMoneyDecimal : formatNumber;
  const id = `g-${String(dataKey)}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => d.slice(5)}
          stroke="var(--muted-foreground)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="var(--muted-foreground)"
          fontSize={11}
          tickFormatter={(v: number) => valueFormatter(v)}
          tickLine={false}
          axisLine={false}
          width={70}
        />
        <Tooltip
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(v) => valueFormatter(Number(v))}
          labelFormatter={(l) => String(l)}
        />
        <Area
          type="monotone"
          dataKey={String(dataKey)}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${id})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SERIES, STATUS_META, inr } from "@/lib/format";

const AXIS = { stroke: "#898781", fontSize: 11, tickLine: false, axisLine: { stroke: "#d6d3d1" } } as const;
const GRID = <CartesianGrid stroke="#eeedeb" vertical={false} />;
const TIP = { contentStyle: { borderRadius: 8, border: "1px solid #e7e5e4", fontSize: 12 }, cursor: { fill: "rgba(0,0,0,0.04)" } };
const shortDate = (d: string) => d.slice(5).replace("-", "/");

const legendText = (v: string) => <span style={{ color: "#52514e" }}>{v}</span>;

const Empty = () => <div className="flex h-56 items-center justify-center text-sm text-stone-400">No data for these filters</div>;

export function VolumeChart({ data }: { data: { date: string; qualified: number; not_qualified: number; awaiting_info: number; escalated: number }[] }) {
  if (!data.length) return <Empty />;
  const keys = ["qualified", "not_qualified", "awaiting_info", "escalated"] as const;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} barCategoryGap="25%">
        {GRID}
        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} />
        <YAxis allowDecimals={false} width={28} {...AXIS} />
        <Tooltip {...TIP} labelFormatter={(l) => `Date ${l}`} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
        {keys.map((k, i) => (
          <Bar isAnimationActive={false} key={k} dataKey={k} stackId="s" name={STATUS_META[k].label} fill={STATUS_META[k].color} stroke="#fff" strokeWidth={1} radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OutcomesChart({ data }: { data: { status: string; count: number }[] }) {
  if (!data.some((d) => d.count)) return <Empty />;
  const rows = data.map((d) => ({ ...d, label: STATUS_META[d.status].label }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid stroke="#eeedeb" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...AXIS} />
        <YAxis type="category" dataKey="label" width={140} {...AXIS} />
        <Tooltip {...TIP} />
        <Bar isAnimationActive={false} dataKey="count" name="Enquiries" radius={[0, 4, 4, 0]} maxBarSize={26} label={{ position: "right", fontSize: 12, fill: "#52514e" }}>
          {rows.map((r) => (
            <Cell key={r.status} fill={STATUS_META[r.status].color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ResponseChart({ data }: { data: { bucket: string; count: number }[] }) {
  if (!data.some((d) => d.count)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        {GRID}
        <XAxis dataKey="bucket" {...AXIS} />
        <YAxis allowDecimals={false} width={28} {...AXIS} />
        <Tooltip {...TIP} />
        <Bar isAnimationActive={false} dataKey="count" name="Enquiries (time to answer)" fill={SERIES.ai} radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CostChart({ data }: { data: { date: string; ai: number; telephony: number; email: number }[] }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} barCategoryGap="25%">
        {GRID}
        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} />
        <YAxis width={44} tickFormatter={(v) => `₹${v}`} {...AXIS} />
        <Tooltip {...TIP} formatter={(v: number) => inr(v, 2)} labelFormatter={(l) => `Date ${l}`} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
        <Bar isAnimationActive={false} dataKey="ai" stackId="c" name="AI (est.)" fill={SERIES.ai} stroke="#fff" strokeWidth={1} maxBarSize={28} />
        <Bar isAnimationActive={false} dataKey="telephony" stackId="c" name="Telephony (est.)" fill={SERIES.telephony} stroke="#fff" strokeWidth={1} maxBarSize={28} />
        <Bar isAnimationActive={false} dataKey="email" stackId="c" name="Email" fill={SERIES.email} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

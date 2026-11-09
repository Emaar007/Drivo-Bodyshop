// Thin Recharts wrappers that follow the dataviz rules: thin marks, 4px rounded data ends, one axis,
// categorical colours assigned in fixed slot order, status colours reserved, tooltips on every mark,
// text in ink tokens (never series colours). Colours come from CSS variables so dark mode is selected.
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money, pct } from '../format';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];
export const SEQ = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];

const axisStyle = { fontSize: 11, fill: 'var(--text-3)' };
const gridStroke = 'var(--border)';
/** Axis ticks: whole dollars / whole percent; tooltips and labels keep the exact value. */
const tickOf = (format: (v: number) => string) => (v: number) => (format === money ? money(v, { compact: true }) : format(v));

export function TooltipBox({ active, payload, label, format }: { active?: boolean; payload?: { name: string; value: number; color?: string }[]; label?: string; format: (v: number, name: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md">
      <div className="mb-0.5 font-medium text-ink">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-ink-2">
          {p.color && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />}
          <span>{p.name}</span>
          <span className="num ml-auto pl-3 text-ink">{format(p.value, p.name)}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontal bars: category per row, one measure. Used for "outstanding by X" and "collection rate by X". */
export function BarList({ data, valueKey, nameKey = 'name', format = money, height, color = SERIES[0], onClick, domain }: {
  data: Record<string, unknown>[];
  valueKey: string;
  nameKey?: string;
  format?: (v: number) => string;
  height?: number;
  color?: string;
  onClick?: (row: Record<string, unknown>) => void;
  domain?: [number, number];
}) {
  const h = height ?? Math.max(120, 28 * data.length + 30);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 76, bottom: 4, left: 8 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={gridStroke} strokeDasharray="2 4" />
        <XAxis type="number" tick={axisStyle} tickFormatter={tickOf(format)} axisLine={false} tickLine={false} domain={domain} />
        <YAxis type="category" dataKey={nameKey} width={150} tick={{ ...axisStyle, fill: 'var(--text-2)' }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<TooltipBox format={(v) => format(v)} />} />
        <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} barSize={14} onClick={onClick ? (d: unknown) => onClick((d as { payload: Record<string, unknown> }).payload) : undefined} cursor={onClick ? 'pointer' : undefined}
          label={{ position: 'right', fontSize: 11, fill: 'var(--text-2)', formatter: (v: unknown) => format(Number(v)) }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical stacked bars over categories (e.g. aging buckets by payer, monthly billed vs outstanding). */
export function StackedBars({ data, series, nameKey = 'name', format = money, height = 220, stacked = true }: {
  data: Record<string, unknown>[];
  series: { key: string; label: string }[];
  nameKey?: string;
  format?: (v: number) => string;
  height?: number;
  stacked?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }} barCategoryGap={stacked ? 12 : 8} barGap={2}>
        <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="2 4" />
        <XAxis dataKey={nameKey} tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis tick={axisStyle} tickFormatter={tickOf(format)} axisLine={false} tickLine={false} width={64} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<TooltipBox format={(v) => format(v)} />} />
        {series.length > 1 && <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--text-2)' }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId={stacked ? 'a' : undefined} fill={SERIES[i % SERIES.length]} stroke="var(--surface)" strokeWidth={stacked ? 2 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={48} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Lines over time. One axis: pass values of one kind (e.g. all $ or all %). */
export function TrendLines({ data, series, nameKey = 'name', format = money, height = 220 }: {
  data: Record<string, unknown>[];
  series: { key: string; label: string }[];
  nameKey?: string;
  format?: (v: number) => string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="2 4" />
        <XAxis dataKey={nameKey} tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis tick={axisStyle} tickFormatter={tickOf(format)} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<TooltipBox format={(v) => format(v)} />} />
        {series.length > 1 && <Legend iconType="plainline" iconSize={12} wrapperStyle={{ fontSize: 11, color: 'var(--text-2)' }} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: 'var(--surface)', fill: SERIES[i % SERIES.length] }} activeDot={{ r: 5 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Single-hue sequential bars for rates (0-100%). */
export function RateBars({ data, nameKey = 'name', valueKey = 'rate', onClick }: { data: Record<string, unknown>[]; nameKey?: string; valueKey?: string; onClick?: (row: Record<string, unknown>) => void }) {
  const h = Math.max(120, 28 * data.length + 30);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 76, bottom: 4, left: 8 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={gridStroke} strokeDasharray="2 4" />
        <XAxis type="number" domain={[0, 1]} tick={axisStyle} tickFormatter={(v: number) => pct(v)} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey={nameKey} width={150} tick={{ ...axisStyle, fill: 'var(--text-2)' }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<TooltipBox format={(v) => pct(v, 1)} />} />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} barSize={14} onClick={onClick ? (d: unknown) => onClick((d as { payload: Record<string, unknown> }).payload) : undefined} cursor={onClick ? 'pointer' : undefined}
          label={{ position: 'right', fontSize: 11, fill: 'var(--text-2)', formatter: (v: unknown) => pct(Number(v)) }}>
          {data.map((d, i) => <Cell key={i} fill={SEQ[Math.min(SEQ.length - 1, Math.floor(Number(d[valueKey] ?? 0) * SEQ.length))]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

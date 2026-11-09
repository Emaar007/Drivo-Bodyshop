// Single source of truth for the small UI pieces (PROJECT.md section 9).
// Radix handles behaviour (Select, Tooltip, Switch); lucide for icons; tokens from index.css only.
import { useId, type ReactNode } from 'react';
import * as RSelect from '@radix-ui/react-select';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RSwitch from '@radix-ui/react-switch';
import { Check, ChevronDown, Minus } from 'lucide-react';
import type { PayerType } from '@shared/types';
import { PAYER_LABEL } from '@shared/config/rules';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel ${className}`}>{children}</div>;
}

export function PanelHeader({ title, right, className = '' }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <header className={`flex h-10 items-center justify-between gap-3 border-b border-line px-4 ${className}`}>
      <h2 className="section-title">{title}</h2>
      {right}
    </header>
  );
}

/** A flat KPI cell: caps label, mono value, optional delta or sparkline. */
export function Stat({ label, value, tone, foot, onClick }: { label: string; value: ReactNode; tone?: 'danger' | 'warn' | 'ok'; foot?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`flex min-w-0 flex-col items-start gap-1 py-1 text-left ${onClick ? 'group cursor-pointer' : ''}`}>
      <span className={`lbl ${onClick ? 'group-hover:text-text1' : ''}`}>{label}</span>
      <span className={`num text-[28px] leading-none ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-text0'}`}>{value}</span>
      {foot && <span className="flex h-5 items-center text-[11px] text-text2">{foot}</span>}
    </Tag>
  );
}

/** 1.5px sparkline, last point marked. Pass the raw series; it scales itself. */
export function Sparkline({ values, width = 72, height = 18, tone = 'muted' }: { values: number[]; width?: number; height?: number; tone?: 'muted' | 'danger' | 'ok' }) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return <span className="text-[11px] text-text2">no history yet</span>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = (width - 4) / (pts.length - 1);
  const xy = pts.map((v, i) => [2 + i * step, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'ok' ? 'var(--ok)' : 'var(--text-2)';
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true" className="shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2} fill={color} />
    </svg>
  );
}

/** Outlined tag with a 6px dot and the word spelled out. */
export function Tag({ color, children, title }: { color: string; children: ReactNode; title?: string }) {
  return (
    <span className="tag" style={{ borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, color }} title={title}>
      <i className="tag-dot" style={{ background: color }} />
      {children}
    </span>
  );
}

const PAYER_COLOR: Record<PayerType, string> = {
  customer: 'var(--payer-customer)',
  insurance: 'var(--payer-insurance)',
  bodyshop: 'var(--payer-bodyshop)',
  mixed: 'var(--text-1)',
  other: 'var(--text-1)',
  unknown: 'var(--text-2)',
};
export function PayerTag({ payer }: { payer: PayerType }) {
  return <Tag color={PAYER_COLOR[payer]}>{PAYER_LABEL[payer]}</Tag>;
}

export function StatusDot({ tone, label, className = '' }: { tone: 'ok' | 'warn' | 'danger' | 'neutral'; label?: string; className?: string }) {
  const c = tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : tone === 'danger' ? 'bg-danger' : 'bg-text2';
  return <span className={`inline-flex items-center gap-1.5 ${className}`}><i className={`inline-block h-1.5 w-1.5 rounded-full ${c}`} aria-hidden="true" />{label}</span>;
}

export function IconButton({ label, onClick, children, size = 'md', disabled, active, className = '', type = 'button' }: {
  label: string; onClick?: () => void; children: ReactNode; size?: 'sm' | 'md'; disabled?: boolean; active?: boolean; className?: string; type?: 'button' | 'submit';
}) {
  return (
    <Tooltip label={label}>
      <button type={type} aria-label={label} onClick={onClick} disabled={disabled} className={`btn-icon ${size === 'sm' ? 'btn-icon-sm' : ''} ${active ? 'bg-brand-tint text-brand-bright' : ''} ${className}`}>
        {children}
      </button>
    </Tooltip>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={300} skipDelayDuration={200}>{children}</RTooltip.Provider>;
}

export function Tooltip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-[6px] border border-line bg-bg2 px-2.5 py-1.5 text-xs text-text0" style={{ boxShadow: 'var(--shadow)' }}>
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/** Underlined tabs with mono counts. */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="inline-flex gap-5 border-b border-line text-[13px]" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={`-mb-px flex h-9 items-center gap-1.5 border-b-2 px-0.5 transition-colors duration-150 ${value === it.value ? 'border-brand-bright text-text0' : 'border-transparent text-text1 hover:text-text0'}`}
        >
          {it.label}
          {it.count !== undefined && <span className="num text-[12px] text-text2">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Compact custom dropdown (Radix Select). An empty value means "all". */
export function FilterSelect({ value, onChange, options, allLabel, label, width }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel: string; label?: string; width?: number;
}) {
  const ALL = '__all__';
  return (
    <RSelect.Root value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <RSelect.Trigger aria-label={label ?? allLabel} className="inline-flex h-8 items-center justify-between gap-2 rounded-[6px] border border-line-strong bg-bg1 px-2.5 text-[13px] text-text0 hover:bg-bg2 focus:border-brand-bright focus:outline-none data-[placeholder]:text-text1" style={width ? { width } : undefined}>
        <RSelect.Value />
        <RSelect.Icon><ChevronDown size={14} className="text-text2" /></RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={4} className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[6px] border border-line bg-bg1 py-1 text-[13px]" style={{ boxShadow: 'var(--shadow)' }}>
          <RSelect.Viewport>
            <SelectItem value={ALL}>{allLabel}</SelectItem>
            {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RSelect.Item value={value} className="relative flex h-8 cursor-pointer select-none items-center pl-7 pr-3 text-text0 outline-none data-[highlighted]:bg-brand-tint data-[state=checked]:text-brand-bright">
      <RSelect.ItemIndicator className="absolute left-2 inline-flex"><Check size={13} /></RSelect.ItemIndicator>
      <RSelect.ItemText>{children}</RSelect.ItemText>
    </RSelect.Item>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex h-8 cursor-pointer select-none items-center gap-2 text-[13px] text-text1">
      <RSwitch.Root id={id} checked={checked} onCheckedChange={onChange} className="relative h-4 w-7 rounded-full border border-line-strong bg-bg2 transition-colors duration-150 data-[state=checked]:border-brand-bright data-[state=checked]:bg-brand-bright">
        <RSwitch.Thumb className="block h-3 w-3 translate-x-[1px] rounded-full bg-text0 transition-transform duration-150 data-[state=checked]:translate-x-[13px] data-[state=checked]:bg-on-brand" />
      </RSwitch.Root>
      {label}
    </label>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <div className="flex items-center gap-2 text-[14px] text-text1"><Check size={16} strokeWidth={1.5} className="text-ok" />{title}</div>
      {hint && <div className="max-w-md text-[12px] text-text2">{hint}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-[4px] bg-bg2 ${className}`} aria-hidden="true" />;
}

export function Dash() {
  return <Minus size={12} className="inline text-text2" aria-label="none" />;
}

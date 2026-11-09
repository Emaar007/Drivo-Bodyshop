// Compatibility layer: the names the pages already use, implemented on the ui/ primitives and tokens.
import { useState, type ReactNode } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { PayerType } from '@shared/types';
import { money, telHref } from '../format';
import { EmptyState, Stat, Tabs as UiTabs, PayerTag } from '../ui/primitives';

export { Tabs as UiTabs } from '../ui/primitives';

/** KPI cell (legacy name). */
export function Kpi({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'serious' | 'critical'; onClick?: () => void }) {
  const t = tone === 'good' ? 'ok' : tone === 'warn' ? 'warn' : tone ? 'danger' : undefined;
  return <Stat label={label} value={value} tone={t} foot={sub} onClick={onClick} />;
}

/** Flat KPI cells separated by hairlines. */
export function Strip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`strip ${className}`} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>{children}</div>;
}

export function Chip({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'good' | 'warn' | 'serious' | 'critical' | 'accent'; children: ReactNode; title?: string }) {
  return <span className={`chip chip-${tone}`} title={title}>{children}</span>;
}

export function PayerChip({ payer }: { payer: PayerType }) {
  return <PayerTag payer={payer} />;
}

export function Phone({ phone, label }: { phone: string | null | undefined; label?: string }) {
  const href = telHref(phone);
  if (!href) return <span className="text-text2">{label ? `${label}: ` : ''}-</span>;
  return (
    <a href={href} className="num text-[12.5px] text-brand-bright hover:underline whitespace-nowrap">
      {label ? `${label} ` : ''}{phone}
    </a>
  );
}

export function Email({ email }: { email: string | null | undefined }) {
  if (!email) return null;
  return <a href={`mailto:${email}`} className="text-brand-bright hover:underline break-all">{email}</a>;
}

export function Money({ value, estimated, signed }: { value: number | null | undefined; estimated?: boolean; signed?: boolean }) {
  if (value === null || value === undefined) return <span className="text-text2">-</span>;
  const neg = value < -0.005;
  return (
    <span className={`num ${neg ? 'text-ok' : ''}`} title={estimated ? 'Estimated: TSD posts the charges when the car is returned' : undefined}>
      {signed && value > 0 ? '+' : ''}{money(value)}{estimated ? <span className="ml-0.5 text-[9px] text-text2 align-top">est</span> : null}
    </span>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return <div className="panel"><EmptyState title={title} hint={hint} /></div>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-text2">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line-strong border-t-brand-bright" /> {label}
    </div>
  );
}

export function Tabs<T extends string>(props: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return <UiTabs {...props} />;
}

export function Section({ title, right, children, className = '' }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-4 py-1.5">
        <h2 className="section-title">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display text-[28px] leading-none text-text0">{title}</h1>
        {subtitle && <div className="mt-1.5 max-w-[80ch] text-[13px] text-text1">{subtitle}</div>}
      </div>
      {right && <div className="no-print flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-[6px] border border-line bg-bg2 px-3 py-2 text-[13px] text-text0" style={{ boxShadow: 'var(--shadow)' }}>{message}</div>;
}

export function useToast(): [string | null, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };
  return [msg, show];
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text1">
      <span className="lbl">{label}</span>
      {children}
      {hint && <span className="text-text2">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <RDialog.Root open onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RDialog.Content className="panel fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 focus:outline-none" style={{ boxShadow: 'var(--shadow)' }}>
          <header className="flex h-11 items-center justify-between border-b border-line px-4">
            <RDialog.Title className="display text-[17px] leading-none">{title}</RDialog.Title>
            <RDialog.Close className="btn-icon btn-icon-sm" aria-label="Close"><X size={15} /></RDialog.Close>
          </header>
          <div className="flex flex-col gap-3 px-4 py-3">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</footer>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

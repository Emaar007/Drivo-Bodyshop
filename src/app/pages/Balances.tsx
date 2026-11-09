import { useEffect, useMemo, useState } from 'react';
import { CoverageMeter } from '../ui/Coverage';
import { coverageText } from '@shared/coverage';
import { useSearchParams } from 'react-router-dom';
import type { Rental } from '@shared/types';
import { PAYER_LABEL } from '@shared/config/rules';
import { agingBucket, daysOutstanding, groupTotals, outstanding } from '@shared/rules';
import { useStore } from '../store';
import { downloadText, formatDate, money } from '../format';
import { DataTable, rowsToCsv, useSort, type Column } from '../components/DataTable';
import { Chip, Kpi, Money, PageHeader, PayerChip, Section, Spinner } from '../components/ui';

type Preset = 'largest' | 'oldest' | 'customer' | '';

export default function BalancesPage() {
  const { loading, rentals, today, rules, openRental } = useStore();
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const set = (k: string, v: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const q = get('q'), payer = get('payer'), insurer = get('insurer'), shop = get('shop'), status = get('status'), age = get('age'), minDays = get('minDays'), minDue = get('minDue'), maxDue = get('maxDue'), owes = get('owes'), month = get('month'), dropMonth = get('dropMonth');
  const includeSubs = get('subs') !== '0';
  const [preset, setPreset] = useState<Preset>('');

  const withBalance = useMemo(() => rentals.filter((r) => (includeSubs || r.kind === 'rental') && r.money.totalAmountDue > 0.005), [rentals, includeSubs]);
  const credits = useMemo(() => rentals.filter((r) => r.money.totalAmountDue < -0.005), [rentals]);
  const insurers = useMemo(() => [...new Set(withBalance.map((r) => r.insurer?.name).filter((x): x is string => !!x))].sort(), [withBalance]);
  const shops = useMemo(() => [...new Set(withBalance.map((r) => r.bodyshop?.name).filter((x): x is string => !!x))].sort(), [withBalance]);

  const rows = useMemo(() => withBalance.filter((r) => {
    if (q) {
      const s = q.toLowerCase();
      if (!r.raNumber.toLowerCase().includes(s) && !r.renter.name.toLowerCase().includes(s) && !(r.bodyshop?.name ?? '').toLowerCase().includes(s) && !(r.insurer?.name ?? '').toLowerCase().includes(s)) return false;
    }
    if (payer && r.payerType !== payer) return false;
    if (insurer && r.insurer?.name !== insurer) return false;
    if (shop && r.bodyshop?.name !== shop) return false;
    if (status === 'out' && !r.isOut) return false;
    if (status === 'returned' && r.isOut) return false;
    const d = daysOutstanding(r, today);
    if (age && (!d || agingBucket(d.days, rules) !== age)) return false;
    if (minDays && (!d || d.days < Number(minDays))) return false;
    if (minDue && r.money.totalAmountDue < Number(minDue)) return false;
    if (maxDue && r.money.totalAmountDue > Number(maxDue)) return false;
    if (owes === 'customer' && r.money.renterAmountDue <= 0.005) return false;
    if (owes === 'company' && r.money.companyAmountDue <= 0.005) return false;
    if (month && (r.pickupDate ?? '').slice(0, 7) !== month) return false;
    if (dropMonth && ((r.actualReturn ?? r.scheduledDropOff ?? '').slice(0, 7)) !== dropMonth) return false;
    return true;
  }), [withBalance, q, payer, insurer, shop, status, age, minDays, minDue, maxDue, owes, month, dropMonth, today, rules]);

  const columns: Column<Rental>[] = useMemo(() => [
    { key: 'ra', label: 'R/A', value: (r) => r.raNumber, render: (r) => <span className="ra text-accent">{r.raNumber}{r.kind === 'after_rental' && <span className="ml-1 text-[10px] text-ink-3">after-rental</span>}</span> },
    { key: 'status', label: 'Status', value: (r) => (r.isOut ? 'out' : 'returned'), render: (r) => <Chip tone={r.isOut ? 'accent' : 'neutral'}>{r.isOut ? 'Out' : 'Returned'}</Chip> },
    { key: 'payer', label: 'Payer', value: (r) => PAYER_LABEL[r.payerType], render: (r) => <PayerChip payer={r.payerType} /> },
    { key: 'coverage', label: 'Coverage', value: (r) => (r.coverage.applies ? coverageText(r.coverage) : ''), render: (r) => (r.coverage.applies ? <CoverageMeter coverage={r.coverage} compact /> : <span className="text-text2">-</span>) },
    { key: 'renterDue', label: 'Renter owes', value: (r) => r.money.renterAmountDue, align: 'right', render: (r) => <Money value={r.money.renterAmountDue} /> },
    { key: 'companyDue', label: 'Company owes', value: (r) => r.money.companyAmountDue, align: 'right', render: (r) => <Money value={r.money.companyAmountDue} /> },
    { key: 'renter', label: 'Renter', value: (r) => r.renter.name },
    { key: 'shop', label: 'Body shop', value: (r) => r.bodyshop?.name ?? '' },
    { key: 'insurer', label: 'Insurer', value: (r) => r.insurer?.name ?? '' },
    { key: 'pickup', label: 'Pickup', value: (r) => r.pickupDate, render: (r) => formatDate(r.pickupDate) },
    { key: 'drop', label: 'Drop-off', value: (r) => r.actualReturn ?? r.scheduledDropOff, render: (r) => formatDate(r.actualReturn ?? r.scheduledDropOff) },
    { key: 'days', label: 'Days outstanding', value: (r) => daysOutstanding(r, today)?.days ?? null, align: 'right', render: (r) => { const d = daysOutstanding(r, today); return d ? <span title={d.basis}>{d.days}<span className="text-[10px] text-ink-3"> {d.basis === 'since pickup' ? 'out' : ''}</span></span> : '—'; } },
    { key: 'bill', label: 'Total bill', value: (r) => r.money.totalBill, align: 'right', render: (r) => <Money value={r.money.totalBill} estimated={r.money.estimated} /> },
    { key: 'due', label: 'Amount due', value: (r) => r.money.totalAmountDue, align: 'right', bar: true, render: (r) => <strong><Money value={r.money.totalAmountDue} estimated={r.money.estimated} /></strong> },
  ], [today]);

  const { sorted, sort, toggle, setSort } = useSort(rows, columns, { key: 'due', dir: 'desc' });

  useEffect(() => {
    if (preset === 'largest') { setSort({ key: 'due', dir: 'desc' }); set('owes', ''); }
    if (preset === 'oldest') { setSort({ key: 'days', dir: 'desc' }); set('owes', ''); }
    if (preset === 'customer') { set('owes', 'customer'); setSort({ key: 'due', dir: 'desc' }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const total = rows.reduce((s, r) => s + outstanding(r), 0);
  const byPayer = groupTotals(rows, (r) => PAYER_LABEL[r.payerType]).sort((a, b) => b.totals.outstanding - a.totals.outstanding);
  const byInsurer = groupTotals(rows, (r) => r.insurer?.name ?? null).sort((a, b) => b.totals.outstanding - a.totals.outstanding);
  const byShop = groupTotals(rows, (r) => r.bodyshop?.name ?? null).sort((a, b) => b.totals.outstanding - a.totals.outstanding);
  const aging = rules.agingBuckets.map((b) => ({ label: b.label, amount: rows.filter((r) => { const d = daysOutstanding(r, today); return d && agingBucket(d.days, rules) === b.label; }).reduce((s, r) => s + outstanding(r), 0) }));
  const top10 = [...rows].sort((a, b) => b.money.totalAmountDue - a.money.totalAmountDue).slice(0, 10);

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Balances"
        subtitle="Every rental with an amount due, open and returned. Click a row for contacts, history and notes."
        right={<>
          <select className="select" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            <option value="">Quick presets…</option>
            <option value="largest">Largest balances</option>
            <option value="oldest">Oldest unpaid</option>
            <option value="customer">Customer-paid owing</option>
          </select>
          <button className="btn btn-sm" onClick={() => downloadText(`balances_${today}.csv`, rowsToCsv(sorted, columns))}>Export CSV</button>
        </>}
      />

      <div className="strip mb-5">
        <Kpi label="Total due (filtered)" value={money(total, { compact: true })} tone={total > 0 ? 'serious' : undefined} sub={`${rows.length} rentals`} />
        {byPayer.slice(0, 3).map((g) => <Kpi key={g.key} label={`${g.key} owes`} value={money(g.totals.outstanding, { compact: true })} sub={`${g.totals.withBalance} rentals`} onClick={() => set('payer', Object.entries(PAYER_LABEL).find(([, v]) => v === g.key)?.[0] ?? '')} />)}
        <Kpi label="Credits (overpaid)" value={money(credits.reduce((s, r) => s - r.money.totalAmountDue, 0), { compact: true })} tone="good" sub={`${credits.length} rentals, not receivable`} />
        <Kpi label="60+ days" value={money(aging[aging.length - 1]?.amount ?? 0, { compact: true })} tone={aging[aging.length - 1]?.amount ? 'critical' : undefined} onClick={() => set('age', aging[aging.length - 1]?.label ?? '')} />
      </div>

      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <input className="input w-56" placeholder="Search R/A, renter, shop, insurer" value={q} onChange={(e) => set('q', e.target.value)} />
        <select className="select" value={payer} onChange={(e) => set('payer', e.target.value)}><option value="">All payers</option>{Object.entries(PAYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="select" value={owes} onChange={(e) => set('owes', e.target.value)}><option value="">Anyone owes</option><option value="customer">Customer owes</option><option value="company">Company owes</option></select>
        <select className="select" value={status} onChange={(e) => set('status', e.target.value)}><option value="">Out + returned</option><option value="out">Still out</option><option value="returned">Returned</option></select>
        <select className="select" value={insurer} onChange={(e) => set('insurer', e.target.value)}><option value="">All insurers</option>{insurers.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="select" value={shop} onChange={(e) => set('shop', e.target.value)}><option value="">All body shops</option>{shops.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="select" value={age} onChange={(e) => set('age', e.target.value)}><option value="">Any age</option>{rules.agingBuckets.map((b) => <option key={b.label}>{b.label}</option>)}</select>
        <input className="input w-28" type="number" placeholder="Min days" value={minDays} onChange={(e) => set('minDays', e.target.value)} />
        <input className="input w-28" type="number" placeholder="Min $" value={minDue} onChange={(e) => set('minDue', e.target.value)} />
        <input className="input w-28" type="number" placeholder="Max $" value={maxDue} onChange={(e) => set('maxDue', e.target.value)} />
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2"><input type="checkbox" checked={includeSubs} onChange={(e) => set('subs', e.target.checked ? '' : '0')} /> Include after-rental charges (damage)</label>
        {(month || dropMonth) && <Chip tone="accent">{month ? `pickup ${month}` : `drop-off ${dropMonth}`} <button onClick={() => { set('month', ''); set('dropMonth', ''); }}>✕</button></Chip>}
        {sp.toString() && <button className="btn btn-ghost btn-sm" onClick={() => setSp({}, { replace: true })}>Clear</button>}
      </div>

      <div className="sheet mb-4">
        <DataTable rows={sorted} columns={columns} rowKey={(r) => r.raNumber} onRowClick={(r) => openRental(r.raNumber)} sort={sort} onSort={toggle} empty="No balances match" maxHeight="60vh" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Breakdown title="By payer type" rows={byPayer} onPick={(k) => set('payer', Object.entries(PAYER_LABEL).find(([, v]) => v === k)?.[0] ?? '')} />
        <Breakdown title="By insurer" rows={byInsurer} onPick={(k) => set('insurer', k)} />
        <Breakdown title="By body shop" rows={byShop} onPick={(k) => set('shop', k)} />
        <Section title="Aging">
          <ul className="divide-y divide-border text-sm">
            {aging.map((a) => (
              <li key={a.label} className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-surface-2" onClick={() => set('age', a.label)}>
                <span>{a.label}</span><span className="num font-medium">{money(a.amount)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <Section title="Top 10 balances" className="mt-4">
        <ul className="divide-y divide-border text-sm">
          {top10.map((r) => (
            <li key={r.raNumber} className="flex items-center justify-between gap-3 px-4 py-2 cursor-pointer hover:bg-surface-2" onClick={() => openRental(r.raNumber)}>
              <span className="ra text-accent">{r.raNumber}</span>
              <span className="flex-1 truncate text-ink-2">{r.renter.name}{r.bodyshop ? `, ${r.bodyshop.name}` : ''}{r.companyName ? `, ${r.companyName}` : ''}</span>
              <PayerChip payer={r.payerType} />
              <span className="num font-semibold"><Money value={r.money.totalAmountDue} estimated={r.money.estimated} /></span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Breakdown({ title, rows, onPick }: { title: string; rows: { key: string; totals: { outstanding: number; withBalance: number } }[]; onPick: (k: string) => void }) {
  return (
    <Section title={title}>
      <ul className="divide-y divide-border text-sm max-h-72 overflow-auto">
        {rows.length === 0 && <li className="px-4 py-3 text-ink-3">—</li>}
        {rows.map((g) => (
          <li key={g.key} className="flex items-center justify-between gap-2 px-4 py-2 cursor-pointer hover:bg-surface-2" onClick={() => onPick(g.key)}>
            <span className="truncate">{g.key} <span className="text-ink-3">({g.totals.withBalance})</span></span>
            <span className="num font-medium">{money(g.totals.outstanding)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

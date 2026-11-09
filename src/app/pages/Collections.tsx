import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Rental, Snapshot } from '@shared/types';
import { PAYER_LABEL } from '@shared/config/rules';
import { addDays } from '@shared/dates';
import { agingBucket, amountAtRisk, collectionTotals, collectionTotalsShare, daysOutstanding, dropOffMonth, groupTotals, outstanding, pickupMonth, type CollectionTotals } from '@shared/rules';
import { useStore } from '../store';
import { api } from '../api';
import { money, monthLabel, pct } from '../format';
import { Kpi, PageHeader, Section, Spinner, Tabs } from '../components/ui';
import { BarList, RateBars, TrendLines } from '../components/charts';

type Dim = 'payer' | 'insurer' | 'shop' | 'pickupMonth' | 'dropMonth';
type View = 'chart' | 'table';

export default function CollectionsPage() {
  const { loading, rentals, today, rules } = useStore();
  const nav = useNavigate();
  const [dim, setDim] = useState<Dim>('payer');
  const [view, setView] = useState<View>('chart');
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [includeSubs, setIncludeSubs] = useState(true);

  useEffect(() => { api.history().then(setSnapshots).catch(() => setSnapshots([])); }, []);

  const scope = useMemo(() => rentals.filter((r) => includeSubs || r.kind === 'rental'), [rentals, includeSubs]);
  const totals = collectionTotals(scope);
  const renter = collectionTotalsShare(scope, 'renter');
  const company = collectionTotalsShare(scope, 'company');
  const atRisk = amountAtRisk(scope, today, rules);

  const keyOf: Record<Dim, (r: Rental) => string | null> = {
    payer: (r) => PAYER_LABEL[r.payerType],
    insurer: (r) => r.insurer?.name ?? null,
    shop: (r) => r.bodyshop?.name ?? null,
    pickupMonth: (r) => pickupMonth(r),
    dropMonth: (r) => dropOffMonth(r),
  };
  const breakdown = useMemo(() => {
    const g = groupTotals(scope, keyOf[dim]);
    const isMonth = dim === 'pickupMonth' || dim === 'dropMonth';
    return isMonth ? g.sort((a, b) => a.key.localeCompare(b.key)) : g.sort((a, b) => b.totals.outstanding - a.totals.outstanding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, dim]);
  const label = (k: string) => (dim === 'pickupMonth' || dim === 'dropMonth' ? monthLabel(k) : k);

  function drill(key: string) {
    const p = new URLSearchParams();
    if (dim === 'payer') p.set('payer', Object.entries(PAYER_LABEL).find(([, v]) => v === key)?.[0] ?? '');
    if (dim === 'insurer') p.set('insurer', key);
    if (dim === 'shop') p.set('shop', key);
    if (dim === 'pickupMonth') p.set('month', key);
    if (dim === 'dropMonth') p.set('dropMonth', key);
    if (!includeSubs) p.set('subs', '0');
    nav(`/balances?${p.toString()}`);
  }

  // Period comparison on the pickup date.
  const thisMonth = today.slice(0, 7);
  const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);
  const cmp = [
    { label: 'This month vs last month (pickup)', a: totalsWhere(scope, (r) => pickupMonth(r) === thisMonth), b: totalsWhere(scope, (r) => pickupMonth(r) === lastMonth), an: monthLabel(thisMonth), bn: monthLabel(lastMonth) },
    { label: 'Last 30 days vs previous 30 (pickup)', a: totalsWhere(scope, (r) => inRange(r, addDays(today, -29), today)), b: totalsWhere(scope, (r) => inRange(r, addDays(today, -59), addDays(today, -30))), an: 'Last 30', bn: 'Previous 30' },
  ];

  // Aging: one stacked bar, older buckets darker and redder.
  const agingTotals = rules.agingBuckets.map((b) => ({
    label: b.label,
    amount: scope.filter((r) => outstanding(r) > 0).filter((r) => { const d = daysOutstanding(r, today); return d && agingBucket(d.days, rules) === b.label; }).reduce((s, r) => s + outstanding(r), 0),
    count: scope.filter((r) => outstanding(r) > 0).filter((r) => { const d = daysOutstanding(r, today); return d && agingBucket(d.days, rules) === b.label; }).length,
  }));
  const agingSum = agingTotals.reduce((s, b) => s + b.amount, 0);
  const AGING_COLORS = ['var(--text-2)', 'var(--text-1)', 'var(--warn)', 'var(--danger)'];

  // Snapshots saved before tolls/tickets were excluded are left out of the money trend.
  const trend = (snapshots ?? []).filter((s) => s.rulesVersion !== null).slice().reverse().map((s) => ({ name: s.snapshotDate.slice(5), rate: s.billedTotal > 0 ? s.collectedTotal / s.billedTotal : 0, outstanding: s.outstandingTotal, atRisk: s.amountAtRisk }));

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Collections" subtitle="How much of what we billed has been collected. Every figure drills down to the Balances table." right={
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2"><input type="checkbox" checked={includeSubs} onChange={(e) => setIncludeSubs(e.target.checked)} /> Include after-rental charges (damage)</label>
      } />

      <div className="strip mb-5">
        <Kpi label="Total billed" value={money(totals.billed, { compact: true })} sub={`${totals.count} records since ${scope.length ? 'Dec 2025' : '—'}`} />
        <Kpi label="Collected" value={money(totals.collected, { compact: true })} tone="good" sub={`${pct(totals.rate)} collection rate`} />
        <Kpi label="Outstanding" value={money(totals.outstanding, { compact: true })} tone={totals.outstanding > 0 ? 'serious' : undefined} sub={`${totals.withBalance} rentals with a balance`} onClick={() => nav('/balances')} />
        <Kpi label="Collection rate" value={pct(totals.rate)} sub={<>renter {pct(renter.rate)}, company {pct(company.rate)}</>} />
        <Kpi label="Overdue at risk" value={money(atRisk, { compact: true })} tone={atRisk > 0 ? 'critical' : undefined} sub="due on overdue rentals" onClick={() => nav('/overdue')} />
        <Kpi label="Credits" value={money(totals.credits, { compact: true })} tone="good" sub="overpaid, shown separately" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <ShareCard title="Renter share" t={renter} />
        <ShareCard title="Company share (insurers + body shops)" t={company} />
        <Section title="Compare periods">
          <ul className="divide-y divide-border text-sm">
            {cmp.map((c) => (
              <li key={c.label} className="px-4 py-2">
                <div className="text-xs text-ink-3">{c.label}</div>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <Delta label="Billed" a={c.a.billed} b={c.b.billed} fmt={(v) => money(v, { compact: true })} />
                  <Delta label="Outstanding" a={c.a.outstanding} b={c.b.outstanding} fmt={(v) => money(v, { compact: true })} invert />
                  <Delta label="Rate" a={c.a.rate ?? 0} b={c.b.rate ?? 0} fmt={(v) => pct(v)} />
                </div>
                <div className="text-[11px] text-ink-3 mt-0.5">{c.an}: {c.a.count} rentals, {c.bn}: {c.b.count} rentals</div>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section
        title="Breakdown"
        className="mb-4"
        right={<div className="flex flex-wrap gap-2">
          <Tabs value={dim} onChange={setDim} items={[{ value: 'payer', label: 'Payer type' }, { value: 'insurer', label: 'Insurer' }, { value: 'shop', label: 'Body shop' }, { value: 'pickupMonth', label: 'Pickup month' }, { value: 'dropMonth', label: 'Drop-off month' }]} />
          <Tabs value={view} onChange={setView} items={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
        </div>}
      >
        {breakdown.length === 0 ? <div className="px-4 py-6 text-sm text-ink-3">No data</div> : view === 'table' ? (
          <table className="table">
            <thead><tr><th>{dimLabel(dim)}</th><th className="text-right">Rentals</th><th className="text-right">Billed</th><th className="text-right">Collected</th><th className="text-right">Outstanding</th><th className="text-right">Rate</th></tr></thead>
            <tbody>
              {breakdown.map((g) => (
                <tr key={g.key} className="cursor-pointer" onClick={() => drill(g.key)}>
                  <td>{label(g.key)}</td><td className="num text-right">{g.totals.count}</td><td className="num text-right">{money(g.totals.billed)}</td><td className="num text-right">{money(g.totals.collected)}</td><td className="num text-right font-medium">{money(g.totals.outstanding)}</td><td className="num text-right">{pct(g.totals.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-ink-2">Outstanding by {dimLabel(dim).toLowerCase()}</div>
              <BarList data={breakdown.map((g) => ({ name: label(g.key), key: g.key, value: g.totals.outstanding }))} valueKey="value" onClick={(row) => drill(String(row.key))} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-ink-2">Collection rate by {dimLabel(dim).toLowerCase()}</div>
              <RateBars data={breakdown.map((g) => ({ name: label(g.key), key: g.key, rate: g.totals.rate ?? 0 }))} onClick={(row) => drill(String(row.key))} />
            </div>
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Aging of outstanding">
          <div className="p-4">
            {agingSum <= 0 ? <div className="text-[13px] text-text2">Nothing outstanding</div> : (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded-[2px] bg-line" role="img" aria-label="Outstanding by age">
                  {agingTotals.map((b, i) => b.amount > 0 && (
                    <button key={b.label} title={`${b.label}: ${money(b.amount)} on ${b.count} rentals`} onClick={() => nav(`/balances?age=${encodeURIComponent(b.label)}`)} className="h-full border-r border-bg1 last:border-r-0 hover:opacity-80" style={{ width: `${(b.amount / agingSum) * 100}%`, background: AGING_COLORS[i] }} />
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  {agingTotals.map((b, i) => (
                    <button key={b.label} className="flex flex-col items-start text-left hover:text-text0" onClick={() => nav(`/balances?age=${encodeURIComponent(b.label)}`)}>
                      <span className="flex items-center gap-1.5 text-[11px] text-text2"><i className="inline-block h-2 w-2 rounded-[1px]" style={{ background: AGING_COLORS[i] }} />{b.label}</span>
                      <span className="num text-[15px] text-text0">{money(b.amount, { compact: true })}</span>
                      <span className="num text-[11px] text-text2">{b.count} rentals · {agingSum ? pct(b.amount / agingSum) : '-'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </Section>
        <Section title="Trend from daily snapshots">
          <div className="p-4">
            {snapshots === null ? <Spinner /> : trend.length < 2 ? (
              <div className="text-sm text-ink-3">History starts the day snapshots began ({snapshots[0]?.snapshotDate ?? 'no snapshot yet'}). The trend needs at least two days.</div>
            ) : (
              <>
                <div className="mb-1 text-xs font-medium text-ink-2">Collection rate</div>
                <TrendLines data={trend} series={[{ key: 'rate', label: 'Collection rate' }]} format={(v) => pct(v)} height={160} />
                <div className="mb-1 mt-3 text-xs font-medium text-ink-2">Outstanding and amount at risk</div>
                <TrendLines data={trend} series={[{ key: 'outstanding', label: 'Outstanding' }, { key: 'atRisk', label: 'Overdue at risk' }]} height={160} />
                <div className="mt-1 text-[11px] text-ink-3">Snapshots are saved on every TSD push and at 07:00; history starts {snapshots[snapshots.length - 1]?.snapshotDate}.</div>
              </>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function dimLabel(d: Dim): string {
  return { payer: 'Payer type', insurer: 'Insurer', shop: 'Body shop', pickupMonth: 'Pickup month', dropMonth: 'Drop-off month' }[d];
}

function totalsWhere(rs: Rental[], f: (r: Rental) => boolean): CollectionTotals {
  return collectionTotals(rs.filter(f));
}
function inRange(r: Rental, from: string, to: string): boolean {
  const d = (r.pickupDate ?? '').slice(0, 10);
  return !!d && d >= from && d <= to;
}

function ShareCard({ title, t }: { title: string; t: CollectionTotals }) {
  return (
    <Section title={title}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <div><div className="lbl">Billed</div><div className="num font-medium">{money(t.billed)}</div></div>
        <div><div className="lbl">Collected</div><div className="num font-medium text-good">{money(t.collected)}</div></div>
        <div><div className="lbl">Outstanding</div><div className="num font-medium text-serious">{money(t.outstanding)}</div></div>
        <div><div className="lbl">Rate</div><div className="num font-medium">{pct(t.rate)}</div></div>
      </div>
      <div className="mx-4 mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-good" style={{ width: `${Math.round((t.rate ?? 0) * 100)}%` }} /></div>
    </Section>
  );
}

function Delta({ label, a, b, fmt, invert }: { label: string; a: number; b: number; fmt: (v: number) => string; invert?: boolean }) {
  const diff = a - b;
  const good = invert ? diff < 0 : diff > 0;
  const tone = Math.abs(diff) < 0.0001 ? 'text-ink-3' : good ? 'text-good' : 'text-serious';
  return (
    <div>
      <div className="lbl">{label}</div>
      <div className="num font-medium">{fmt(a)}</div>
      <div className={`num text-xs ${tone}`}>{diff > 0 ? '▲' : diff < 0 ? '▼' : '•'} {fmt(Math.abs(diff))} vs {fmt(b)}</div>
    </div>
  );
}

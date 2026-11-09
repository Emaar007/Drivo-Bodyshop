import { useMemo, useState } from 'react';
import { CoverageMeter } from '../ui/Coverage';
import { coverageText } from '@shared/coverage';
import type { Rental } from '@shared/types';
import { PAYER_LABEL } from '@shared/config/rules';
import { classify, daysUntilDropOff, type RentalState } from '@shared/rules';
import { useStore } from '../store';
import { downloadText, formatDate, money } from '../format';
import { DataTable, rowsToCsv, useSort, type Column } from '../components/DataTable';
import { Chip, Kpi, Money, PageHeader, PayerChip, Phone, Spinner, Tabs } from '../components/ui';

type Filter = 'all' | 'overdue' | 'due_soon' | 'open_ended' | 'ok';

const STATE: Record<RentalState, { label: string; tone: 'neutral' | 'good' | 'warn' | 'serious' | 'critical' | 'accent' }> = {
  overdue: { label: 'Overdue', tone: 'critical' },
  due_today: { label: 'Due today', tone: 'serious' },
  due_soon: { label: 'Due soon', tone: 'warn' },
  open_ended: { label: 'No return date', tone: 'accent' },
  out: { label: 'On rent', tone: 'good' },
  returned: { label: 'Returned', tone: 'neutral' },
  after_rental: { label: 'After-rental', tone: 'neutral' },
};

export default function ActivePage() {
  const { loading, rentals, today, rules, openRental } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [shop, setShop] = useState('');
  const [loc, setLoc] = useState('');

  const out = useMemo(() => rentals.filter((r) => r.kind === 'rental' && r.isOut), [rentals]);
  const withState = useMemo(() => out.map((r) => ({ r, state: classify(r, today, rules) })), [out, today, rules]);
  const counts = {
    all: out.length,
    overdue: withState.filter((x) => x.state === 'overdue').length,
    due_soon: withState.filter((x) => x.state === 'due_soon' || x.state === 'due_today').length,
    open_ended: withState.filter((x) => x.state === 'open_ended').length,
    ok: withState.filter((x) => x.state === 'out').length,
  };
  const shops = useMemo(() => [...new Set(out.map((r) => r.bodyshop?.name).filter((x): x is string => !!x))].sort(), [out]);
  const locs = useMemo(() => [...new Set(out.map((r) => r.location))].sort(), [out]);

  const rows = useMemo(() => withState.filter(({ r, state }) => {
    if (filter === 'overdue' && state !== 'overdue') return false;
    if (filter === 'due_soon' && state !== 'due_soon' && state !== 'due_today') return false;
    if (filter === 'open_ended' && state !== 'open_ended') return false;
    if (filter === 'ok' && state !== 'out') return false;
    if (shop && r.bodyshop?.name !== shop) return false;
    if (loc && r.location !== loc) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![r.raNumber, r.renter.name, r.bodyshop?.name ?? '', r.insurer?.name ?? '', r.unitNumber ?? ''].some((v) => v.toLowerCase().includes(s))) return false;
    }
    return true;
  }).map((x) => x.r), [withState, filter, shop, loc, q]);

  const columns: Column<Rental>[] = useMemo(() => [
    { key: 'ra', label: 'R/A', value: (r) => r.raNumber, render: (r) => <span className="ra text-accent">{r.raNumber}</span> },
    { key: 'state', label: 'Status', value: (r) => STATE[classify(r, today, rules)].label, render: (r) => { const s = STATE[classify(r, today, rules)]; return <Chip tone={s.tone}>{s.label}</Chip>; } },
    { key: 'drop', label: 'Scheduled drop-off', value: (r) => r.scheduledDropOff, render: (r) => {
      const d = daysUntilDropOff(r, today);
      return <div>{r.scheduledDropOff ? formatDate(r.scheduledDropOff, { time: true }) : <span className="text-ink-3">not set</span>}{d !== null && <div className={`text-xs ${d < 0 ? 'text-critical font-medium' : d <= rules.dueSoonDays ? 'text-warn' : 'text-ink-3'}`}>{d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}</div>}</div>;
    } },
    { key: 'pickup', label: 'Picked up', value: (r) => r.pickupDate, render: (r) => formatDate(r.pickupDate, { time: true }) },
    { key: 'days', label: 'Days out', value: (r) => r.rentalDays, align: 'right' },
    { key: 'payer', label: 'Payer', value: (r) => PAYER_LABEL[r.payerType], render: (r) => <PayerChip payer={r.payerType} /> },
    { key: 'coverage', label: 'Coverage', value: (r) => (r.coverage.applies ? coverageText(r.coverage) : ''), render: (r) => (r.coverage.applies ? <CoverageMeter coverage={r.coverage} compact /> : <span className="text-text2">-</span>) },
    { key: 'renter', label: 'Renter', value: (r) => r.renter.name, render: (r) => <div>{r.renter.name}<div className="text-xs"><Phone phone={r.renter.phone} /></div></div> },
    { key: 'shop', label: 'Body shop', value: (r) => r.bodyshop?.name ?? '', render: (r) => <div>{r.bodyshop?.name ?? <span className="text-ink-3">—</span>}<div className="text-xs"><Phone phone={r.bodyshop?.phone} /></div></div> },
    { key: 'insurer', label: 'Insurer', value: (r) => r.insurer?.name ?? '' },
    { key: 'unit', label: 'Unit', value: (r) => r.unitNumber, render: (r) => <span className="num">{r.unitNumber ?? '—'}{r.vehicleClass ? <span className="text-ink-3"> {r.vehicleClass}</span> : null}</span> },
    { key: 'loc', label: 'Loc', value: (r) => r.location },
    { key: 'rate', label: 'Rate', value: (r) => r.dailyRate, align: 'right', render: (r) => (r.dailyRate ? `${money(r.dailyRate)}/d` : '—') },
    { key: 'ext', label: 'Ext.', value: (r) => r.extensions.length, align: 'right' },
    { key: 'paid', label: 'Paid', value: (r) => r.money.totalPaid, align: 'right', render: (r) => money(r.money.totalPaid) },
    { key: 'due', label: 'Due (est.)', value: (r) => r.money.totalAmountDue, align: 'right', bar: true, render: (r) => <Money value={r.money.totalAmountDue} estimated={r.money.estimated} /> },
  ], [today, rules]);

  const { sorted, sort, toggle } = useSort(rows, columns, { key: 'drop', dir: 'asc' });

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Active rentals"
        subtitle={`Every body shop rental currently out (not returned in TSD), ${today}`}
        right={<button className="btn btn-sm" onClick={() => downloadText(`active_rentals_${today}.csv`, rowsToCsv(sorted, columns))}>Export CSV</button>}
      />
      <div className="strip mb-5">
        <Kpi label="On rent" value={counts.all} onClick={() => setFilter('all')} />
        <Kpi label="Overdue" value={counts.overdue} tone={counts.overdue ? 'critical' : undefined} onClick={() => setFilter('overdue')} />
        <Kpi label="Due in 0-3 days" value={counts.due_soon} tone={counts.due_soon ? 'warn' : undefined} onClick={() => setFilter('due_soon')} />
        <Kpi label="No return date" value={counts.open_ended} tone={counts.open_ended ? 'serious' : undefined} onClick={() => setFilter('open_ended')} />
        <Kpi label="Est. amount due" value={money(rows.reduce((s, r) => s + Math.max(r.money.totalAmountDue, 0), 0), { compact: true })} sub="on the filtered rentals" />
      </div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Tabs value={filter} onChange={setFilter} items={[
          { value: 'all', label: 'All', count: counts.all },
          { value: 'overdue', label: 'Overdue', count: counts.overdue },
          { value: 'due_soon', label: 'Due soon', count: counts.due_soon },
          { value: 'open_ended', label: 'No date', count: counts.open_ended },
          { value: 'ok', label: 'On schedule', count: counts.ok },
        ]} />
        <input className="input w-56" placeholder="Search R/A, renter, shop, unit" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={shop} onChange={(e) => setShop(e.target.value)}><option value="">All body shops</option>{shops.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="select" value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">All locations</option>{locs.map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <div className="sheet">
        <DataTable rows={sorted} columns={columns} rowKey={(r) => r.raNumber} onRowClick={(r) => openRental(r.raNumber)} sort={sort} onSort={toggle} empty="No rentals out" />
      </div>
    </div>
  );
}

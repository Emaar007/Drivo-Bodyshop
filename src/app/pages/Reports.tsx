import { useEffect, useMemo, useState } from 'react';
import type { Rental, Snapshot, Task } from '@shared/types';
import { PAYER_LABEL, TASK_REASON_LABEL } from '@shared/config/rules';
import { addDays, dateOf } from '@shared/dates';
import { agingBucket, classify, daysOutstanding, daysOverdue, groupTotals, outstanding } from '@shared/rules';
import { useStore } from '../store';
import { api } from '../api';
import { downloadText, formatDate, money, nameFromEmail, pct } from '../format';
import { DataTable, rowsToCsv, useSort, type Column } from '../components/DataTable';
import { Field, PageHeader, Section, Spinner, Tabs } from '../components/ui';

type Preset = 'overdue' | 'aging' | 'byPayer' | 'byShop' | 'byInsurer' | 'activity' | 'daily' | 'history';
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'overdue', label: 'Overdue rentals' },
  { value: 'aging', label: 'Outstanding (aging)' },
  { value: 'byPayer', label: 'Collections by payer' },
  { value: 'byShop', label: 'Collections by body shop' },
  { value: 'byInsurer', label: 'Collections by insurer' },
  { value: 'activity', label: 'Task activity' },
  { value: 'daily', label: 'Returned / extended per day' },
  { value: 'history', label: 'History (snapshots)' },
];

export default function ReportsPage() {
  const { loading, rentals, today, rules, openRental } = useStore();
  const [preset, setPreset] = useState<Preset>('overdue');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [payer, setPayer] = useState('');
  const [insurer, setInsurer] = useState('');
  const [shop, setShop] = useState('');
  const [user, setUser] = useState('');
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);

  useEffect(() => { setTo(today); }, [today]);
  useEffect(() => {
    if (preset === 'activity') api.tasksRange(from, to).then(setTasks);
    if (preset === 'history') api.history().then(setSnapshots);
  }, [preset, from, to]);

  const insurers = useMemo(() => [...new Set(rentals.map((r) => r.insurer?.name).filter((x): x is string => !!x))].sort(), [rentals]);
  const shops = useMemo(() => [...new Set(rentals.map((r) => r.bodyshop?.name).filter((x): x is string => !!x))].sort(), [rentals]);

  // Filtered rentals: date range on pickup for collections, on "as of today" for overdue/aging.
  const filtered = useMemo(() => rentals.filter((r) => {
    if (payer && r.payerType !== payer) return false;
    if (insurer && r.insurer?.name !== insurer) return false;
    if (shop && r.bodyshop?.name !== shop) return false;
    return true;
  }), [rentals, payer, insurer, shop]);
  const inPeriod = useMemo(() => filtered.filter((r) => { const d = dateOf(r.pickupDate); return !!d && d >= from && d <= to; }), [filtered, from, to]);

  const title = PRESETS.find((p) => p.value === preset)!.label;
  const fileBase = `${preset}_${from}_${to}`;

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Reports" subtitle={`${title}, ${formatDate(from)} – ${formatDate(to)}`} right={<button className="btn btn-sm" onClick={() => window.print()}>Print / PDF</button>} />
      <div className="no-print mb-3 flex flex-wrap gap-2"><Tabs value={preset} onChange={setPreset} items={PRESETS} /></div>
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Payer"><select className="select" value={payer} onChange={(e) => setPayer(e.target.value)}><option value="">All</option>{Object.entries(PAYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Insurer"><select className="select" value={insurer} onChange={(e) => setInsurer(e.target.value)}><option value="">All</option>{insurers.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Body shop"><select className="select" value={shop} onChange={(e) => setShop(e.target.value)}><option value="">All</option>{shops.map((s) => <option key={s}>{s}</option>)}</select></Field>
        {preset === 'activity' && <Field label="User"><input className="input" placeholder="email contains…" value={user} onChange={(e) => setUser(e.target.value)} /></Field>}
      </div>

      {preset === 'overdue' && <OverdueReport rows={filtered.filter((r) => r.kind === 'rental' && classify(r, today, rules) === 'overdue')} today={today} file={fileBase} open={openRental} />}
      {preset === 'aging' && <AgingReport rows={filtered.filter((r) => outstanding(r) > 0)} today={today} rules={rules} file={fileBase} open={openRental} />}
      {(preset === 'byPayer' || preset === 'byShop' || preset === 'byInsurer') && (
        <GroupReport
          rows={inPeriod}
          keyOf={preset === 'byPayer' ? (r) => PAYER_LABEL[r.payerType] : preset === 'byShop' ? (r) => r.bodyshop?.name ?? '(no body shop)' : (r) => r.insurer?.name ?? '(no insurer)'}
          label={preset === 'byPayer' ? 'Payer' : preset === 'byShop' ? 'Body shop' : 'Insurer'}
          file={fileBase}
          note="Rentals picked up in the period."
        />
      )}
      {preset === 'activity' && (tasks === null ? <Spinner /> : <ActivityReport tasks={tasks.filter((t) => !user || (t.completedBy ?? t.assignedTo ?? t.startedBy ?? '').includes(user))} file={fileBase} />)}
      {preset === 'daily' && <DailyReport rentals={filtered} from={from} to={to} file={fileBase} />}
      {preset === 'history' && (snapshots === null ? <Spinner /> : <HistoryReport snapshots={snapshots.filter((s) => s.snapshotDate >= from && s.snapshotDate <= to)} file={fileBase} />)}
    </div>
  );
}

function Export({ file, text }: { file: string; text: () => string }) {
  return <button className="btn btn-sm no-print" onClick={() => downloadText(`${file}.csv`, text())}>Export CSV</button>;
}

function OverdueReport({ rows, today, file, open }: { rows: Rental[]; today: string; file: string; open: (ra: string) => void }) {
  const columns: Column<Rental>[] = [
    { key: 'ra', label: 'R/A', value: (r) => r.raNumber },
    { key: 'days', label: 'Days overdue', value: (r) => daysOverdue(r, today), align: 'right' },
    { key: 'drop', label: 'Scheduled drop-off', value: (r) => formatDate(r.scheduledDropOff) },
    { key: 'payer', label: 'Payer', value: (r) => PAYER_LABEL[r.payerType] },
    { key: 'renter', label: 'Renter', value: (r) => r.renter.name },
    { key: 'phone', label: 'Phone', value: (r) => r.renter.phone },
    { key: 'shop', label: 'Body shop', value: (r) => r.bodyshop?.name ?? '' },
    { key: 'insurer', label: 'Insurer', value: (r) => r.insurer?.name ?? '' },
    { key: 'due', label: 'Amount due', value: (r) => r.money.totalAmountDue, align: 'right', render: (r) => money(r.money.totalAmountDue) + (r.money.estimated ? ' est' : '') },
  ];
  const { sorted, sort, toggle } = useSort(rows, columns, { key: 'days', dir: 'desc' });
  return (
    <Section title={`${rows.length} overdue, ${money(rows.reduce((s, r) => s + outstanding(r), 0))} due`} right={<Export file={file} text={() => rowsToCsv(sorted, columns)} />}>
      <DataTable rows={sorted} columns={columns} rowKey={(r) => r.raNumber} sort={sort} onSort={toggle} onRowClick={(r) => open(r.raNumber)} empty="No overdue rentals" />
    </Section>
  );
}

function AgingReport({ rows, today, rules, file, open }: { rows: Rental[]; today: string; rules: { agingBuckets: { label: string; maxDays: number | null }[] }; file: string; open: (ra: string) => void }) {
  const buckets = rules.agingBuckets.map((b) => ({ label: b.label, rows: rows.filter((r) => { const d = daysOutstanding(r, today); return d && agingBucket(d.days, rules as never) === b.label; }) }));
  const columns: Column<Rental>[] = [
    { key: 'ra', label: 'R/A', value: (r) => r.raNumber },
    { key: 'status', label: 'Status', value: (r) => (r.isOut ? 'out' : 'returned') },
    { key: 'days', label: 'Days outstanding', value: (r) => daysOutstanding(r, today)?.days ?? null, align: 'right' },
    { key: 'bucket', label: 'Bucket', value: (r) => { const d = daysOutstanding(r, today); return d ? agingBucket(d.days, rules as never) : ''; } },
    { key: 'payer', label: 'Payer', value: (r) => PAYER_LABEL[r.payerType] },
    { key: 'renter', label: 'Renter', value: (r) => r.renter.name },
    { key: 'shop', label: 'Body shop', value: (r) => r.bodyshop?.name ?? '' },
    { key: 'insurer', label: 'Insurer', value: (r) => r.insurer?.name ?? '' },
    { key: 'renterDue', label: 'Renter due', value: (r) => r.money.renterAmountDue, align: 'right', render: (r) => money(r.money.renterAmountDue) },
    { key: 'companyDue', label: 'Company due', value: (r) => r.money.companyAmountDue, align: 'right', render: (r) => money(r.money.companyAmountDue) },
    { key: 'due', label: 'Amount due', value: (r) => r.money.totalAmountDue, align: 'right', render: (r) => money(r.money.totalAmountDue) },
  ];
  const { sorted, sort, toggle } = useSort(rows, columns, { key: 'days', dir: 'desc' });
  return (
    <>
      <div className="strip mb-5">
        {buckets.map((b) => <div key={b.label} className="sheet px-4 py-3"><div className="lbl">{b.label}</div><div className="num text-xl font-semibold">{money(b.rows.reduce((s, r) => s + outstanding(r), 0), { compact: true })}</div><div className="text-xs text-ink-2">{b.rows.length} rentals</div></div>)}
      </div>
      <Section title={`${rows.length} rentals with a balance, ${money(rows.reduce((s, r) => s + outstanding(r), 0))}`} right={<Export file={file} text={() => rowsToCsv(sorted, columns)} />}>
        <DataTable rows={sorted} columns={columns} rowKey={(r) => r.raNumber} sort={sort} onSort={toggle} onRowClick={(r) => open(r.raNumber)} />
      </Section>
    </>
  );
}

function GroupReport({ rows, keyOf, label, file, note }: { rows: Rental[]; keyOf: (r: Rental) => string; label: string; file: string; note: string }) {
  const groups = groupTotals(rows, keyOf).sort((a, b) => b.totals.billed - a.totals.billed);
  type G = (typeof groups)[number];
  const columns: Column<G>[] = [
    { key: 'key', label, value: (g) => g.key },
    { key: 'count', label: 'Rentals', value: (g) => g.totals.count, align: 'right' },
    { key: 'billed', label: 'Billed', value: (g) => g.totals.billed, align: 'right', render: (g) => money(g.totals.billed) },
    { key: 'collected', label: 'Collected', value: (g) => g.totals.collected, align: 'right', render: (g) => money(g.totals.collected) },
    { key: 'outstanding', label: 'Outstanding', value: (g) => g.totals.outstanding, align: 'right', render: (g) => money(g.totals.outstanding) },
    { key: 'credits', label: 'Credits', value: (g) => g.totals.credits, align: 'right', render: (g) => money(g.totals.credits) },
    { key: 'rate', label: 'Rate', value: (g) => g.totals.rate, align: 'right', render: (g) => pct(g.totals.rate) },
  ];
  const { sorted, sort, toggle } = useSort(groups, columns, { key: 'billed', dir: 'desc' });
  const all = groupTotals(rows, () => 'all')[0]?.totals;
  return (
    <Section title={`${rows.length} rentals, billed ${money(all?.billed ?? 0)}, collected ${pct(all?.rate)}`} right={<Export file={file} text={() => rowsToCsv(sorted, columns)} />}>
      <div className="px-4 pt-2 text-xs text-ink-3">{note}</div>
      <DataTable rows={sorted} columns={columns} rowKey={(g) => g.key} sort={sort} onSort={toggle} empty="No rentals in the period" />
    </Section>
  );
}

function ActivityReport({ tasks, file }: { tasks: Task[]; file: string }) {
  const byUserDay = new Map<string, { user: string; day: string; completed: number; inProgress: number; notStarted: number; snoozed: number }>();
  for (const t of tasks) {
    const user = t.completedBy ?? t.assignedTo ?? t.startedBy ?? '(unassigned)';
    const k = `${user}|${t.taskDate}`;
    const row = byUserDay.get(k) ?? { user, day: t.taskDate, completed: 0, inProgress: 0, notStarted: 0, snoozed: 0 };
    if (t.status === 'completed') row.completed++;
    else if (t.status === 'in_progress') row.inProgress++;
    else if (t.status === 'snoozed') row.snoozed++;
    else row.notStarted++;
    byUserDay.set(k, row);
  }
  const rows = [...byUserDay.values()];
  type R = (typeof rows)[number];
  const columns: Column<R>[] = [
    { key: 'day', label: 'Day', value: (r) => r.day },
    { key: 'user', label: 'User', value: (r) => r.user, render: (r) => nameFromEmail(r.user) },
    { key: 'completed', label: 'Completed', value: (r) => r.completed, align: 'right' },
    { key: 'inProgress', label: 'In progress', value: (r) => r.inProgress, align: 'right' },
    { key: 'notStarted', label: 'Not started', value: (r) => r.notStarted, align: 'right' },
    { key: 'snoozed', label: 'Snoozed', value: (r) => r.snoozed, align: 'right' },
  ];
  const { sorted, sort, toggle } = useSort(rows, columns, { key: 'day', dir: 'desc' });
  const detail: Column<Task>[] = [
    { key: 'day', label: 'Day', value: (t) => t.taskDate },
    { key: 'ra', label: 'R/A', value: (t) => t.raNumber },
    { key: 'reason', label: 'Task', value: (t) => TASK_REASON_LABEL[t.reason] },
    { key: 'status', label: 'Status', value: (t) => t.status },
    { key: 'user', label: 'User', value: (t) => nameFromEmail(t.completedBy ?? t.assignedTo ?? t.startedBy) },
    { key: 'outcome', label: 'Outcome', value: (t) => [t.outcome, t.outcomeDate ? formatDate(t.outcomeDate) : null, t.outcomeNote].filter(Boolean).join(' ') },
    { key: 'completedAt', label: 'Completed at', value: (t) => t.completedAt ?? '' },
  ];
  return (
    <>
      <Section title={`Tasks per user and day (${tasks.length} tasks)`} className="mb-4" right={<Export file={file} text={() => rowsToCsv(sorted, columns)} />}>
        <DataTable rows={sorted} columns={columns} rowKey={(r) => `${r.user}|${r.day}`} sort={sort} onSort={toggle} empty="No tasks in the period" />
      </Section>
      <Section title="Task detail" right={<Export file={`${file}_detail`} text={() => rowsToCsv(tasks, detail)} />}>
        <DataTable rows={tasks} columns={detail} rowKey={(t) => String(t.id)} maxHeight="50vh" />
      </Section>
    </>
  );
}

function DailyReport({ rentals, from, to, file }: { rentals: Rental[]; from: string; to: string; file: string }) {
  const days = new Map<string, { day: string; returned: number; extended: number; pickedUp: number }>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { day: d, returned: 0, extended: 0, pickedUp: 0 });
  for (const r of rentals.filter((x) => x.kind === 'rental')) {
    const ret = dateOf(r.actualReturn);
    if (ret && days.has(ret)) days.get(ret)!.returned++;
    const pu = dateOf(r.pickupDate);
    if (pu && days.has(pu)) days.get(pu)!.pickedUp++;
    for (const e of r.extensions) { const d = dateOf(e.at); if (d && days.has(d)) days.get(d)!.extended++; }
  }
  const rows = [...days.values()].reverse();
  type R = (typeof rows)[number];
  const columns: Column<R>[] = [
    { key: 'day', label: 'Day', value: (r) => r.day, render: (r) => formatDate(r.day) },
    { key: 'pickedUp', label: 'Picked up', value: (r) => r.pickedUp, align: 'right' },
    { key: 'returned', label: 'Returned', value: (r) => r.returned, align: 'right' },
    { key: 'extended', label: 'Extensions (TSD log)', value: (r) => r.extended, align: 'right' },
  ];
  return (
    <Section title={`Per day, ${rows.reduce((s, r) => s + r.returned, 0)} returned, ${rows.reduce((s, r) => s + r.extended, 0)} extensions`} right={<Export file={file} text={() => rowsToCsv(rows, columns)} />}>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.day} maxHeight="60vh" />
    </Section>
  );
}

function HistoryReport({ snapshots, file }: { snapshots: Snapshot[]; file: string }) {
  const rows = snapshots.map((s, i) => {
    const prev = snapshots[i + 1];
    const newOverdue = prev ? s.overdueRaNumbers.filter((x) => !prev.overdueRaNumbers.includes(x)) : [];
    const cleared = prev ? prev.overdueRaNumbers.filter((x) => !s.overdueRaNumbers.includes(x)) : [];
    const returned = prev ? prev.outRaNumbers.filter((x) => !s.outRaNumbers.includes(x)) : [];
    return { ...s, newOverdue, cleared, returned };
  });
  type R = (typeof rows)[number];
  const columns: Column<R>[] = [
    { key: 'date', label: 'Date', value: (r) => r.snapshotDate, render: (r) => <span>{r.snapshotDate}{r.rulesVersion === null && <span className="chip chip-warn ml-2" title="Saved before tolls and tickets were excluded: money figures include them">before fix</span>}</span> },
    { key: 'out', label: 'Out', value: (r) => r.outCount, align: 'right' },
    { key: 'overdue', label: 'Overdue', value: (r) => r.overdueCount, align: 'right' },
    { key: 'overdueCustomer', label: 'of which customer', value: (r) => r.overdueCustomer, align: 'right' },
    { key: 'dueSoon', label: 'Due soon', value: (r) => r.dueSoonCount, align: 'right' },
    { key: 'openEnded', label: 'No date', value: (r) => r.openEndedCount, align: 'right' },
    { key: 'atRisk', label: 'At risk', value: (r) => r.amountAtRisk, align: 'right', render: (r) => money(r.amountAtRisk) },
    { key: 'outstanding', label: 'Outstanding', value: (r) => r.outstandingTotal, align: 'right', render: (r) => money(r.outstandingTotal) },
    { key: 'rate', label: 'Collection rate', value: (r) => (r.billedTotal ? r.collectedTotal / r.billedTotal : null), align: 'right', render: (r) => pct(r.billedTotal ? r.collectedTotal / r.billedTotal : null) },
    { key: 'newOverdue', label: 'New overdue', value: (r) => r.newOverdue.join(' '), render: (r) => r.newOverdue.length ? <span className="ra text-xs text-serious">{r.newOverdue.join(', ')}</span> : '—' },
    { key: 'cleared', label: 'Extended / cleared', value: (r) => r.cleared.join(' '), render: (r) => r.cleared.length ? <span className="ra text-xs text-good">{r.cleared.join(', ')}</span> : '—' },
    { key: 'returned', label: 'Returned', value: (r) => r.returned.join(' '), render: (r) => r.returned.length ? <span className="ra text-xs">{r.returned.join(', ')}</span> : '—' },
  ];
  return (
    <Section title={`Daily snapshots (${rows.length})`} right={<Export file={file} text={() => rowsToCsv(rows, columns)} />}>
      <div className="px-4 pt-2 text-xs text-ink-3">One row per New York date; "what changed" compares each day with the previous snapshot. History starts the day snapshots began. Rows marked "before fix" were saved before tolls and tickets were excluded, so their money figures still include them.</div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.snapshotDate} empty="No snapshots yet: the first one is saved on the next TSD push or at 07:00." />
    </Section>
  );
}

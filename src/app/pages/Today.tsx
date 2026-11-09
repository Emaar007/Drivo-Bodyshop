import { useEffect, useMemo, useState } from 'react';
import type { Snapshot, Task, TaskReason } from '@shared/types';
import { TASK_REASON_HINT, TASK_REASON_LABEL, PAYER_LABEL } from '@shared/config/rules';
import { amountAtRisk, classify, outstanding } from '@shared/rules';
import { useStore } from '../store';
import { api } from '../api';
import { money } from '../format';
import TaskRow from '../ui/TaskRow';
import Runway from '../ui/Runway';
import { EmptyState, FilterSelect, Sparkline, Switch, Tabs } from '../ui/primitives';
import { Spinner, Toast, useToast } from '../components/ui';

type StatusTab = 'all' | 'in_progress' | 'completed' | 'snoozed';

export default function TodayPage() {
  const { loading, tasks, byRa, rentals, today, rules, me } = useStore();
  const [tab, setTab] = useState<StatusTab>('all');
  const [payer, setPayer] = useState('');
  const [shop, setShop] = useState('');
  const [reason, setReason] = useState('');
  const [mine, setMine] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [toast, showToast] = useToast();

  useEffect(() => { api.history().then(setHistory).catch(() => setHistory([])); }, []);

  const todays = useMemo(() => tasks.filter((t) => t.taskDate === today), [tasks, today]);
  const out = useMemo(() => rentals.filter((r) => r.kind === 'rental' && r.isOut), [rentals]);
  const states = useMemo(() => out.map((r) => classify(r, today, rules)), [out, today, rules]);
  const overdue = states.filter((s) => s === 'overdue').length;
  const dueSoon = states.filter((s) => s === 'due_soon' || s === 'due_today').length;
  const later = out.length - overdue - dueSoon;
  const atRisk = amountAtRisk(rentals, today, rules);
  const toCall = overdue + dueSoon;
  const openTasks = todays.filter((t) => t.status === 'not_started' || t.status === 'in_progress').length;

  // 14-day sparklines from the daily snapshots (oldest first).
  const series = useMemo(() => {
    const s = [...history].filter((x) => x.rulesVersion !== null).sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate)).slice(-14);
    return { overdue: s.map((x) => x.overdueCount), atRisk: s.map((x) => x.amountAtRisk), dueSoon: s.map((x) => x.dueSoonCount), out: s.map((x) => x.outCount) };
  }, [history]);

  const shops = useMemo(() => [...new Set(todays.map((t) => byRa.get(t.raNumber)?.bodyshop?.name).filter((x): x is string => !!x))].sort(), [todays, byRa]);

  const filtered = useMemo(() => todays.filter((t) => {
    if (tab === 'all' && t.status === 'snoozed') return false;
    if (tab === 'in_progress' && t.status !== 'in_progress') return false;
    if (tab === 'completed' && t.status !== 'completed') return false;
    if (tab === 'snoozed' && t.status !== 'snoozed') return false;
    const r = byRa.get(t.raNumber);
    if (payer && r?.payerType !== payer) return false;
    if (shop && r?.bodyshop?.name !== shop) return false;
    if (reason && t.reason !== reason) return false;
    if (mine && t.assignedTo !== me?.email) return false;
    return true;
  }), [todays, tab, payer, shop, reason, mine, byRa, me]);

  const groups = useMemo(() => {
    const open = filtered.filter((t) => t.status !== 'completed');
    const m = new Map<TaskReason, Task[]>();
    for (const t of open) (m.get(t.reason) ?? m.set(t.reason, []).get(t.reason)!).push(t);
    const order: TaskReason[] = [...rules.priorityOrder, 'manual'];
    return order.filter((r) => m.has(r)).map((r) => ({ reason: r, tasks: (m.get(r) ?? []).sort(byUrgency(byRa)) }));
  }, [filtered, rules.priorityOrder, byRa]);
  const completed = useMemo(() => filtered.filter((t) => t.status === 'completed'), [filtered]);

  const counts = {
    all: todays.filter((t) => t.status !== 'snoozed').length,
    in_progress: todays.filter((t) => t.status === 'in_progress').length,
    completed: todays.filter((t) => t.status === 'completed').length,
    snoozed: todays.filter((t) => t.status === 'snoozed').length,
  };

  function pick(ra: string) {
    setHighlight(ra);
    const el = document.getElementById(`task-${ra}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else showToast(`${ra} has no task today`);
    setTimeout(() => setHighlight(null), 2500);
  }

  if (loading) return <Spinner />;

  return (
    <div className="page-in flex flex-col gap-4">
      {/* A. Status header */}
      <section className="grid gap-6 lg:grid-cols-[minmax(240px,1fr)_2fr]">
        <div className="flex flex-col justify-end">
          {toCall === 0 ? (
            <div className="display text-[56px] leading-none text-ok">All clear</div>
          ) : (
            <div className="display num text-[56px] leading-none text-text0">{toCall}</div>
          )}
          <div className="lbl mt-2">{toCall === 0 ? `${out.length} cars out, none due` : 'Cars to call today'}</div>
          <div className="mt-3 flex h-px w-full max-w-xs overflow-hidden bg-line" aria-hidden="true">
            {out.length > 0 && <>
              <span className="h-full bg-danger" style={{ width: `${(overdue / out.length) * 100}%` }} />
              <span className="h-full bg-warn" style={{ width: `${(dueSoon / out.length) * 100}%` }} />
              <span className="h-full bg-text2" style={{ width: `${(later / out.length) * 100}%` }} />
            </>}
          </div>
          <div className="num mt-1.5 text-[11px] text-text2">{overdue} overdue · {dueSoon} due soon · {later} later</div>
        </div>
        <div className="strip grid-cols-2 lg:grid-cols-4">
          <Cell label="Overdue" value={overdue} tone={overdue > 0 ? 'danger' : undefined} spark={series.overdue} sparkTone={overdue > 0 ? 'danger' : 'muted'} />
          <Cell label="Amount at risk" value={money(atRisk, { compact: true })} tone={atRisk > 0 ? 'danger' : undefined} spark={series.atRisk} sparkTone={atRisk > 0 ? 'danger' : 'muted'} />
          <Cell label={`Due in ${rules.dueSoonDays} days`} value={dueSoon} spark={series.dueSoon} />
          <Cell label="Open tasks" value={openTasks} spark={series.out} foot={`${counts.completed} done · ${money(rentals.reduce((s, r) => s + outstanding(r), 0), { compact: true })} outstanding`} />
        </div>
      </section>

      {/* B. Runway */}
      <Runway rentals={rentals} onPick={pick} />

      {/* C. Filter bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'all', label: 'To do', count: counts.all },
          { value: 'in_progress', label: 'In progress', count: counts.in_progress },
          { value: 'completed', label: 'Done', count: counts.completed },
          { value: 'snoozed', label: 'Snoozed', count: counts.snoozed },
        ]} />
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect value={reason} onChange={setReason} allLabel="All priorities" options={[...rules.priorityOrder, 'manual' as TaskReason].map((r) => ({ value: r, label: TASK_REASON_LABEL[r] }))} />
          <FilterSelect value={payer} onChange={setPayer} allLabel="All payers" options={Object.entries(PAYER_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          <FilterSelect value={shop} onChange={setShop} allLabel="All body shops" options={shops.map((s) => ({ value: s, label: s }))} />
          <Switch checked={mine} onChange={setMine} label="Only mine" />
        </div>
      </div>

      {/* D. Ledger */}
      {groups.length === 0 && completed.length === 0 ? (
        <div className="panel">
          <EmptyState
            title={todays.length === 0 ? 'Nothing needs a call today' : 'No tasks match these filters'}
            hint={todays.length === 0 ? 'Tasks appear when a rental is overdue, due soon, has no return date, or has data to fix. Rebuilt from TSD every hour and at 07:00.' : undefined}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.reason}>
              <header className="sticky top-12 z-[5] flex items-baseline gap-3 bg-bg0 py-1.5">
                <h2 className="section-title">{TASK_REASON_LABEL[g.reason]}</h2>
                <span className="num text-[12px] text-text2">{g.tasks.length}</span>
                <span className="hidden text-[12px] text-text2 sm:inline">{TASK_REASON_HINT[g.reason].split('.')[0]}</span>
              </header>
              <div className="ledger">
                {g.tasks.map((t) => <TaskRow key={t.id} task={t} rental={byRa.get(t.raNumber)} highlighted={highlight === t.raNumber} onToast={showToast} />)}
              </div>
            </section>
          ))}
          {completed.length > 0 && (
            <section>
              <header className="flex items-baseline gap-3 py-1.5">
                <h2 className="section-title">Completed</h2>
                <span className="num text-[12px] text-text2">{completed.length}</span>
              </header>
              <div className="ledger">
                {completed.map((t) => <TaskRow key={t.id} task={t} rental={byRa.get(t.raNumber)} highlighted={highlight === t.raNumber} onToast={showToast} />)}
              </div>
            </section>
          )}
        </div>
      )}
      <Toast message={toast} />
    </div>
  );
}

function Cell({ label, value, tone, spark, sparkTone = 'muted', foot }: { label: string; value: number | string; tone?: 'danger' | 'warn'; spark: number[]; sparkTone?: 'muted' | 'danger' | 'ok'; foot?: string }) {
  return (
    <div className="flex flex-col gap-1 py-1">
      <span className="lbl">{label}</span>
      <span className={`num text-[32px] leading-none ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-text0'}`}>{value}</span>
      <span className="flex h-5 items-center gap-2 text-[11px] text-text2">
        {spark.length >= 2 ? <Sparkline values={spark} tone={sparkTone} /> : !foot ? <span>14-day trend from tomorrow</span> : null}
        {foot && <span className="num truncate">{foot}</span>}
      </span>
    </div>
  );
}

function byUrgency(byRa: Map<string, { money: { totalAmountDue: number }; scheduledDropOff: string | null }>) {
  return (a: Task, b: Task) => {
    const ra = byRa.get(a.raNumber);
    const rb = byRa.get(b.raNumber);
    const da = ra?.scheduledDropOff ?? '9999';
    const db = rb?.scheduledDropOff ?? '9999';
    if (da !== db) return da < db ? -1 : 1;
    return (rb?.money.totalAmountDue ?? 0) - (ra?.money.totalAmountDue ?? 0);
  };
}

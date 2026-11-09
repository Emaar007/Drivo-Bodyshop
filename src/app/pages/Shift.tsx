import { useEffect, useMemo, useState } from 'react';
import type { Task, TaskEvent } from '@shared/types';
import { TASK_REASON_LABEL } from '@shared/config/rules';
import { addDays } from '@shared/dates';
import { useStore } from '../store';
import { api } from '../api';
import { formatDate, formatIso, money, nameFromEmail } from '../format';
import { Chip, Field, PageHeader, Section, Spinner, useToast, Toast } from '../components/ui';
import { STATUS_LABEL, statusTone } from '../components/TaskCard';

export default function ShiftPage() {
  const { today, byRa, rules, openRental, me } = useStore();
  const [date, setDate] = useState(today);
  const [user, setUser] = useState('');
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [toast, showToast] = useToast();

  useEffect(() => { setDate(today); }, [today]);

  useEffect(() => {
    let alive = true;
    setTasks(null);
    const from = new Date(`${date}T00:00:00`).toISOString();
    const to = new Date(`${addDays(date, 1)}T00:00:00`).toISOString();
    Promise.all([api.tasks(date), api.events(from, to)]).then(([t, e]) => { if (alive) { setTasks(t); setEvents(e); } });
    return () => { alive = false; };
  }, [date]);

  const users = useMemo(() => [...new Set([...(tasks ?? []).flatMap((t) => [t.assignedTo, t.completedBy, t.startedBy]), ...(events ?? []).map((e) => e.by)].filter((x): x is string => !!x))].sort(), [tasks, events]);

  const visible = useMemo(() => (tasks ?? []).filter((t) => !user || t.assignedTo === user || t.completedBy === user || t.startedBy === user), [tasks, user]);
  const groups: { key: Task['status']; label: string; tasks: Task[] }[] = [
    { key: 'completed', label: 'Completed', tasks: visible.filter((t) => t.status === 'completed') },
    { key: 'in_progress', label: 'In progress', tasks: visible.filter((t) => t.status === 'in_progress') },
    { key: 'not_started', label: 'Not started', tasks: visible.filter((t) => t.status === 'not_started') },
    { key: 'snoozed', label: 'Snoozed', tasks: visible.filter((t) => t.status === 'snoozed') },
  ];

  function summaryText(): string {
    const lines: string[] = [`Bodyshop rentals – shift summary ${formatDate(date)}${user ? ` (${nameFromEmail(user)})` : ''}`, ''];
    for (const g of groups) {
      lines.push(`${g.label.toUpperCase()} (${g.tasks.length})`);
      for (const t of g.tasks) {
        const r = byRa.get(t.raNumber);
        const who = t.completedBy ?? t.assignedTo;
        const parts = [t.raNumber, r?.renter.name, r?.bodyshop?.name, TASK_REASON_LABEL[t.reason]];
        if (r) parts.push(`due ${money(r.money.totalAmountDue)}`);
        if (t.outcome) parts.push(`→ ${t.outcome.replace('_', ' ')}${t.outcomeDate ? ` ${formatDate(t.outcomeDate)}` : ''}`);
        if (t.outcomeNote) parts.push(`"${t.outcomeNote}"`);
        if (t.status === 'snoozed' && t.snoozedUntil) parts.push(`until ${formatDate(t.snoozedUntil)}`);
        if (who) parts.push(`(${nameFromEmail(who)})`);
        lines.push(`- ${parts.filter(Boolean).join(', ')}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  async function copy() {
    try { await navigator.clipboard.writeText(summaryText()); showToast('Shift summary copied'); } catch { showToast('Copy failed'); }
  }

  return (
    <div>
      <PageHeader
        title="Shift handover"
        subtitle="What was done today, by whom, and what is left for the next shift."
        right={<>
          <button className="btn btn-sm" onClick={copy}>Copy shift summary</button>
          <button className="btn btn-sm" onClick={() => window.print()}>Print</button>
        </>}
      />
      <div className="no-print mb-3 flex flex-wrap items-end gap-3">
        <Field label="Date"><input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="User">
          <select className="select" value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Everyone</option>
            {users.map((u) => <option key={u} value={u}>{nameFromEmail(u)}{u === me?.email ? ' (me)' : ''}</option>)}
          </select>
        </Field>
      </div>

      {tasks === null ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          {groups.map((g) => (
            <Section key={g.key} title={<span className="flex items-center gap-2">{g.label} <Chip tone={statusTone(g.key)}>{g.tasks.length}</Chip></span>}>
              {g.tasks.length === 0 ? <div className="px-4 py-3 text-sm text-ink-3">None</div> : (
                <ul className="divide-y divide-border text-sm">
                  {g.tasks.map((t) => {
                    const r = byRa.get(t.raNumber);
                    return (
                      <li key={t.id} className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button className="ra text-accent hover:underline" onClick={() => openRental(t.raNumber)}>{t.raNumber}</button>
                          <span className="text-ink-2">{TASK_REASON_LABEL[t.reason]}</span>
                          {r && <span className="num text-ink-3">{money(r.money.totalAmountDue)}</span>}
                          {(t.completedBy ?? t.assignedTo) && <span className="ml-auto text-xs text-ink-3">{nameFromEmail(t.completedBy ?? t.assignedTo)}{t.completedAt ? `, ${formatIso(t.completedAt, rules.timezone)}` : ''}</span>}
                        </div>
                        <div className="text-xs text-ink-2">
                          {r ? `${r.renter.name}${r.bodyshop ? `, ${r.bodyshop.name}` : ''}` : ''}
                          {t.outcome && <>, outcome <strong className="text-ink">{t.outcome.replace('_', ' ')}{t.outcomeDate ? ` ${formatDate(t.outcomeDate)}` : ''}</strong></>}
                          {t.outcomeNote && <>, {t.outcomeNote}</>}
                          {t.status === 'snoozed' && t.snoozedUntil && <>, until {formatDate(t.snoozedUntil)}</>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          ))}
          <Section title="Activity log" className="lg:col-span-2">
            {!events?.length ? <div className="px-4 py-3 text-sm text-ink-3">No actions recorded on this day.</div> : (
              <ul className="divide-y divide-border text-sm max-h-96 overflow-auto">
                {events.filter((e) => !user || e.by === user).map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-2 px-4 py-1.5">
                    <span className="num text-ink-3">{formatIso(e.at, rules.timezone)}</span>
                    <span className="font-medium">{nameFromEmail(e.by)}</span>
                    <span>{e.action}</span>
                    <button className="ra text-accent hover:underline" onClick={() => openRental(e.raNumber)}>{e.raNumber}</button>
                    {e.detail && <span className="text-ink-2">{Object.entries(e.detail).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
      <Toast message={toast} />
    </div>
  );
}

export { STATUS_LABEL };

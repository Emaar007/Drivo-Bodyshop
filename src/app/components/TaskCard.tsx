import { useState } from 'react';
import type { Rental, Task, TaskOutcome } from '@shared/types';
import { daysOverdue, suggestedAction, taskWhy } from '@shared/rules';
import { addDays } from '@shared/dates';
import { useStore } from '../store';
import { OUTCOMES } from '../api';
import { formatDate, nameFromEmail } from '../format';
import { Chip, Email, Field, Modal, Money, PayerChip, Phone } from './ui';

export function statusTone(s: Task['status']): 'neutral' | 'good' | 'warn' | 'accent' {
  return s === 'completed' ? 'good' : s === 'in_progress' ? 'accent' : s === 'snoozed' ? 'warn' : 'neutral';
}
export const STATUS_LABEL: Record<Task['status'], string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', snoozed: 'Snoozed' };

/** One row of the task ledger. */
export default function TaskCard({ task, rental }: { task: Task; rental: Rental | undefined }) {
  const { today, taskAction, openRental, me } = useStore();
  const [modal, setModal] = useState<'complete' | 'snooze' | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try { await taskAction(task.id, body); } finally { setBusy(false); setModal(null); }
  }

  if (!rental) {
    return (
      <div className="ledger-row is-quiet text-sm text-ink-3">
        <span className="ra">{task.raNumber}</span> is no longer in the TSD extract (returned, or outside the date range).
        <button className="btn btn-sm ml-2" onClick={() => act({ action: 'complete', outcome: 'other', note: 'Rental gone from TSD extract' })}>Close task</button>
      </div>
    );
  }

  const over = daysOverdue(rental, today) ?? 0;
  const why = taskWhy(rental, task.reason, today);
  const action = suggestedAction(rental, task.reason, today);
  const done = task.status === 'completed';
  const rowTone = done ? 'is-done is-quiet' : over > 0 ? 'is-overdue' : task.reason === 'due_soon' ? 'is-soon' : 'is-quiet';

  return (
    <article className={`ledger-row ${rowTone}`}>
      <div className="grid gap-x-6 gap-y-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        {/* what and why */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button className="ra text-[15px] font-medium text-accent hover:underline" onClick={() => openRental(rental.raNumber)}>{rental.raNumber}</button>
            <PayerChip payer={rental.payerType} />
            {task.status !== 'not_started' && <Chip tone={statusTone(task.status)}>{STATUS_LABEL[task.status]}{task.status === 'snoozed' && task.snoozedUntil ? ` until ${formatDate(task.snoozedUntil)}` : ''}</Chip>}
            {task.assignedTo && <span className="text-xs text-ink-2" title={task.assignedTo}>{nameFromEmail(task.assignedTo)}</span>}
          </div>
          <div className={`mt-1 text-[15px] leading-snug ${over > 0 ? 'font-medium text-serious' : 'font-medium'}`}>{why}</div>
          <div className="mt-1 text-[13px] text-ink-2">{action}</div>
          {task.outcome && (
            <div className="mt-1.5 text-[13px]">
              <span className="text-ink-2">Outcome: </span>
              <strong>{OUTCOMES.find((o) => o.value === task.outcome)?.label.replace('…', '') ?? task.outcome}</strong>
              {task.outcomeDate ? ` ${formatDate(task.outcomeDate)}` : ''}{task.outcomeNote ? ` — ${task.outcomeNote}` : ''}
              {task.completedBy ? <span className="text-ink-3"> by {nameFromEmail(task.completedBy)}</span> : null}
            </div>
          )}
        </div>

        {/* who to call */}
        <div className="text-[13px]">
          <div className="lbl">Body shop</div>
          <div className="font-medium">{rental.bodyshop?.name ?? <span className="text-ink-3">unknown</span>}{rental.bodyshop && !rental.bodyshop.matched && <span className="ml-1 text-warn" title="Not in the contact list">?</span>}</div>
          <div><Phone phone={rental.bodyshop?.phone} /></div>
          <div className="truncate"><Email email={rental.bodyshop?.email} /></div>
        </div>
        <div className="text-[13px]">
          <div className="lbl">Customer</div>
          <div className="font-medium">{rental.renter.name || <span className="text-ink-3">—</span>}</div>
          <div><Phone phone={rental.renter.phone} /></div>
          <div className="truncate"><Email email={rental.renter.email} /></div>
        </div>
        <div className="text-[13px]">
          <div className="lbl">{rental.insurer ? 'Insurer' : 'Rental'}</div>
          {rental.insurer ? (
            <>
              <div className="font-medium">{rental.insurer.name}</div>
              {rental.insurer.claimNumber && <div className="text-ink-2">Claim {rental.insurer.claimNumber}</div>}
              {rental.insurer.adjusterName ? <div className="text-ink-2">{rental.insurer.adjusterName} <Phone phone={rental.insurer.adjusterPhone} /></div> : rental.insurer.phone ? <div><Phone phone={rental.insurer.phone} /></div> : null}
            </>
          ) : (
            <>
              <div>Out since {formatDate(rental.pickupDate)}, {rental.rentalDays} day{rental.rentalDays === 1 ? '' : 's'}</div>
              <div className="text-ink-2">Drop-off {rental.scheduledDropOff ? formatDate(rental.scheduledDropOff, { time: true }) : 'not set'}</div>
              <div className="text-ink-2">{rental.location}{rental.unitNumber ? `, unit ${rental.unitNumber}` : ''}{rental.extensions.length ? `, extended ${rental.extensions.length}×` : ''}</div>
            </>
          )}
        </div>

        {/* money */}
        <div className="num text-left lg:text-right">
          {rental.money.estimated && rental.money.totalAmountDue < -0.005 ? (
            <>
              <div className="display text-[22px] font-semibold leading-none text-good">Paid up</div>
              <div className="mt-1 text-xs text-ink-3">prepaid <Money value={-rental.money.totalAmountDue} /> past the drop-off</div>
            </>
          ) : (
            <>
              <div className="display text-[22px] font-semibold leading-none"><Money value={rental.money.totalAmountDue} estimated={rental.money.estimated} /></div>
              <div className="mt-1 text-xs text-ink-3">renter <Money value={rental.money.renterAmountDue} /></div>
              <div className="text-xs text-ink-3">company <Money value={rental.money.companyAmountDue} /></div>
            </>
          )}
        </div>
      </div>

      <div className="no-print mt-2.5 flex flex-wrap items-center gap-2">
        {task.status !== 'completed' && task.status !== 'in_progress' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act({ action: 'start' })}>Start</button>}
        {task.status !== 'completed' && <button className="btn btn-sm" disabled={busy} onClick={() => setModal('complete')}>Complete</button>}
        {task.status !== 'completed' && <button className="btn btn-sm" disabled={busy} onClick={() => setModal('snooze')}>Snooze</button>}
        {task.status === 'completed' && <button className="btn btn-sm" disabled={busy} onClick={() => act({ action: 'reopen' })}>Reopen</button>}
        {!task.assignedTo && task.status !== 'completed' && me && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act({ action: 'assign', to: me.email })}>Take it</button>}
        {task.assignedTo && task.status !== 'completed' && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act({ action: 'assign', to: null })}>Unassign</button>}
        <button className="btn btn-sm btn-ghost" onClick={() => openRental(rental.raNumber)}>Details and notes</button>
        {rental.insurer && <span className="ml-auto text-xs text-ink-3">Out since {formatDate(rental.pickupDate)}, {rental.rentalDays} days, drop-off {rental.scheduledDropOff ? formatDate(rental.scheduledDropOff, { time: true }) : 'not set'}</span>}
      </div>

      {modal === 'complete' && <CompleteModal rental={rental} onClose={() => setModal(null)} onSubmit={(outcome, date, note) => act({ action: 'complete', outcome, outcomeDate: date, note })} />}
      {modal === 'snooze' && <SnoozeModal today={today} onClose={() => setModal(null)} onSubmit={(until, note) => act({ action: 'snooze', until, note })} />}
    </article>
  );
}

export function CompleteModal({ rental, onClose, onSubmit }: { rental: Rental; onClose: () => void; onSubmit: (o: TaskOutcome, date: string | null, note: string | null) => void }) {
  const [outcome, setOutcome] = useState<TaskOutcome>('extended');
  const [date, setDate] = useState(() => addDays((rental.scheduledDropOff ?? new Date().toISOString()).slice(0, 10), 7));
  const [note, setNote] = useState('');
  const needsDate = OUTCOMES.find((o) => o.value === outcome)?.needsDate;
  return (
    <Modal
      title={`Complete ${rental.raNumber}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onSubmit(outcome, needsDate ? date : null, note.trim() || null)}>Complete task</button></>}
    >
      <Field label="What happened">
        <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value as TaskOutcome)}>
          {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label.replace('…', '')}</option>)}
        </select>
      </Field>
      {needsDate && (
        <Field label={needsDate === 'extended' ? 'New drop-off date' : 'Payment promised for'} hint={needsDate === 'extended' ? 'Set the same date in TSD; the dashboard reads it back on the next refresh.' : undefined}>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      )}
      <Field label="Note for the team (optional)">
        <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who you spoke to, what was agreed" />
      </Field>
    </Modal>
  );
}

export function SnoozeModal({ today, onClose, onSubmit }: { today: string; onClose: () => void; onSubmit: (until: string, note: string | null) => void }) {
  const [until, setUntil] = useState(addDays(today, 1));
  const [note, setNote] = useState('');
  return (
    <Modal title="Snooze task" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onSubmit(until, note.trim() || null)}>Snooze</button></>}>
      <Field label="Bring it back on" hint="The task is hidden until that morning.">
        <input className="input" type="date" min={addDays(today, 1)} value={until} onChange={(e) => setUntil(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        {[1, 2, 3, 7].map((d) => <button key={d} className="btn btn-sm" onClick={() => setUntil(addDays(today, d))}>{d === 1 ? 'Tomorrow' : `In ${d} days`}</button>)}
      </div>
      <Field label="Why (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

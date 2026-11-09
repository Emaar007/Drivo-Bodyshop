// One task in the ledger: a 56px row on a fixed column grid, with an inline drawer for the detail.
import { useState } from 'react';
import { Check, ChevronDown, Clock, Copy, Hand, Phone as PhoneIcon, RotateCcw, Play } from 'lucide-react';
import type { Rental, Task } from '@shared/types';
import { daysOverdue, daysUntilDropOff, suggestedAction } from '@shared/rules';
import { useStore } from '../store';
import { OUTCOMES } from '../api';
import { formatDate, money, nameFromEmail, telHref } from '../format';
import { IconButton, PayerTag, Tag, Tooltip } from './primitives';
import { Email, Money } from '../components/ui';
import { CompleteModal, SnoozeModal } from '../components/TaskCard';
import { CoverageMeter } from './Coverage';

export const STATUS_LABEL: Record<Task['status'], string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', snoozed: 'Snoozed' };

/** Short reason, max 6 words. */
export function shortReason(r: Rental, task: Task, today: string): string {
  const due = r.money.totalAmountDue;
  const over = daysOverdue(r, today) ?? 0;
  const until = daysUntilDropOff(r, today);
  switch (task.reason) {
    case 'overdue_customer':
    case 'overdue_company':
      return `Overdue ${over}d · call now`;
    case 'due_soon':
      return until === 0 ? 'Due today · extend?' : `Due in ${until}d · extend?`;
    case 'open_ended':
      return `No return date · ${r.rentalDays}d out`;
    case 'data_fix':
      return due < -0.005 ? `Credit ${money(-due)} · refund?` : (r.dataIssues[0] ?? 'Check data').replace(/\s*\(.*\)$/, '').split(' ').slice(0, 6).join(' ');
    case 'verify_insurance': {
      const d = r.coverage.daysToDeadline ?? 0;
      return d < 0 ? `Verify coverage · ${-d}d late` : d === 0 ? 'Verify coverage · due today' : `Verify coverage · ${d}d left`;
    }
    case 'coverage_ending':
      return `Coverage used up · ${-(r.coverage.daysLeft ?? 0)}d over`;
    case 'manual':
      return due > 0.005 ? `Balance ${money(due)} · follow up` : task.outcomeNote?.split(' ').slice(0, 6).join(' ') || 'Follow up';
  }
}

function Contact({ name, phone, email, fallback, onToast }: { name: string | null | undefined; phone: string | null; email: string | null; fallback: string; onToast?: (m: string) => void }) {
  const tel = telHref(phone);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Tooltip label={<div><div>{name || fallback}</div>{phone && <div className="num">{phone}</div>}{email && <div className="text-text1">{email}</div>}</div>}>
        <span className={`truncate text-[13px] ${name ? 'text-text0' : 'text-text2'}`}>{name || fallback}</span>
      </Tooltip>
      {tel && (
        <Tooltip label={`Call ${phone}`}>
          <a href={tel} className="btn-icon btn-icon-sm" aria-label={`Call ${name ?? fallback} ${phone}`}><PhoneIcon size={13} strokeWidth={1.5} /></a>
        </Tooltip>
      )}
      {email && (
        <IconButton size="sm" label={`Copy ${email}`} onClick={() => { void navigator.clipboard?.writeText(email); onToast?.('Email copied'); }}><Copy size={13} strokeWidth={1.5} /></IconButton>
      )}
    </div>
  );
}

export default function TaskRow({ task, rental, highlighted, onToast }: { task: Task; rental: Rental | undefined; highlighted?: boolean; onToast?: (m: string) => void }) {
  const { today, taskAction, openRental, me } = useStore();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'complete' | 'snooze' | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try { await taskAction(task.id, body); } finally { setBusy(false); setModal(null); }
  }

  if (!rental) {
    return (
      <div id={`task-${task.raNumber}`} className="ledger-row flex h-11 items-center gap-3 px-4 text-[13px] text-text2">
        <span className="ra">{task.raNumber}</span><span>no longer in the TSD extract</span>
        <button className="btn btn-sm ml-auto" onClick={() => act({ action: 'complete', outcome: 'other', note: 'Rental gone from TSD extract' })}>Close task</button>
      </div>
    );
  }

  const over = daysOverdue(rental, today) ?? 0;
  const done = task.status === 'completed';
  const active = task.status === 'in_progress';
  const tone = done ? 'is-done' : over > 0 ? 'is-overdue' : task.reason === 'due_soon' ? 'is-soon' : '';
  const prepaid = rental.money.estimated && rental.money.totalAmountDue < -0.005;

  if (done) {
    return (
      <div id={`task-${task.raNumber}`} className={`ledger-row is-done flex h-9 items-center gap-3 px-4 text-[12.5px] ${highlighted ? 'is-highlight' : ''}`}>
        <Check size={14} className="text-ok" strokeWidth={1.5} />
        <button className="ra text-text0 hover:underline" onClick={() => openRental(rental.raNumber)}>{rental.raNumber}</button>
        <span className="truncate text-text1">{OUTCOMES.find((o) => o.value === task.outcome)?.label.replace('…', '') ?? 'Completed'}{task.outcomeDate ? ` ${formatDate(task.outcomeDate)}` : ''}{task.outcomeNote ? `, ${task.outcomeNote}` : ''}</span>
        <span className="ml-auto whitespace-nowrap text-text2">{task.completedBy ? nameFromEmail(task.completedBy) : ''}</span>
        <IconButton size="sm" label="Reopen" onClick={() => act({ action: 'reopen' })} disabled={busy}><RotateCcw size={13} strokeWidth={1.5} /></IconButton>
      </div>
    );
  }

  return (
    <article id={`task-${task.raNumber}`} className={`ledger-row ${tone} ${active ? 'is-active' : ''} ${highlighted ? 'is-highlight' : ''}`}>
      <div className="grid min-h-14 items-center gap-x-4 px-4 py-2 lg:grid-cols-[150px_minmax(140px,1.1fr)_minmax(150px,1fr)_minmax(150px,1fr)_130px_auto]">
        {/* R/A + payer */}
        <div className="flex flex-col gap-1">
          <button className="ra text-left text-[13.5px] text-text0 hover:text-brand-bright" onClick={() => openRental(rental.raNumber)}>{rental.raNumber}</button>
          {task.reason === 'verify_insurance' || task.reason === 'coverage_ending'
            ? <Tag color="var(--brand-bright)">{task.reason === 'verify_insurance' ? 'Insurance verification' : 'Coverage ending'}</Tag>
            : <PayerTag payer={rental.payerType} />}
        </div>
        {/* reason */}
        <div className="min-w-0">
          <div className={`truncate text-[13px] ${over > 0 || (task.reason === 'verify_insurance' && (rental.coverage.daysToDeadline ?? 0) < 0) || task.reason === 'coverage_ending' ? 'font-medium text-danger' : 'text-text0'}`}>{shortReason(rental, task, today)}</div>
          {rental.coverage.applies && task.reason !== 'verify_insurance' ? <div className="mt-0.5"><CoverageMeter coverage={rental.coverage} compact /></div> : task.reason === 'verify_insurance' ? (
            <div className="num mt-0.5 text-[11px] text-text2">picked up {formatDate(rental.pickupDate)} · verify by {formatDate(rental.coverage.deadline)}{rental.insurer?.name ? ` · ${rental.insurer.name}` : ''}</div>
          ) : <div className="num mt-0.5 text-[11px] text-text2">
            {rental.scheduledDropOff ? `drop-off ${formatDate(rental.scheduledDropOff)}` : 'no drop-off'}{task.assignedTo ? ` · ${nameFromEmail(task.assignedTo)}` : ''}{task.status === 'snoozed' && task.snoozedUntil ? ` · snoozed to ${formatDate(task.snoozedUntil)}` : ''}
          </div>}
        </div>
        {/* body shop */}
        <Contact name={rental.bodyshop?.name} phone={rental.bodyshop?.phone ?? null} email={rental.bodyshop?.email ?? null} fallback="Add body shop" onToast={onToast} />
        {/* customer */}
        <Contact name={rental.renter.name} phone={rental.renter.phone} email={rental.renter.email} fallback="No renter name" onToast={onToast} />
        {/* money */}
        <div className="num text-right">
          {prepaid ? (
            <span className="chip chip-good gap-1"><Check size={11} />Prepaid {money(-rental.money.totalAmountDue)}</span>
          ) : (
            <div className="text-[14px] text-text0"><Money value={rental.money.totalAmountDue} estimated={rental.money.estimated} /></div>
          )}
        </div>
        {/* actions */}
        <div className="no-print flex items-center justify-end gap-0.5">
          {active ? (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setModal('complete')}>Complete</button>
          ) : (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act({ action: 'start' })}><Play size={12} />Start</button>
          )}
          {!active && <IconButton size="sm" label="Complete" onClick={() => setModal('complete')} disabled={busy}><Check size={14} strokeWidth={1.5} /></IconButton>}
          <IconButton size="sm" label="Snooze" onClick={() => setModal('snooze')} disabled={busy}><Clock size={14} strokeWidth={1.5} /></IconButton>
          {!task.assignedTo && me && <IconButton size="sm" label="Take it" onClick={() => act({ action: 'assign', to: me.email })} disabled={busy}><Hand size={14} strokeWidth={1.5} /></IconButton>}
          <IconButton size="sm" label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen((o) => !o)} active={open}><ChevronDown size={14} strokeWidth={1.5} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} /></IconButton>
        </div>
      </div>

      {open && (
        <div className="grid gap-x-6 gap-y-3 border-t border-line bg-bg0/40 px-4 py-3 text-[13px] lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="lbl mb-1">Suggested</div>
            <p className="max-w-[60ch] text-text0">{suggestedAction(rental, task.reason, today)}</p>
            {task.outcomeNote && <p className="mt-1 text-text1">Note: {task.outcomeNote}</p>}
          </div>
          <div>
            <div className="lbl mb-1">Body shop</div>
            <div>{rental.bodyshop?.name ?? <span className="text-text2">-</span>}</div>
            <div className="num text-text1">{rental.bodyshop?.phone ?? '-'}</div>
            <div className="truncate"><Email email={rental.bodyshop?.email} /></div>
          </div>
          <div>
            <div className="lbl mb-1">Customer</div>
            <div>{rental.renter.name || <span className="text-text2">-</span>}</div>
            <div className="num text-text1">{rental.renter.phone ?? '-'}</div>
            <div className="truncate"><Email email={rental.renter.email} /></div>
            {rental.coverage.applies && <div className="mt-2"><div className="lbl mb-1">Coverage</div><CoverageMeter coverage={rental.coverage} /></div>}
            {rental.insurer && <div className="mt-1 text-text1">{rental.insurer.name}{rental.insurer.claimNumber ? `, claim ${rental.insurer.claimNumber}` : ''}{rental.insurer.adjusterName ? `, ${rental.insurer.adjusterName}` : ''}{rental.insurer.adjusterPhone ? ` ${rental.insurer.adjusterPhone}` : ''}</div>}
          </div>
          <div className="num text-[12.5px]">
            <div className="lbl mb-1">Rental</div>
            <div className="flex justify-between gap-3"><span className="text-text1">Out since</span><span>{formatDate(rental.pickupDate)} · {rental.rentalDays}d</span></div>
            <div className="flex justify-between gap-3"><span className="text-text1">Drop-off</span><span>{rental.scheduledDropOff ? formatDate(rental.scheduledDropOff, { time: true }) : '-'}</span></div>
            <div className="flex justify-between gap-3"><span className="text-text1">Unit</span><span>{rental.unitNumber ?? '-'}{rental.location ? ` · ${rental.location}` : ''}</span></div>
            <div className="flex justify-between gap-3"><span className="text-text1">Extensions</span><span>{rental.extensions.length}</span></div>
            <div className="mt-1 flex justify-between gap-3 border-t border-line pt-1"><span className="text-text1">Renter owes</span><Money value={rental.money.renterAmountDue} /></div>
            <div className="flex justify-between gap-3"><span className="text-text1">Company owes</span><Money value={rental.money.companyAmountDue} /></div>
            <div className="flex justify-between gap-3"><span className="text-text1">Paid</span><span>{money(rental.money.totalPaid)}</span></div>
            <button className="mt-2 text-brand-bright hover:underline" onClick={() => openRental(rental.raNumber)}>Open full record, notes and history</button>
          </div>
        </div>
      )}

      {modal === 'complete' && <CompleteModal rental={rental} onClose={() => setModal(null)} onSubmit={(outcome, date, note) => act({ action: 'complete', outcome, outcomeDate: date, note })} />}
      {modal === 'snooze' && <SnoozeModal today={today} onClose={() => setModal(null)} onSubmit={(until, note) => act({ action: 'snooze', until, note })} />}
    </article>
  );
}

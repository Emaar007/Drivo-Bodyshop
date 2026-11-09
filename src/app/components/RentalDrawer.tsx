import { useEffect, useState } from 'react';
import type { Task, TeamNote } from '@shared/types';
import { classify, daysOutstanding } from '@shared/rules';
import { TASK_REASON_LABEL } from '@shared/config/rules';
import { useStore } from '../store';
import { api } from '../api';
import { formatDate, formatIso, money, nameFromEmail } from '../format';
import { Chip, Email, Money, PayerChip, Phone, Spinner } from './ui';
import { STATUS_LABEL, statusTone } from './TaskCard';
import { CoverageMeter } from '../ui/Coverage';

export default function RentalDrawer() {
  const { selectedRa, openRental, byRa, today, me, createTask, rules } = useStore();
  const rental = selectedRa ? byRa.get(selectedRa) : undefined;
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [notes, setNotes] = useState<TeamNote[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedRa) return;
    setTasks(null);
    setNotes(null);
    let alive = true;
    Promise.all([api.tasksForRental(selectedRa), api.notes(selectedRa)]).then(([t, n]) => {
      if (!alive) return;
      setTasks(t);
      setNotes(n);
    });
    return () => { alive = false; };
  }, [selectedRa]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openRental(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openRental]);

  if (!selectedRa) return null;

  async function addNote() {
    if (!rental || !text.trim()) return;
    setBusy(true);
    try {
      const n = await api.addNote(rental.raNumber, text.trim());
      setNotes((ns) => [n, ...(ns ?? [])]);
      setText('');
    } finally { setBusy(false); }
  }

  async function newTask() {
    if (!rental) return;
    setBusy(true);
    try {
      await createTask(rental.raNumber, text.trim() || null);
      setTasks(await api.tasksForRental(rental.raNumber));
      setText('');
    } finally { setBusy(false); }
  }

  const subs = rental ? rental.subRentals.map((s) => byRa.get(s)).filter((x): x is NonNullable<typeof x> => !!x) : [];
  const state = rental ? classify(rental, today, rules) : null;
  const outstanding = rental ? daysOutstanding(rental, today) : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => openRental(null)}>
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {!rental ? (
          <div className="p-6">
            <div className="text-sm">Rental {selectedRa} is not in the current data.</div>
            <button className="btn mt-3" onClick={() => openRental(null)}>Close</button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <header className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="ra text-lg font-semibold">{rental.raNumber}</h2>
                  <PayerChip payer={rental.payerType} />
                  {state && <Chip tone={state === 'overdue' ? 'critical' : state === 'due_soon' || state === 'due_today' ? 'warn' : state === 'returned' ? 'neutral' : 'accent'}>{STATE_LABEL[state]}</Chip>}
                  {rental.kind === 'after_rental' && <Chip tone="neutral">after-rental charges{rental.baseRaNumber ? ` for ${rental.baseRaNumber}` : ''}</Chip>}
                </div>
                <div className="mt-1 text-sm text-ink-2">{rental.sourceOfBusiness}, {rental.location}{rental.unitNumber ? `, unit ${rental.unitNumber}` : ''}{rental.vehicleClass ? ` (${rental.vehicleClass})` : ''}{rental.checkedOutBy ? `, opened by ${rental.checkedOutBy}` : ''}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => openRental(null)} aria-label="Close">✕</button>
            </header>

            {rental.baseRaNumber && byRa.has(rental.baseRaNumber) && (
              <button className="text-left text-sm text-accent hover:underline" onClick={() => openRental(rental.baseRaNumber)}>← Open the rental {rental.baseRaNumber}</button>
            )}

            <section className="strip mb-5">
              <Info label="Pickup" value={formatDate(rental.pickupDate, { time: true })} />
              <Info label="Scheduled drop-off" value={rental.scheduledDropOff ? formatDate(rental.scheduledDropOff, { time: true }) : 'not set'} tone={state === 'overdue' ? 'serious' : undefined} />
              <Info label="Returned" value={rental.actualReturn ? formatDate(rental.actualReturn, { time: true }) : rental.isOut ? 'still out' : '—'} />
              <Info label="Rental days" value={`${rental.rentalDays}${rental.dailyRate ? ` @ ${money(rental.dailyRate)}/day` : ''}`} />
              <Info label="Days outstanding" value={outstanding ? `${outstanding.days} (${outstanding.basis})` : '—'} />
              <Info label="Last payment" value={rental.money.lastPaymentDate ? formatDate(rental.money.lastPaymentDate) : '—'} />
            </section>

            <section className="sheet p-3">
              <div className="mb-2 lbl font-medium">Money{rental.money.estimated && <span className="ml-2 normal-case font-normal text-warn">estimated until TSD posts the charges at return</span>}</div>
              <table className="w-full text-sm">
                <thead><tr className="lbl"><th className="text-left font-medium">Share</th><th className="text-right font-medium">Billed</th><th className="text-right font-medium">Paid</th><th className="text-right font-medium">Due</th></tr></thead>
                <tbody className="num">
                  <tr><td>Renter</td><td className="text-right">{money(rental.money.renterBill)}</td><td className="text-right">{money(rental.money.totalPaid - rental.money.companyPaid)}</td><td className="text-right"><Money value={rental.money.renterAmountDue} /></td></tr>
                  <tr><td>Company {rental.companyName ? <span className="text-ink-3">({rental.companyName})</span> : null}</td><td className="text-right">{money(rental.money.companyBill)}</td><td className="text-right">{money(rental.money.companyPaid)}</td><td className="text-right"><Money value={rental.money.companyAmountDue} /></td></tr>
                  <tr className="border-t border-border font-semibold"><td>Total</td><td className="text-right">{money(rental.money.totalBill)}</td><td className="text-right">{money(rental.money.totalPaid)}</td><td className="text-right"><Money value={rental.money.totalAmountDue} estimated={rental.money.estimated} /></td></tr>
                </tbody>
              </table>
              {rental.money.totalAmountDue < -0.005 && <div className="mt-2 text-xs text-good">Credit balance: the customer overpaid; not counted as receivable.</div>}
            </section>

            <section className="grid gap-3 sm:grid-cols-3 text-sm">
              <div className="sheet p-3">
                <div className="lbl font-medium">Body shop</div>
                <div className="mt-1 font-medium">{rental.bodyshop?.name ?? '—'}{rental.bodyshop && !rental.bodyshop.matched && <span className="ml-1 text-warn" title="Not in the contact list; add it in Settings">(unmatched)</span>}</div>
                {rental.bodyshop?.contact && <div className="text-ink-2">{rental.bodyshop.contact}</div>}
                <div><Phone phone={rental.bodyshop?.phone} /></div>
                <div><Email email={rental.bodyshop?.email} /></div>
                {rental.bodyshop?.address && <div className="text-xs text-ink-3">{rental.bodyshop.address}</div>}
              </div>
              <div className="sheet p-3">
                <div className="lbl font-medium">Customer</div>
                <div className="mt-1 font-medium">{rental.renter.name || '—'}</div>
                <div><Phone phone={rental.renter.phone} /></div>
                <div><Email email={rental.renter.email} /></div>
              </div>
              <div className="sheet p-3">
                <div className="lbl font-medium">Insurer</div>
                <div className="mt-1 font-medium">{rental.insurer?.name ?? 'none'}</div>
                {rental.insurer?.claimNumber && <div className="text-ink-2">Claim {rental.insurer.claimNumber}</div>}
                {rental.insurer?.adjusterName && <div className="text-ink-2">Adjuster {rental.insurer.adjusterName}</div>}
                <div><Phone phone={rental.insurer?.adjusterPhone ?? rental.insurer?.phone} /></div>
                <div><Email email={rental.insurer?.email} /></div>
                {(rental.insurer?.amountPerDayAuthorised || rental.insurer?.authorisedDays) && (
                  <div className="text-xs text-ink-3">Authorised {rental.insurer.amountPerDayAuthorised ? `${money(rental.insurer.amountPerDayAuthorised)}/day` : ''}{rental.insurer.authorisedDays ? ` for ${rental.insurer.authorisedDays} days` : ''}{rental.insurer.maxPay ? ` (max ${money(rental.insurer.maxPay)})` : ''}</div>
                )}
              </div>
            </section>

            {rental.coverage.applies && (
              <section className="panel p-3 text-sm">
                <div className="lbl mb-1.5">Insurance coverage</div>
                <CoverageMeter coverage={rental.coverage} />
                {rental.coverage.note && <div className="mt-2 text-[12px] text-text1">From TSD note{rental.coverage.verifiedAt ? ` (${formatDate(rental.coverage.verifiedAt, { time: true })}${rental.coverage.verifiedBy ? `, ${rental.coverage.verifiedBy}` : ''})` : ''}: "{rental.coverage.note}"</div>}
                {rental.coverage.status === 'not_verified' && <div className="mt-2 text-[12px] text-text1">No verification note yet. Verify with {rental.insurer?.name ?? 'the insurer'} and add a note in TSD, e.g. "Insurance verified, $30 for 30 days".</div>}
              </section>
            )}

            {rental.excluded.lines.length > 0 && (
              <section className="panel p-3 text-sm">
                <div className="lbl mb-1">Left out of the balance (tolls, tickets)</div>
                {rental.excluded.lines.map((l, i) => <div key={i} className="flex justify-between gap-3 py-0.5"><span className="text-text1">{l.description || l.code}</span><span className="num">{money(l.amount)}</span></div>)}
                {rental.excluded.allocationUnclear && <div className="mt-1 text-[12px] text-warn">TSD does not say which charge each payment was for: payments were applied to the rental first.</div>}
              </section>
            )}

            {rental.dataIssues.length > 0 && (
              <section className="rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn">
                <div className="font-medium">Data to fix</div>
                <ul className="list-disc pl-5">{rental.dataIssues.map((i) => <li key={i}>{i}</li>)}</ul>
              </section>
            )}

            {subs.length > 0 && (
              <section className="sheet p-3 text-sm">
                <div className="mb-1 lbl font-medium">After-rental charges (tickets, tolls, damage)</div>
                {subs.map((s) => (
                  <button key={s.raNumber} className="flex w-full items-center justify-between py-1 hover:text-accent" onClick={() => openRental(s.raNumber)}>
                    <span className="ra">{s.raNumber}</span>
                    <span className="num">billed {money(s.money.totalBill)}, due <Money value={s.money.totalAmountDue} /></span>
                  </button>
                ))}
              </section>
            )}

            <section className="sheet p-3 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <div className="lbl font-medium">Team notes & follow-ups</div>
                <span className="text-xs text-ink-3">{me?.email}</span>
              </div>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="Add a note for the team…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} />
                <button className="btn" disabled={busy || !text.trim()} onClick={addNote}>Add note</button>
                <button className="btn" disabled={busy} onClick={newTask} title="Create a follow-up task for today with this text">+ Task</button>
              </div>
              {notes === null ? <Spinner /> : notes.length === 0 ? <div className="mt-2 text-xs text-ink-3">No team notes yet.</div> : (
                <ul className="mt-2 divide-y divide-border">
                  {notes.map((n) => (
                    <li key={n.id} className="py-1.5">
                      <div>{n.text}</div>
                      <div className="text-xs text-ink-3">{nameFromEmail(n.createdBy)}, {formatIso(n.createdAt, rules.timezone)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="sheet p-3 text-sm">
              <div className="mb-1 lbl font-medium">Task history</div>
              {tasks === null ? <Spinner /> : tasks.length === 0 ? <div className="text-xs text-ink-3">No tasks yet.</div> : (
                <ul className="divide-y divide-border">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5">
                      <span className="num text-ink-2">{formatDate(t.taskDate)}</span>
                      <span>{TASK_REASON_LABEL[t.reason]}</span>
                      <Chip tone={statusTone(t.status)}>{STATUS_LABEL[t.status]}</Chip>
                      {t.outcome && <span className="text-ink-2">→ {t.outcome.replace('_', ' ')}{t.outcomeDate ? ` ${formatDate(t.outcomeDate)}` : ''}{t.outcomeNote ? `, ${t.outcomeNote}` : ''}</span>}
                      {t.completedBy && <span className="text-xs text-ink-3">by {nameFromEmail(t.completedBy)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="sheet p-3 text-sm">
              <div className="mb-1 lbl font-medium">Extensions in TSD ({rental.extensions.length})</div>
              {rental.extensions.length === 0 ? <div className="text-xs text-ink-3">No drop-off date changes logged.</div> : (
                <ul className="divide-y divide-border">
                  {[...rental.extensions].reverse().map((e, i) => (
                    <li key={i} className="flex flex-wrap gap-2 py-1">
                      <span className="num text-ink-2">{formatDate(e.at, { time: true })}</span>
                      <span>{e.from ? formatDate(e.from) : '?'} → <strong>{e.to ? formatDate(e.to) : '?'}</strong></span>
                      {e.by && <span className="text-xs text-ink-3">by {e.by}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="sheet p-3 text-sm">
              <div className="mb-1 lbl font-medium">TSD counter notes ({rental.notes.length})</div>
              {rental.notes.length === 0 ? <div className="text-xs text-ink-3">No notes in TSD.</div> : (
                <ul className="divide-y divide-border">
                  {[...rental.notes].reverse().map((n, i) => (
                    <li key={i} className="py-1.5">
                      <div className="flex flex-wrap gap-2 text-xs text-ink-3"><span className="num">{formatDate(n.at, { time: true })}</span>{n.subject && <span className="font-medium text-ink-2">{n.subject}</span>}{n.by && <span>by {n.by}</span>}</div>
                      {n.text && <div>{n.text}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  overdue: 'Overdue', due_today: 'Due today', due_soon: 'Due soon', open_ended: 'No return date', out: 'Out', returned: 'Returned', after_rental: 'After-rental',
};

function Info({ label, value, tone }: { label: string; value: string; tone?: 'serious' }) {
  return (
    <div>
      <div className="lbl">{label}</div>
      <div className={tone === 'serious' ? 'font-medium text-serious' : ''}>{value}</div>
    </div>
  );
}

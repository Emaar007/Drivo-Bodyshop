// Settings > Excluded charges: what was left out of the rental balances (tolls, tickets...), so nothing is lost.
// Never mixed into any total. Hidden until opened.
import { useMemo, useState } from 'react';
import type { Rental } from '@shared/types';
import { TO_CONFIRM_CODES } from '@shared/config/charges';
import { useStore } from '../store';
import { downloadText, money } from '../format';
import { Section } from './ui';
import { Tabs } from '../ui/primitives';

interface Row { ra: string; base: string | null; kind: string; renter: string; code: string; description: string; amount: number; toCompany: boolean; status: string }

export default function ExcludedCharges() {
  const { data, openRental } = useStore();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'excluded' | 'confirm'>('excluded');

  const all: Rental[] = useMemo(() => [...(data?.rentals ?? []), ...(data?.excludedRecords ?? [])], [data]);
  const excluded: Row[] = useMemo(() => all.flatMap((r) => r.excluded.lines.map((l) => ({
    ra: r.raNumber, base: r.baseRaNumber, kind: r.nonRentalOnly ? 'hidden (tolls/tickets only)' : 'partly excluded', renter: r.renter.name,
    code: l.code, description: l.description, amount: l.amount, toCompany: l.toCompany,
    status: r.excluded.allocationUnclear ? 'payments applied to rental first' : '',
  }))), [all]);
  const confirm: Row[] = useMemo(() => all.flatMap((r) => r.excluded.questionable.map((l) => ({
    ra: r.raNumber, base: r.baseRaNumber, kind: l.cls === 'unclassified' ? 'unclassified' : 'counted, to confirm', renter: r.renter.name,
    code: l.code, description: l.description, amount: l.amount, toCompany: l.toCompany, status: TO_CONFIRM_CODES[l.code] ?? '',
  }))), [all]);

  const rows = view === 'excluded' ? excluded : confirm;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byDesc = useMemo(() => {
    const m = new Map<string, { n: number; amount: number }>();
    for (const r of rows) { const k = r.description || r.code; const v = m.get(k) ?? { n: 0, amount: 0 }; v.n++; v.amount += r.amount; m.set(k, v); }
    return [...m.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [rows]);

  function exportCsv() {
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['R/A', 'Rental', 'Record', 'Renter', 'Code', 'Description', 'Amount', 'Billed to company', 'Note'];
    const lines = rows.map((r) => [r.ra, r.base ?? r.ra, r.kind, r.renter, r.code, r.description, r.amount.toFixed(2), r.toCompany ? 'yes' : 'no', r.status].map(esc).join(','));
    downloadText(`${view === 'excluded' ? 'excluded_charges' : 'charges_to_confirm'}.csv`, [head.join(','), ...lines].join('\n'));
  }

  return (
    <Section
      title="Excluded charges"
      className="mt-4"
      right={<button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button>}
    >
      {!open ? (
        <div className="px-4 py-3 text-[13px] text-text1">
          Tolls, tickets and similar charges are left out of every balance, collection rate, overdue amount and export.
          {data && !data.chargeDetail && <span className="ml-1 text-warn">The latest TSD push has no charge lines (old push script), so nothing could be excluded yet.</span>}
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={view} onChange={setView} items={[{ value: 'excluded', label: 'Left out', count: excluded.length }, { value: 'confirm', label: 'Counted, needs a decision', count: confirm.length }]} />
            <div className="flex items-center gap-3">
              <span className="num text-[13px] text-text1">{money(total)} on {new Set(rows.map((r) => r.ra)).size} records</span>
              <button className="btn btn-sm" onClick={exportCsv}>Export CSV</button>
            </div>
          </div>
          <div className="text-[12px] text-text2">
            {view === 'excluded'
              ? 'Never added to any total. Records whose only charges are tolls or tickets are hidden from every view.'
              : 'These charge types are still counted as rental. Tell us which to exclude (src/shared/config/charges.ts).'}
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <table className="table">
              <thead><tr><th>Charge</th><th className="right">Lines</th><th className="right">Amount</th></tr></thead>
              <tbody>{byDesc.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v.n}</td><td className="num">{money(v.amount)}</td></tr>)}</tbody>
            </table>
            <div className="max-h-[420px] overflow-auto">
              <table className="table">
                <thead><tr><th>R/A</th><th>Renter</th><th>Charge</th><th className="right">Amount</th><th>Note</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td><button className="ra text-brand-bright hover:underline" onClick={() => openRental(r.base && data?.rentals.some((x) => x.raNumber === r.base) ? r.base : r.ra)}>{r.ra}</button><div className="text-[11px] text-text2">{r.kind}</div></td>
                      <td>{r.renter || '-'}</td>
                      <td>{r.description || r.code}{r.toCompany && <span className="ml-1 text-[11px] text-text2">(company)</span>}</td>
                      <td className="num">{money(r.amount)}</td>
                      <td className="text-[12px] text-text2">{r.status || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

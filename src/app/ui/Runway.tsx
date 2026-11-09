// Runway: scheduled returns over 14 days (6 back, 7 ahead). Each car out is a 10px mark coloured by
// state with the last digits of its R/A under it. Click scrolls to and highlights the task row.
import { useMemo } from 'react';
import type { Rental } from '@shared/types';
import { addDays, dateOf, daysBetween } from '@shared/dates';
import { useStore } from '../store';
import { formatDate, money } from '../format';
import { Tooltip } from './primitives';
import { PAYER_LABEL } from '@shared/config/rules';

const BACK = 6;
const AHEAD = 7;

export default function Runway({ rentals, onPick }: { rentals: Rental[]; onPick: (ra: string) => void }) {
  const { today, rules } = useStore();
  const days = useMemo(() => Array.from({ length: BACK + AHEAD + 1 }, (_, i) => addDays(today, i - BACK)), [today]);

  const placed = useMemo(() => {
    const out = rentals.filter((r) => r.kind === 'rental' && r.isOut);
    const byDay = new Map<string, Rental[]>();
    const farLeft: Rental[] = [];
    const farRight: Rental[] = [];
    const noDate: Rental[] = [];
    for (const r of out) {
      const d = dateOf(r.scheduledDropOff);
      if (!d) { noDate.push(r); continue; }
      const off = daysBetween(today, d);
      if (off < -BACK) farLeft.push(r);
      else if (off > AHEAD) farRight.push(r);
      else (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r);
    }
    return { byDay, farLeft, farRight, noDate };
  }, [rentals, today]);

  const stateOf = (d: string) => {
    const off = daysBetween(today, d);
    return off < 0 ? 'overdue' : off <= rules.dueSoonDays ? 'soon' : 'later';
  };
  const markClass = (state: string) => (state === 'overdue' ? 'bg-danger' : state === 'soon' ? 'bg-warn' : 'bg-text2');
  const isWeekend = (d: string) => [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay());
  const dayLabel = (d: string) => `${new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })[0]} ${Number(d.slice(8, 10))}`;
  const short = (ra: string) => ra.replace(/^[A-Z]+-/, '').slice(-5);

  return (
    <div className="panel px-4 pt-3 pb-2">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="section-title">Runway: scheduled returns, 14 days</h2>
        <div className="flex items-center gap-4 text-[11px] text-text2">
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-danger" />overdue</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-warn" />due in {rules.dueSoonDays} days</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-text2" />later</span>
        </div>
      </div>
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr)) 40px` }}>
        {days.map((d) => {
          const state = stateOf(d);
          const isToday = d === today;
          const cars = placed.byDay.get(d) ?? [];
          return (
            <div key={d} className={`relative flex min-h-[88px] flex-col items-center border-t border-line pt-1.5 ${isWeekend(d) ? 'bg-bg2/60' : ''} ${isToday ? 'border-t-brand-bright' : ''}`}>
              {isToday && <span className="absolute -top-[9px] rounded-[3px] bg-brand-bright px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-on-brand">Today</span>}
              <span className={`num text-[11px] ${isToday ? 'text-text0' : 'text-text2'}`}>{dayLabel(d)}</span>
              <div className="mt-2 flex flex-col items-center gap-2">
                {cars.map((r) => (
                  <Tooltip
                    key={r.raNumber}
                    label={
                      <div className="flex flex-col gap-0.5">
                        <span className="ra">{r.raNumber}</span>
                        <span>{r.renter.name || 'Unknown renter'}</span>
                        <span className="text-text1">{PAYER_LABEL[r.payerType]}{r.bodyshop ? `, ${r.bodyshop.name}` : ''}</span>
                        <span className="text-text1">Due {formatDate(r.scheduledDropOff, { time: true })}</span>
                        <span className="num">{r.money.totalAmountDue > 0.005 ? `${money(r.money.totalAmountDue)} due` : 'Paid up'}</span>
                      </div>
                    }
                  >
                    <button onClick={() => onPick(r.raNumber)} className="group flex flex-col items-center gap-0.5 rounded-[3px] px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bright" aria-label={`${r.raNumber}, due ${formatDate(r.scheduledDropOff)}`}>
                      <span className={`block h-2.5 w-2.5 ${markClass(state)} ${state === 'overdue' ? 'rotate-45' : ''}`} />
                      <span className="num text-[10px] text-text1 group-hover:text-text0">{short(r.raNumber)}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          );
        })}
        <div className="flex min-h-[88px] flex-col items-center border-t border-line pt-1.5">
          {placed.farRight.length > 0 ? (
            <Tooltip label={<div className="flex flex-col gap-0.5">{placed.farRight.map((r) => <span key={r.raNumber} className="ra">{r.raNumber} · {formatDate(r.scheduledDropOff)}</span>)}</div>}>
              <button className="num mt-5 rounded-[4px] border border-line-strong px-1.5 py-0.5 text-[11px] text-text1 hover:text-text0" onClick={() => onPick(placed.farRight[0].raNumber)}>+{placed.farRight.length}</button>
            </Tooltip>
          ) : <span className="num mt-5 text-[11px] text-text2">+0</span>}
        </div>
      </div>
      {(placed.farLeft.length > 0 || placed.noDate.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
          {placed.farLeft.length > 0 && (
            <span className="text-danger">Overdue more than {BACK} days: {placed.farLeft.map((r) => <button key={r.raNumber} className="ra ml-1.5 underline" onClick={() => onPick(r.raNumber)}>{r.raNumber}</button>)}</span>
          )}
          {placed.noDate.length > 0 && (
            <span className="text-warn">No return date: {placed.noDate.map((r) => <button key={r.raNumber} className="ra ml-1.5 underline" onClick={() => onPick(r.raNumber)}>{r.raNumber}</button>)}</span>
          )}
        </div>
      )}
    </div>
  );
}

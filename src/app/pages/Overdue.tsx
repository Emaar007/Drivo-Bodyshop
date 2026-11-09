import { useMemo, useState } from 'react';
import type { Rental } from '@shared/types';
import { PAYER_LABEL } from '@shared/config/rules';
import { classify, daysOverdue } from '@shared/rules';
import { useStore } from '../store';
import { downloadText, formatDate, money } from '../format';
import { DataTable, rowsToCsv, useSort, type Column } from '../components/DataTable';
import { Kpi, Money, PageHeader, PayerChip, Phone, Spinner } from '../components/ui';

export default function OverduePage() {
  const { loading, rentals, today, rules, openRental } = useStore();
  const [payer, setPayer] = useState('');
  const [insurer, setInsurer] = useState('');
  const [shop, setShop] = useState('');
  const [minDays, setMinDays] = useState('');

  const overdue = useMemo(() => rentals.filter((r) => r.kind === 'rental' && classify(r, today, rules) === 'overdue'), [rentals, today, rules]);
  const insurers = useMemo(() => [...new Set(overdue.map((r) => r.insurer?.name).filter((x): x is string => !!x))].sort(), [overdue]);
  const shops = useMemo(() => [...new Set(overdue.map((r) => r.bodyshop?.name).filter((x): x is string => !!x))].sort(), [overdue]);

  const rows = useMemo(() => overdue.filter((r) => {
    if (payer && r.payerType !== payer) return false;
    if (insurer && r.insurer?.name !== insurer) return false;
    if (shop && r.bodyshop?.name !== shop) return false;
    if (minDays && (daysOverdue(r, today) ?? 0) < Number(minDays)) return false;
    return true;
  }), [overdue, payer, insurer, shop, minDays, today]);

  const columns: Column<Rental>[] = useMemo(() => [
    { key: 'ra', label: 'R/A', value: (r) => r.raNumber, render: (r) => <span className="ra text-accent">{r.raNumber}</span> },
    { key: 'days', label: 'Days overdue', value: (r) => daysOverdue(r, today), align: 'right', render: (r) => <span className="font-semibold text-serious">{daysOverdue(r, today)}</span> },
    { key: 'drop', label: 'Scheduled drop-off', value: (r) => r.scheduledDropOff, render: (r) => formatDate(r.scheduledDropOff, { time: true }) },
    { key: 'payer', label: 'Payer', value: (r) => PAYER_LABEL[r.payerType], render: (r) => <PayerChip payer={r.payerType} /> },
    { key: 'renter', label: 'Renter', value: (r) => r.renter.name, render: (r) => <div>{r.renter.name}<div className="text-xs"><Phone phone={r.renter.phone} /></div></div> },
    { key: 'shop', label: 'Body shop', value: (r) => r.bodyshop?.name ?? '', render: (r) => <div>{r.bodyshop?.name ?? '—'}<div className="text-xs"><Phone phone={r.bodyshop?.phone} /></div></div> },
    { key: 'insurer', label: 'Insurer', value: (r) => r.insurer?.name ?? '' },
    { key: 'rentalDays', label: 'Rental days', value: (r) => r.rentalDays, align: 'right' },
    { key: 'renterDue', label: 'Renter due', value: (r) => r.money.renterAmountDue, align: 'right', render: (r) => <Money value={r.money.renterAmountDue} /> },
    { key: 'companyDue', label: 'Company due', value: (r) => r.money.companyAmountDue, align: 'right', render: (r) => <Money value={r.money.companyAmountDue} /> },
    { key: 'due', label: 'Amount due', value: (r) => r.money.totalAmountDue, align: 'right', bar: true, render: (r) => <Money value={r.money.totalAmountDue} estimated={r.money.estimated} /> },
    { key: 'loc', label: 'Loc', value: (r) => r.location },
  ], [today]);

  const { sorted, sort, toggle } = useSort(rows, columns, { key: 'days', dir: 'desc' });
  const total = rows.reduce((s, r) => s + Math.max(r.money.totalAmountDue, 0), 0);

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Overdue rentals"
        subtitle={`Still out and past the scheduled drop-off date (${today}, ${rules.timezone})`}
        right={<button className="btn btn-sm" onClick={() => downloadText(`overdue_${today}.csv`, rowsToCsv(sorted, columns))}>Export CSV</button>}
      />
      <div className="strip mb-5">
        <Kpi label="Overdue rentals" value={rows.length} tone={rows.length ? 'critical' : undefined} />
        <Kpi label="Amount due" value={money(total, { compact: true })} tone={total > 0 ? 'serious' : undefined} />
        <Kpi label="Customer-paid" value={rows.filter((r) => r.payerType === 'customer' || r.payerType === 'mixed').length} />
        <Kpi label="Oldest" value={rows.length ? `${Math.max(...rows.map((r) => daysOverdue(r, today) ?? 0))} days` : '—'} />
      </div>
      <div className="no-print mb-3 flex flex-wrap gap-2">
        <select className="select" value={payer} onChange={(e) => setPayer(e.target.value)}><option value="">All payers</option>{Object.entries(PAYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="select" value={insurer} onChange={(e) => setInsurer(e.target.value)}><option value="">All insurers</option>{insurers.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="select" value={shop} onChange={(e) => setShop(e.target.value)}><option value="">All body shops</option>{shops.map((s) => <option key={s}>{s}</option>)}</select>
        <input className="input w-36" type="number" min={1} placeholder="Min days overdue" value={minDays} onChange={(e) => setMinDays(e.target.value)} />
      </div>
      <div className="sheet">
        <DataTable rows={sorted} columns={columns} rowKey={(r) => r.raNumber} onRowClick={(r) => openRental(r.raNumber)} sort={sort} onSort={toggle} empty="No overdue rentals" />
      </div>
    </div>
  );
}

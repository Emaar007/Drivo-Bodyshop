import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: ReactNode;
  value: (row: T) => string | number | null | undefined; // sort / csv value
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
  csvLabel?: string;
  /** Draw a 2px inline bar under the value showing its share of the column's maximum (money columns). */
  bar?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export function useSort<T>(rows: T[], columns: Column<T>[], initial: SortState | null) {
  const [sort, setSort] = useState<SortState | null>(initial);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === vb) return 0;
      if (va === null || va === undefined || va === '') return 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
    });
  }, [rows, columns, sort]);
  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  return { sorted, sort, setSort, toggle };
}

export function DataTable<T>({
  rows, columns, rowKey, onRowClick, sort, onSort, empty = 'Nothing to show', maxHeight, footer,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: SortState | null;
  onSort?: (key: string) => void;
  empty?: string;
  maxHeight?: string;
  footer?: ReactNode;
}) {
  const maxima = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of columns) {
      if (!c.bar) continue;
      m[c.key] = rows.reduce((mx, r) => { const v = c.value(r); return typeof v === 'number' && v > mx ? v : mx; }, 0);
    }
    return m;
  }, [rows, columns]);
  const cell = (c: Column<T>, r: T) => {
    const content = c.render ? c.render(r) : c.value(r) ?? '-';
    if (!c.bar) return content;
    const v = c.value(r);
    const share = typeof v === 'number' && maxima[c.key] > 0 ? Math.max(0, v) / maxima[c.key] : 0;
    return (
      <div className="flex flex-col items-end gap-1">
        <span>{content}</span>
        <span className="block h-0.5 w-16 overflow-hidden bg-line" aria-hidden="true"><span className="block h-full bg-brand-bright" style={{ width: `${Math.round(share * 100)}%` }} /></span>
      </div>
    );
  };
  return (
    <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width, textAlign: c.align ?? 'left' }}
                className={onSort ? 'sortable' : ''}
                onClick={onSort ? () => onSort(c.key) : undefined}
                aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  {sort?.key === c.key && <span className="text-accent">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-ink-3">{empty}</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'cursor-pointer' : ''}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? 'left' }} className={c.align === 'right' ? 'num' : ''}>
                  {cell(c, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export function rowsToCsv<T>(rows: T[], columns: Column<T>[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.csvLabel ?? (typeof c.label === 'string' ? c.label : c.key))).join(',');
  return [head, ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))].join('\n');
}

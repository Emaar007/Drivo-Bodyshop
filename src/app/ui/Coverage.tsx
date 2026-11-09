// Insurance coverage at a glance: "21 / 30 days, 9 left, $30/day" with a thin bar.
// Amber when 3 days or fewer remain (or not verified yet), red when exhausted while out, denied, or past the
// verification deadline. Nothing is rendered for out-of-pocket rentals.
import type { Coverage } from '@shared/types';
import { coverageText } from '@shared/coverage';
import { formatDate } from '../format';
import { Tooltip } from './primitives';

const TONE = { none: 'text-text2', ok: 'text-text1', warn: 'text-warn', danger: 'text-danger' } as const;
const BAR = { none: 'bg-text2', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' } as const;

export function CoverageMeter({ coverage, compact = false }: { coverage: Coverage; compact?: boolean }) {
  if (!coverage.applies) return null;
  const text = coverageText(coverage);
  const share = coverage.coveredDays ? Math.min(1, coverage.daysUsed / coverage.coveredDays) : coverage.status === 'verified' ? 1 : 0;
  const detail = (
    <div className="flex max-w-xs flex-col gap-0.5">
      <span>{text}</span>
      {coverage.deadline && coverage.status === 'not_verified' && <span className="text-text1">Verify by {formatDate(coverage.deadline)}</span>}
      {coverage.verifiedAt && <span className="text-text1">Noted {formatDate(coverage.verifiedAt, { time: true })}{coverage.verifiedBy ? ` by ${coverage.verifiedBy}` : ''}</span>}
      {coverage.extensionDays > 0 && <span className="text-text1">Includes {coverage.extensionDays} extension days</span>}
      {coverage.note && <span className="text-text2">"{coverage.note.slice(0, 220)}"</span>}
    </div>
  );
  return (
    <Tooltip label={detail}>
      <span className={`inline-flex min-w-0 flex-col gap-1 ${compact ? '' : 'w-full max-w-[220px]'}`}>
        <span className={`num truncate text-[11.5px] ${TONE[coverage.level]}`}>{text}</span>
        {(coverage.status === 'verified' || coverage.status === 'verified_days_unknown') && (
          <span className="block h-0.5 w-full max-w-[160px] overflow-hidden bg-line" aria-hidden="true">
            <span className={`block h-full ${BAR[coverage.level]}`} style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
        )}
      </span>
    </Tooltip>
  );
}

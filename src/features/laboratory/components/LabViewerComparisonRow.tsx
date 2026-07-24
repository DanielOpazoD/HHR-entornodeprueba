import React from 'react';
import clsx from 'clsx';
import { Pin } from 'lucide-react';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import { COMPARISON_PINNABLE_VARIABLES } from '../constants/labComparisonPreferenceConstants';
import { formatLabResult, isOutOfRange } from '../controllers/labFormattingController';
import { resolveQualitativeComparisonAlert } from '../controllers/labComparisonTableController';

interface LabViewerComparisonRowProps {
  name: string;
  examDates: string[];
  data: LabAnalysisData;
  index: number;
  isPinned: boolean;
  onTogglePin: (name: string) => void;
}

export const LabViewerComparisonRow: React.FC<LabViewerComparisonRowProps> = ({
  name,
  examDates,
  data,
  index,
  isPinned,
  onTogglePin,
}) => {
  const canPin = COMPARISON_PINNABLE_VARIABLES.includes(name);

  return (
    <tr
      className={clsx(
        'border-t border-slate-100 hover:bg-slate-50/60',
        index % 2 === 1 && 'bg-slate-50/20'
      )}
    >
      <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-2 py-1 text-[9px] text-slate-700">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-semibold">{name}</span>
          {canPin ? (
            <button
              type="button"
              onClick={() => onTogglePin(name)}
              title={isPinned ? `Desanclar ${name}` : `Anclar ${name}`}
              className={clsx(
                'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-md border transition-colors',
                isPinned
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-slate-600'
              )}
            >
              <Pin size={11} className={clsx(isPinned && 'fill-current')} />
            </button>
          ) : null}
        </div>
      </td>
      {examDates.map(date => {
        const row = data.comparison[name]?.[date];
        if (!row) {
          return (
            <td key={date} className="px-1 py-1 text-center text-[9px] text-slate-300">
              --
            </td>
          );
        }

        if (row.qualitative) {
          const hasAlert = resolveQualitativeComparisonAlert(row.result);
          return (
            <td key={date} className="px-1 py-1 text-center whitespace-nowrap">
              <span
                className={clsx(
                  'text-[9px] font-semibold',
                  hasAlert ? 'text-red-600' : 'text-slate-700'
                )}
              >
                {row.result.length > 20 ? `${row.result.substring(0, 20)}…` : row.result}
              </span>
            </td>
          );
        }

        const outOfRange = isOutOfRange(row.result, row.refValue, { unit: row.unit });
        const { display } = formatLabResult(row.result, row.unit);
        return (
          <td key={date} className="px-1 py-1 text-center whitespace-nowrap">
            <span
              className={clsx(
                'text-[10px] font-semibold',
                outOfRange === true ? 'text-red-600' : 'text-slate-700'
              )}
            >
              {display}
            </span>
          </td>
        );
      })}
    </tr>
  );
};

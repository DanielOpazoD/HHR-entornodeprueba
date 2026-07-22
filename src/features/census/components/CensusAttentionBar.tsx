/** Compact shortcut for the only actionable surveillance task: scales due for reapplication. */

import React, { useMemo } from 'react';
import { AlarmClock } from 'lucide-react';
import {
  buildCensusAttentionSummary,
  type CensusAttentionFilter,
  type CensusAttentionSummary,
} from '@/features/census/controllers/rowAcuityController';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';

interface CensusAttentionBarProps {
  beds: Record<string, PatientData>;
  censusIsoDay: string;
  activeFilter?: CensusAttentionFilter;
  onFilterChange?: (filter: CensusAttentionFilter) => void;
}

const scaleLabel = (count: number): string => `${count} ${count === 1 ? 'escala' : 'escalas'}`;

export const CensusAttentionBar: React.FC<CensusAttentionBarProps> = ({
  beds,
  censusIsoDay,
  activeFilter = 'all',
  onFilterChange,
}) => {
  const summary: CensusAttentionSummary = useMemo(
    () => buildCensusAttentionSummary(beds, censusIsoDay),
    [beds, censusIsoDay]
  );

  if (summary.scale === 0 && activeFilter !== 'scale') return null;
  const active = activeFilter === 'scale';

  return (
    <div
      role="group"
      aria-label="Vigilancia de escalas"
      data-testid="census-attention-bar"
      className="ml-0 inline-flex shrink-0 items-center border-l border-slate-200 pl-1.5"
    >
      <button
        type="button"
        aria-pressed={active}
        aria-label={`${scaleLabel(summary.scale)} por reaplicar. ${active ? 'Mostrar censo completo' : 'Mostrar solo pacientes con escalas por reaplicar'}`}
        data-testid="census-attention-filter-scale"
        onClick={() => onFilterChange?.(active ? 'all' : 'scale')}
        className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 ${
          active
            ? 'border-amber-400 bg-amber-100 text-amber-800'
            : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700'
        }`}
      >
        <AlarmClock
          size={12}
          strokeWidth={2.4}
          className={active ? 'text-amber-700' : 'text-amber-600'}
          aria-hidden="true"
        />
        {scaleLabel(summary.scale)}
        <span className="sr-only">por reaplicar</span>
      </button>

      <span className="sr-only" role="status" aria-live="polite">
        {active ? 'Mostrando solo escalas por reaplicar' : 'Mostrando censo completo'}
      </span>
    </div>
  );
};

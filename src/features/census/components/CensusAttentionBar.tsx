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
      className="ml-auto inline-flex shrink-0 items-center"
    >
      <button
        type="button"
        aria-pressed={active}
        aria-label={`${scaleLabel(summary.scale)} por reaplicar. ${active ? 'Mostrar censo completo' : 'Mostrar solo pacientes con escalas por reaplicar'}`}
        data-testid="census-attention-filter-scale"
        onClick={() => onFilterChange?.(active ? 'all' : 'scale')}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold tabular-nums shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 ${
          active
            ? 'border-amber-400 bg-amber-100 text-amber-800'
            : 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100'
        }`}
      >
        <AlarmClock size={14} strokeWidth={2.4} aria-hidden="true" />
        {scaleLabel(summary.scale)}
        <span className="sr-only">por reaplicar</span>
      </button>

      <span className="sr-only" role="status" aria-live="polite">
        {active ? 'Mostrando solo escalas por reaplicar' : 'Mostrando censo completo'}
      </span>
    </div>
  );
};

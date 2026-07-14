/**
 * Census triage bar — a compact "requieren atención" summary that turns the table into a glance:
 * how many occupied rows need attention right now, broken down by kind (escala de riesgo por
 * reaplicar, aislamiento). Vital signs are intentionally NOT a source (see rowAcuityController).
 * Reuses the SAME per-row acuity the left rail uses, so the bar and the rails always agree. Renders
 * nothing when the census is all-clear.
 */

import React, { useMemo } from 'react';
import { AlarmClock, Biohazard, Eye, TriangleAlert } from 'lucide-react';
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

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

interface FilterButtonProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
}

const FilterButton: React.FC<FilterButtonProps> = ({ active, icon, label, onClick, testId }) => (
  <button
    type="button"
    aria-pressed={active}
    data-testid={testId}
    onClick={onClick}
    className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current ${
      active
        ? 'border-current bg-white text-current shadow-sm'
        : 'border-transparent bg-white/45 text-current hover:border-current/20 hover:bg-white/80'
    }`}
  >
    {icon}
    {label}
  </button>
);

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

  if (summary.rows === 0 && activeFilter === 'all') return null;

  const isAlert = summary.alertRows > 0;
  const selectFilter = (filter: CensusAttentionFilter): void => {
    onFilterChange?.(activeFilter === filter ? 'all' : filter);
  };

  return (
    <div
      role="group"
      aria-label="Filtros del modo vigilancia"
      data-testid="census-attention-bar"
      className={`inline-flex min-h-14 flex-wrap items-center gap-2 rounded-xl border px-2.5 py-2 text-xs shadow-sm ${
        isAlert
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-amber-200 bg-amber-50 text-amber-700'
      }`}
    >
      <span className="inline-flex items-center gap-1.5 px-1 font-semibold">
        <Eye size={15} strokeWidth={2.5} aria-hidden />
        Vigilancia
      </span>

      {summary.rows > 0 ? (
        <>
          <FilterButton
            active={activeFilter === 'attention'}
            icon={<TriangleAlert size={13} strokeWidth={2.5} aria-hidden />}
            label={plural(summary.rows, 'requiere atención', 'requieren atención')}
            onClick={() => selectFilter('attention')}
            testId="census-attention-filter-all"
          />
          {summary.scale > 0 && (
            <FilterButton
              active={activeFilter === 'scale'}
              icon={<AlarmClock size={13} strokeWidth={2.5} aria-hidden />}
              label={plural(summary.scale, 'escala', 'escalas')}
              onClick={() => selectFilter('scale')}
              testId="census-attention-filter-scale"
            />
          )}
          {summary.isolation > 0 && (
            <FilterButton
              active={activeFilter === 'isolation'}
              icon={<Biohazard size={13} strokeWidth={2.5} aria-hidden />}
              label={plural(summary.isolation, 'aislamiento', 'aislamientos')}
              onClick={() => selectFilter('isolation')}
              testId="census-attention-filter-isolation"
            />
          )}
        </>
      ) : (
        <span className="px-1 font-medium">Ya no hay pacientes en este filtro</span>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {activeFilter === 'all' ? 'Mostrando censo completo' : 'Modo vigilancia activo'}
      </span>
    </div>
  );
};

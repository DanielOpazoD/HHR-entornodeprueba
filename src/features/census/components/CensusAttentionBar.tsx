/**
 * Census triage bar — a compact "requieren atención" summary that turns the table into a glance:
 * how many occupied rows need attention right now, broken down by kind (escala de riesgo por
 * reaplicar, aislamiento). Vital signs are intentionally NOT a source (see rowAcuityController).
 * Reuses the SAME per-row acuity the left rail uses, so the bar and the rails always agree. Renders
 * nothing when the census is all-clear.
 */

import React, { useMemo } from 'react';
import { AlarmClock, Biohazard, TriangleAlert } from 'lucide-react';
import {
  buildCensusAttentionSummary,
  type CensusAttentionSummary,
} from '@/features/census/controllers/rowAcuityController';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';

interface CensusAttentionBarProps {
  beds: Record<string, PatientData>;
  censusIsoDay: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const CountItem: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <span className="inline-flex items-center gap-1 tabular-nums">
    {icon}
    {label}
  </span>
);

export const CensusAttentionBar: React.FC<CensusAttentionBarProps> = ({ beds, censusIsoDay }) => {
  const summary: CensusAttentionSummary = useMemo(
    () => buildCensusAttentionSummary(beds, censusIsoDay),
    [beds, censusIsoDay]
  );

  if (summary.rows === 0) return null;

  const isAlert = summary.alertRows > 0;
  const items: React.ReactNode[] = [];
  if (summary.scale > 0) {
    items.push(
      <CountItem
        key="scale"
        icon={<AlarmClock size={12} strokeWidth={2.5} aria-hidden />}
        label={plural(summary.scale, 'escala por reaplicar', 'escalas por reaplicar')}
      />
    );
  }
  if (summary.isolation > 0) {
    items.push(
      <CountItem
        key="isolation"
        icon={<Biohazard size={12} strokeWidth={2.5} aria-hidden />}
        label={plural(summary.isolation, 'aislamiento', 'aislamientos')}
      />
    );
  }

  return (
    <div
      role="status"
      data-testid="census-attention-bar"
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
        isAlert
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-amber-200 bg-amber-50 text-amber-700'
      }`}
    >
      <TriangleAlert size={15} strokeWidth={2.5} className="shrink-0" aria-hidden />
      <span className="font-semibold">
        {plural(summary.rows, 'paciente requiere atención', 'pacientes requieren atención')}
      </span>
      {items.length > 0 && (
        <span className="flex items-center gap-2 border-l border-current/20 pl-2 opacity-90">
          {items.map((item, index) => (
            <React.Fragment key={index}>
              {index > 0 && <span className="opacity-40">·</span>}
              {item}
            </React.Fragment>
          ))}
        </span>
      )}
    </div>
  );
};

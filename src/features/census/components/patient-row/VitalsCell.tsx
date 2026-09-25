/**
 * "Signos vitales" census column — the latest vitals synced from Ficha Médico, shown as a compact
 * PA · FC · SAT · T° grid with fixed positions and explicit warning marks. Clicking opens the vitals detail
 * modal (FR, EVA, observations). Read-only: Ficha Médico is the source of truth.
 */

import React, { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { BaseCellProps } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { VitalsDetailModal } from './VitalsDetailModal';
import { CellSyncIndicator } from './CellSyncIndicator';
import {
  buildVitalSignsView,
  type VitalReadingView,
  type VitalStatus,
} from '@/features/census/controllers/vitalSignsView';
import { resolveVitalSignsProfile } from '@/utils/vitalSignsProfileResolver';
import { useRayenFillStatus } from '@/features/rayen-import/census-status';

/** The four readings surfaced inline in the census cell (the rest live in the modal). */
const CELL_READINGS: ReadonlyArray<{ key: VitalReadingView['key']; label: string }> = [
  { key: 'pa', label: 'PA' },
  { key: 'fc', label: 'FC' },
  { key: 'spo2', label: 'SAT' },
  { key: 'temp', label: 'T°' },
];

// Same semantic tones as ScaleChip's value zone, so SIGNOS and SCORES read as one visual system.
const STATUS_TEXT: Record<VitalStatus, string> = {
  neutral: 'text-slate-500',
  normal: 'text-slate-600',
  warn: 'text-amber-600',
  alert: 'text-red-600',
};

export const VitalsCell: React.FC<BaseCellProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
}) => {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const isFilling = useRayenFillStatus();

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 relative" />;
  }

  const vitalProfile = resolveVitalSignsProfile({
    age: data.age,
    birthDate: data.birthDate,
    referenceDate: data.vitalSigns?.recordedDate,
  });
  const vitals = buildVitalSignsView(data.vitalSigns, vitalProfile);
  const readingByKey = (key: VitalReadingView['key']): VitalReadingView | undefined =>
    vitals?.readings.find(reading => reading.key === key);
  const abnormalReadings = vitals?.readings.filter(
    reading => reading.status === 'warn' || reading.status === 'alert'
  );
  const abnormalLabels = abnormalReadings?.map(
    reading => CELL_READINGS.find(({ key }) => key === reading.key)?.label ?? reading.label
  ) ?? [];

  return (
    <td className="py-0.5 px-1 border-r border-slate-200 relative">
      {/* Syncing feedback over existing readings too (a re-sync of a patient who already has vitals). */}
      {isFilling && vitals && <CellSyncIndicator />}
      {vitals ? (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            setIsDetailOpen(true);
          }}
          className="flex w-full cursor-pointer items-center rounded-md px-0.5 py-1 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-700"
          title={`Signos vitales (${vitals.recordedAt}) — ver detalle`}
          aria-label="Ver signos vitales"
          aria-description={abnormalLabels.length
            ? `Fuera de rango: ${abnormalLabels.join(', ')}`
            : undefined}
        >
          <span className="census-vitals-grid grid w-full grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-x-1 gap-y-0.5 text-left leading-tight tabular-nums">
            {CELL_READINGS.map(({ key, label }) => {
              const reading = readingByKey(key);
              const abnormal = reading?.status === 'warn' || reading?.status === 'alert';
              return (
                <span
                  key={key}
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-0.5 whitespace-nowrap text-[10px]"
                  title={
                    reading
                      ? `${label}: ${reading.value} ${reading.unit}${reading.status === 'warn' || reading.status === 'alert' ? ' · Fuera de rango' : ''}`
                      : `${label}: sin dato`
                  }
                >
                  <span className="font-medium text-slate-500">{label}</span>
                  <span className={`inline-flex min-w-0 items-center justify-end gap-0.5 font-semibold ${reading ? STATUS_TEXT[reading.status] : 'text-slate-300'}`}>
                    {reading ? reading.value : '—'}
                    {abnormal && <TriangleAlert size={9} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />}
                  </span>
                </span>
              );
            })}
          </span>
        </button>
      ) : isFilling ? (
        <div
          className="census-vitals-grid grid grid-cols-2 gap-x-1 gap-y-0.5 text-[10px] tabular-nums"
          title="Sincronizando signos vitales desde Rayen…"
          aria-label="Cargando signos vitales"
        >
          {CELL_READINGS.map(({ key, label }) => (
            <span key={key} className="flex items-center justify-between gap-0.5 text-slate-500">
              {label}<span aria-hidden="true" className="h-2 w-5 rounded bg-slate-100" />
            </span>
          ))}
        </div>
      ) : (
        <div
          className="census-vitals-grid grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-x-1 gap-y-0.5 select-none text-[10px] text-slate-400 tabular-nums"
          title="Sin signos vitales"
        >
          {CELL_READINGS.map(({ key, label }) => (
            <span key={key} className="flex justify-between gap-0.5">
              <span>{label}</span><span className="text-slate-300">—</span>
            </span>
          ))}
        </div>
      )}

      {isDetailOpen && vitals && (
        <VitalsDetailModal
          patientName={data.patientName}
          vitals={vitals}
          history={
            data.vitalSignsHistory?.length
              ? data.vitalSignsHistory
              : data.vitalSigns
                ? [data.vitalSigns]
                : []
          }
          age={data.age}
          birthDate={data.birthDate}
          profile={vitalProfile}
          onClose={() => setIsDetailOpen(false)}
        />
      )}
    </td>
  );
};

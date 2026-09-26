/**
 * "Signos vitales" census column — the latest vitals synced from Ficha Médico, shown as a compact
 * PA · FC · SAT · T° grid with fixed positions. Clicking opens the vitals detail
 * modal (FR, EVA, observations). Read-only: Ficha Médico is the source of truth.
 */

import React, { useState } from 'react';
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

const STATUS_TEXT: Record<VitalStatus, string> = {
  neutral: 'text-slate-500',
  normal: 'text-slate-600',
  warn: 'text-amber-600',
  alert: 'text-red-600',
};

const GRID_CLASS =
  'census-vitals-grid mx-auto grid w-full max-w-[144px] grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-x-1 gap-y-0.5 px-0.5 text-left text-[10px] leading-tight tabular-nums';
const READING_CLASS =
  'grid min-w-0 grid-cols-[18px_minmax(0,1fr)] items-baseline whitespace-nowrap';

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
          className="flex w-full cursor-pointer items-center rounded-md py-1 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-700"
          aria-label="Ver signos vitales"
        >
          <span className={GRID_CLASS}>
            {CELL_READINGS.map(({ key, label }) => {
              const reading = readingByKey(key);
              return (
                <span key={key} className={READING_CLASS}>
                  <span className="font-medium text-slate-500">{label}</span>
                  <span
                    className={`inline-flex min-w-0 items-center justify-center font-semibold ${reading ? STATUS_TEXT[reading.status] : 'text-slate-300'}`}
                  >
                    {reading ? reading.value : '—'}
                  </span>
                </span>
              );
            })}
          </span>
        </button>
      ) : isFilling ? (
        <div className={GRID_CLASS} aria-label="Cargando signos vitales">
          {CELL_READINGS.map(({ key, label }) => (
            <span key={key} className={READING_CLASS}>
              <span className="text-slate-500">{label}</span>
              <span aria-hidden="true" className="mx-auto h-2 w-4 rounded bg-slate-100" />
            </span>
          ))}
        </div>
      ) : (
        <div className={GRID_CLASS}>
          {CELL_READINGS.map(({ key, label }) => (
            <span key={key} className={READING_CLASS}>
              <span className="text-slate-400">{label}</span>
              <span className="text-center text-slate-300">—</span>
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

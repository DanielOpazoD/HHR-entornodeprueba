/**
 * "Signos vitales" census column — the latest vitals synced from Ficha Médico, shown as a compact
 * PA · FC · SAT · T° grid colored per reading (normal/warn/alert). Clicking opens the vitals detail
 * modal (FR, EVA, observations). Read-only: Ficha Médico is the source of truth.
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { Activity } from 'lucide-react';
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
import { useRayenFillStatus } from '@/features/rayen-import';

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

const WORST_ACCENT: Record<VitalStatus, string> = {
  neutral: 'border-l-slate-200',
  normal: 'border-l-transparent',
  warn: 'border-l-amber-400',
  alert: 'border-l-red-500',
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
          className={clsx(
            'flex w-full cursor-pointer items-center gap-1 rounded border-l-2 bg-white/40 pl-1',
            WORST_ACCENT[vitals.worst]
          )}
          title={`Signos vitales (${vitals.recordedAt}) — ver detalle`}
          aria-label="Ver signos vitales"
        >
          <Activity size={10} strokeWidth={2.5} className="shrink-0 text-slate-400" />
          <span className="grid flex-1 grid-cols-2 gap-x-1.5 text-left leading-tight">
            {CELL_READINGS.map(({ key, label }) => {
              const reading = readingByKey(key);
              return (
                <span key={key} className="flex items-baseline gap-0.5 truncate text-[10px]">
                  <span className="font-medium text-slate-400">{label}</span>
                  <span
                    className={clsx(
                      'font-semibold tabular-nums',
                      reading ? STATUS_TEXT[reading.status] : 'text-slate-300'
                    )}
                  >
                    {reading ? reading.value : '—'}
                  </span>
                </span>
              );
            })}
          </span>
        </button>
      ) : isFilling ? (
        <div
          className="flex flex-col gap-0.5 animate-pulse"
          title="Sincronizando signos vitales desde Rayen…"
          aria-label="Cargando signos vitales"
        >
          <span className="h-2.5 rounded bg-slate-200" />
          <span className="h-2.5 w-2/3 rounded bg-slate-200" />
        </div>
      ) : (
        <div
          className="select-none text-center text-[9px] text-slate-300"
          title="Sin signos vitales"
        >
          —
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

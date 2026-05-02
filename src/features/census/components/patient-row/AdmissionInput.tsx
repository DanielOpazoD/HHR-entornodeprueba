/**
 * AdmissionInput — Admission date/time input cell for the census table.
 *
 * Behaviour summary:
 *  - **Read-only** in the census table. Admission date/time edition now lives
 *    in the demographics modal to keep a single operational path.
 *  - **Tooltip** on hover shows the admission time (e.g. "Hora de ingreso: 14:30")
 *    or "Hora de ingreso: no registrada" if the time was never set.
 *  - Uses `cursor-default` to override the drag-and-drop grab cursor,
 *    ensuring the native tooltip is visible on hover.
 */

import React from 'react';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import {
  resolveAdmissionDateAudit,
  resolveAdmissionDateOptions,
  resolveAdmissionTooltip,
  resolveIsCriticalAdmissionEmpty,
} from '@/features/census/controllers/admissionInputController';

interface AdmissionInputProps extends BaseCellProps {
  currentDateString: string;
  isNewAdmission?: boolean;
  onChange: DebouncedTextHandler;
  onMultipleUpdate?: (fields: Partial<PatientData>) => void;
}

export const AdmissionInput: React.FC<AdmissionInputProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  currentDateString,
  isNewAdmission = false,
}) => {
  const isCriticalEmpty = resolveIsCriticalAdmissionEmpty(data.patientName, data.admissionDate);
  const audit = resolveAdmissionDateAudit({
    recordDate: currentDateString,
    admissionDate: data.admissionDate,
    admissionTime: data.admissionTime,
    firstSeenDate: data.firstSeenDate,
  });
  const admissionDateOptions = React.useMemo(
    () => resolveAdmissionDateOptions(currentDateString, data.admissionDate),
    [currentDateString, data.admissionDate]
  );
  const isAdmissionDateSuspicious = isNewAdmission && audit.isSuspicious && !isCriticalEmpty;
  const selectedAdmissionLabel =
    admissionDateOptions.find(option => option.value === (data.admissionDate || ''))?.label || '--';

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 w-32" />;
  }

  return (
    <td
      className="py-0.5 px-1 border-r border-slate-200 w-32"
      title={!isCriticalEmpty ? resolveAdmissionTooltip(data.admissionTime) : undefined}
    >
      <div className="w-full relative">
        <div
          className={clsx(
            'w-full h-7 border rounded text-[11px] leading-none flex items-center bg-white px-1.5 cursor-default',
            isCriticalEmpty
              ? 'border-red-400 border-2 bg-red-50'
              : isAdmissionDateSuspicious
                ? 'border-amber-400 border-2 bg-amber-50'
                : 'border-slate-300',
            isSubRow && 'h-6'
          )}
          title={
            isCriticalEmpty
              ? 'Campo crítico requerido para entrega'
              : isAdmissionDateSuspicious
                ? `${audit.message || 'Fecha sospechosa'}${audit.suggestedAdmissionDate ? ` Sugerida: ${audit.suggestedAdmissionDate}` : ''}`
                : resolveAdmissionTooltip(data.admissionTime)
          }
        >
          <span className="truncate">{selectedAdmissionLabel}</span>
        </div>
        {isCriticalEmpty && (
          <div
            className="absolute -right-1 -top-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center z-20"
            title="Campo crítico vacío"
          >
            <AlertCircle size={8} className="text-white" />
          </div>
        )}
      </div>
    </td>
  );
};

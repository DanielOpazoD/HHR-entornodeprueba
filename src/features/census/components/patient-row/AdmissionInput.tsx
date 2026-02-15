/**
 * AdmissionInput - Admission date/time input (critical field)
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { PatientData } from '@/types';
import { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import {
  resolveAdmissionDateChange,
  resolveAdmissionDateMax,
  resolveIsCriticalAdmissionEmpty,
} from '@/features/census/controllers/admissionInputController';

interface AdmissionInputProps extends BaseCellProps {
  onChange: DebouncedTextHandler;
  onMultipleUpdate?: (fields: Partial<PatientData>) => void;
}

export const AdmissionInput: React.FC<AdmissionInputProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  onChange,
  onMultipleUpdate,
}) => {
  const [showTime, setShowTime] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isCriticalEmpty = resolveIsCriticalAdmissionEmpty(data.patientName, data.admissionDate);

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 w-28" />;
  }

  const handleDateChange = (val: string) => {
    const resolution = resolveAdmissionDateChange({
      nextDate: val,
      currentAdmissionTime: data.admissionTime,
    });

    if (resolution.shouldPatchMultiple && onMultipleUpdate) {
      onMultipleUpdate({
        admissionDate: resolution.admissionDate,
        admissionTime: resolution.admissionTime,
      });
      return;
    }

    onChange('admissionDate')(resolution.admissionDate);
  };

  return (
    <td
      className="py-0.5 px-1 border-r border-slate-200 w-28"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="w-full relative"
        onFocusCapture={() => setShowTime(true)}
        onBlur={event => {
          const next = event.relatedTarget as HTMLElement | null;
          if (next && event.currentTarget.contains(next)) return;
          setShowTime(false);
        }}
      >
        <DebouncedInput
          type="date"
          max={resolveAdmissionDateMax()}
          className={clsx(
            'w-full p-0.5 h-7 border rounded focus:ring-2 focus:outline-none text-xs',
            isHovered || showTime ? 'show-calendar-icon' : 'hide-calendar-icon',
            isCriticalEmpty
              ? 'border-red-400 border-2 bg-red-50 focus:ring-red-200 focus:border-red-500'
              : 'border-slate-300 focus:ring-medical-500',
            isSubRow && 'h-6'
          )}
          value={data.admissionDate || ''}
          onChange={handleDateChange}
          onClick={() => setShowTime(true)}
          disabled={readOnly}
          title={isCriticalEmpty ? 'Campo crítico requerido para entrega' : undefined}
        />
        {/* Critical field warning icon */}
        {isCriticalEmpty && (
          <div
            className="absolute -right-1 -top-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center z-20"
            title="Campo crítico vacío"
          >
            <AlertCircle size={8} className="text-white" />
          </div>
        )}
        {/* Time input popup */}
        {showTime && (
          <DebouncedInput
            type="time"
            step={300}
            className="w-24 p-0.5 h-7 border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 focus:outline-none text-xs absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-white shadow-lg z-30"
            value={data.admissionTime || ''}
            onChange={onChange('admissionTime')}
            disabled={readOnly}
          />
        )}
      </div>
    </td>
  );
};

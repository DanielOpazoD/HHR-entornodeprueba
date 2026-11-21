/**
 * NameInput - Patient name input cell
 */

import React from 'react';
import clsx from 'clsx';
import { ArrowRight, Baby } from 'lucide-react';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';
import { resolveNameInputState } from './nameInputController';

interface NameInputProps extends BaseCellProps {
  onChange: DebouncedTextHandler;
}

export const NameInput: React.FC<NameInputProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  onChange,
}) => {
  const { fullName, canEditInlineName } = resolveNameInputState({
    data,
    isSubRow,
    isEmpty,
    readOnly,
  });
  const handlePatientNameChange = canEditInlineName ? onChange('patientName') : () => undefined;

  const hasValidationError =
    Boolean(fullName) && !PatientInputSchema.shape.patientName.safeParse(fullName).success;

  return (
    <td className="py-0.5 px-1 border-r border-slate-200 w-[180px]">
      <div className="relative">
        {isSubRow && (
          <div className="absolute left-[-15px] top-2 text-slate-300">
            <ArrowRight size={14} />
          </div>
        )}
        <DebouncedInput
          type="text"
          name="patientName"
          className={clsx(
            'w-full p-0.5 h-7 border rounded transition-all duration-200 text-[13px] font-medium',
            canEditInlineName
              ? 'bg-white text-slate-800 focus:ring-2 focus:ring-pink-200 focus:border-pink-400'
              : 'bg-slate-50 text-slate-700 cursor-default',
            isSubRow ? 'border-pink-100 text-xs h-6' : 'border-slate-200',
            hasValidationError && 'border-red-400 bg-red-50/50 text-red-700'
          )}
          placeholder={isSubRow ? 'Nombre RN / Niño' : isEmpty ? '' : 'Nombre Paciente'}
          value={fullName}
          readOnly={!canEditInlineName}
          onChange={handlePatientNameChange}
          debounceMs={350}
        />
        {isSubRow && (
          <span className="absolute right-2 top-2 text-pink-400 pointer-events-none">
            <Baby size={12} />
          </span>
        )}
      </div>
    </td>
  );
};

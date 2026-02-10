/**
 * NameInput - Patient name input cell
 */

import React from 'react';
import clsx from 'clsx';
import { ArrowRight, Baby } from 'lucide-react';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';

interface NameInputProps extends BaseCellProps {
    onChange: DebouncedTextHandler;
}

export const NameInput: React.FC<NameInputProps> = ({
    data,
    isSubRow = false,
    isEmpty = false,
    readOnly = false,
    onChange
}) => {
    const hasValidationError = !PatientInputSchema.pick({ patientName: true })
        .safeParse({ patientName: data.patientName }).success && !!data.patientName;

    return (
        <td className="py-0.5 px-1 border-r border-slate-200 w-[110px]">
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
                        "w-full p-0.5 h-7 border rounded transition-all duration-200 focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 focus:outline-none text-[13px] font-medium",
                        isSubRow ? "border-pink-100 bg-white text-xs h-6" : "border-slate-200 bg-white",
                        hasValidationError && "border-red-400 focus:border-red-500 focus:ring-red-100"
                    )}
                    placeholder={isSubRow ? "Nombre RN / Niño" : (isEmpty ? "" : "Nombre Paciente")}
                    value={data.patientName || ''}
                    onChange={onChange('patientName')}
                    disabled={readOnly}
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

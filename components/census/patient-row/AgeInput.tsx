/**
 * AgeInput - Age display cell (read-only, opens demographics modal)
 */

import React from 'react';
import clsx from 'clsx';
import { PatientInputSchema } from '../../../schemas/inputSchemas';
import { BaseCellProps } from './inputCellTypes';

interface AgeInputProps extends BaseCellProps {
    onOpenDemographics: () => void;
}

export const AgeInput: React.FC<AgeInputProps> = ({
    data,
    isSubRow = false,
    isEmpty = false,
    onOpenDemographics
}) => {
    const hasValidationError = !PatientInputSchema.pick({ age: true })
        .safeParse({ age: data.age }).success && !!data.age;

    if (isEmpty && !isSubRow) {
        return (
            <td className="py-0.5 px-1 border-r border-slate-200 w-14 relative">
                <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">
                    -
                </div>
            </td>
        );
    }

    return (
        <td className="py-0.5 px-1 border-r border-slate-200 w-14 relative">
            <input
                type="text"
                className={clsx(
                    "w-full h-7 px-1 border border-slate-200 bg-slate-50 text-slate-600 rounded text-center cursor-pointer font-bold text-xs transition-all",
                    isSubRow && "h-6",
                    hasValidationError && "border-red-400 bg-red-50 text-red-700"
                )}
                placeholder="Edad"
                value={data.age || ''}
                readOnly
                onClick={onOpenDemographics}
            />
        </td>
    );
};

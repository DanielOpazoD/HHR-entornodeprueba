/**
 * CheckboxCell - Generic checkbox cell for boolean fields
 */

import React from 'react';
import { BaseCellProps, CheckHandler } from './inputCellTypes';
import { PatientData } from '../../../types';

interface CheckboxCellProps extends BaseCellProps {
    field: keyof PatientData;
    onChange: CheckHandler;
    title: string;
    colorClass?: string;
    isLastColumn?: boolean;
}

export const CheckboxCell: React.FC<CheckboxCellProps> = ({
    data,
    isSubRow = false,
    isEmpty = false,
    readOnly = false,
    field,
    onChange,
    title,
    colorClass = "text-slate-600",
    isLastColumn = false
}) => {
    const cellClasses = isLastColumn
        ? "p-0.5 text-center w-10"
        : "p-0.5 border-r border-slate-200 text-center w-10";

    if (isEmpty && !isSubRow) {
        return (
            <td className={cellClasses}>
                <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">
                    -
                </div>
            </td>
        );
    }

    return (
        <td className={cellClasses}>
            <input
                type="checkbox"
                checked={Boolean(data[field])}
                onChange={onChange(field)}
                className={`w-4 h-4 ${colorClass} rounded`}
                title={title}
                disabled={readOnly}
            />
        </td>
    );
};

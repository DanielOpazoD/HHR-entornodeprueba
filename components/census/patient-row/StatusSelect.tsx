/**
 * StatusSelect - Patient status selector (critical field)
 */

import React from 'react';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';
import { STATUS_OPTIONS } from '../../../constants';
import { BaseCellProps, EventTextHandler } from './inputCellTypes';

interface StatusSelectProps extends BaseCellProps {
    onChange: EventTextHandler;
}

export const StatusSelect: React.FC<StatusSelectProps> = ({
    data,
    isSubRow = false,
    isEmpty = false,
    readOnly = false,
    onChange
}) => {
    const isCriticalEmpty = !data.status && !!data.patientName;

    if (isEmpty && !isSubRow) {
        return (
            <td className="py-0.5 px-1 border-r border-slate-200 w-24">
                <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">
                    -
                </div>
            </td>
        );
    }

    return (
        <td className="py-0.5 px-1 border-r border-slate-200 w-24">
            <div className="relative">
                <select
                    className={clsx(
                        "w-full p-0.5 h-7 border rounded transition-all duration-200 focus:ring-2 focus:outline-none text-xs font-bold uppercase tracking-tighter cursor-pointer",
                        // Critical field warning when empty but has patient
                        isCriticalEmpty && "border-red-400 border-2 bg-red-50 focus:ring-red-200 focus:border-red-500",
                        // Normal status colors
                        data.status === 'Grave' ? "text-red-600 bg-red-50/50 border-slate-200 focus:ring-medical-500/20 focus:border-medical-500" :
                            data.status === 'De cuidado' ? "text-orange-600 bg-orange-50/50 border-slate-200 focus:ring-medical-500/20 focus:border-medical-500" :
                                data.status ? "text-emerald-700 bg-emerald-50/30 border-slate-200 focus:ring-medical-500/20 focus:border-medical-500" :
                                    "border-slate-200 focus:ring-medical-500/20 focus:border-medical-500",
                        isSubRow && "h-6"
                    )}
                    value={data.status || ''}
                    onChange={onChange('status')}
                    disabled={readOnly}
                    title={isCriticalEmpty ? "Campo crítico requerido para entrega" : undefined}
                >
                    <option value="">-- Est --</option>
                    {STATUS_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
                {/* Critical field warning icon */}
                {isCriticalEmpty && (
                    <div
                        className="absolute -right-1 -top-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center"
                        title="Campo crítico vacío"
                    >
                        <AlertCircle size={8} className="text-white" />
                    </div>
                )}
            </div>
        </td>
    );
};

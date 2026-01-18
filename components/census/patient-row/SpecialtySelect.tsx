import React from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { SPECIALTY_OPTIONS } from '../../../constants';
import { BaseCellProps, EventTextHandler } from './inputCellTypes';

interface SpecialtySelectProps extends BaseCellProps {
    onChange: EventTextHandler;
}

export const SpecialtySelect: React.FC<SpecialtySelectProps> = ({
    data,
    isSubRow = false,
    isEmpty = false,
    readOnly = false,
    onChange
}) => {
    const isOther = data.specialty && !SPECIALTY_OPTIONS.includes(data.specialty as any);

    if (isEmpty && !isSubRow) {
        return (
            <td className="py-0.5 px-1 border-r border-slate-200 w-28 text-center">
                <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-[10px] italic">
                    -
                </div>
            </td>
        );
    }

    return (
        <td className="py-0.5 px-1 border-r border-slate-200 w-28 relative group/spec">
            {isOther || data.specialty === 'Otro' ? (
                <div className="relative">
                    <input
                        type="text"
                        className={clsx(
                            "w-full p-0.5 h-7 border border-slate-200 rounded focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 focus:outline-none text-[11px] bg-slate-50 font-medium",
                            isSubRow && "h-6"
                        )}
                        value={data.specialty === 'Otro' ? '' : data.specialty}
                        onChange={(e) => onChange('specialty')(e)}
                        placeholder="Especifique..."
                        autoFocus
                        disabled={readOnly}
                    />
                    {!readOnly && (
                        <button
                            onClick={() => {
                                const syntheticEvent = { target: { value: '' } } as React.ChangeEvent<HTMLInputElement>;
                                onChange('specialty')(syntheticEvent);
                            }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-red-500 bg-white/80 rounded"
                        >
                            <X size={10} />
                        </button>
                    )}
                </div>
            ) : (
                <select
                    className={clsx(
                        "w-full p-0.5 h-7 border border-slate-200 rounded transition-all duration-200 focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 focus:outline-none text-[11px] bg-white cursor-pointer",
                        isSubRow && "h-6"
                    )}
                    value={data.specialty || ''}
                    onChange={onChange('specialty')}
                    disabled={readOnly}
                >
                    <option value="">-- Esp --</option>
                    {SPECIALTY_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}

                </select>
            )}
        </td>
    );
};

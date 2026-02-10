/**
 * DualSpecialtyCell - Wrapper component for primary and secondary specialty
 * 
 * Allows users to:
 * 1. Select a primary specialty (always visible, used for statistics)
 * 2. Optionally add a secondary specialty via "+" button
 * 3. Remove the secondary specialty via "X" button
 */

import React from 'react';
import clsx from 'clsx';
import { Plus, X } from 'lucide-react';
import { SPECIALTY_OPTIONS, SPECIALTY_ABBREVIATIONS } from '@/constants';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { BaseCellProps, EventTextHandler } from './inputCellTypes';

interface DualSpecialtyCellProps extends BaseCellProps {
    onChange: EventTextHandler;
}

export const DualSpecialtyCell: React.FC<DualSpecialtyCellProps> = ({
    data,
    isSubRow = false,
    isEmpty = false,
    readOnly = false,
    onChange
}) => {
    // hasSecondary is true if the field is defined (even if empty string)
    // isDual is true only if BOTH have content
    const hasSecondary = data.secondarySpecialty !== undefined && data.secondarySpecialty !== null;
    const isDual = !!data.specialty && !!data.secondarySpecialty;

    // Check if primary specialty is a custom "Otro" value
    const isPrimaryOther = data.specialty && !SPECIALTY_OPTIONS.includes(data.specialty as typeof SPECIALTY_OPTIONS[number]);
    // Check if secondary specialty is a custom "Otro" value
    const isSecondaryOther = hasSecondary && data.secondarySpecialty && !SPECIALTY_OPTIONS.includes(data.secondarySpecialty as any);

    const handleAddSecondary = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const syntheticEvent = { target: { value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>;
        onChange('secondarySpecialty')(syntheticEvent);
    };

    const handleRemoveSecondary = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // We use undefined to signal "remove" in our state/reducer logic
        const syntheticEvent = { target: { value: undefined } } as unknown as React.ChangeEvent<HTMLInputElement>;
        onChange('secondarySpecialty')(syntheticEvent);
    };

    if (isEmpty && !isSubRow) {
        return (
            <td className="py-0.5 px-1 border-r border-slate-200 w-28 text-center">
                <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-[11px] italic">
                    -
                </div>
            </td>
        );
    }

    return (
        <td className="py-0.5 px-1 border-r border-slate-200 w-28 relative group/spec bg-white/50">
            {/* Main Outer Box - Matches "encuadre" of other columns */}
            <div className={clsx(
                "flex items-center w-full px-1 h-7 border rounded transition-all duration-200 bg-white",
                "border-slate-200 group-hover/spec:border-medical-300",
                hasSecondary ? "gap-0" : "gap-0.5"
            )}>
                {/* Primary Specialty Container */}
                <div className="relative flex-1 flex items-center h-full min-w-0">
                    {isPrimaryOther || data.specialty === 'Otro' ? (
                        <div className="relative flex-1 h-full flex items-center">
                            <DebouncedInput
                                type="text"
                                className="w-full p-0 h-5 border-none bg-transparent focus:ring-0 text-[11px] font-medium"
                                value={data.specialty === 'Otro' ? '' : (data.specialty || '')}
                                onChange={(val) => {
                                    const syntheticEvent = { target: { value: val } } as unknown as React.ChangeEvent<HTMLInputElement>;
                                    onChange('specialty')(syntheticEvent);
                                }}
                                placeholder="Esp"
                                disabled={readOnly}
                            />
                        </div>
                    ) : (
                        <div className="relative flex-1 min-w-0 h-full flex items-center">
                            <select
                                className={clsx(
                                    "w-full p-0 h-5 border-none bg-transparent focus:ring-0 text-[11px] font-medium cursor-pointer appearance-none",
                                    data.specialty ? "text-transparent" : "text-slate-400 italic"
                                )}
                                value={data.specialty || ''}
                                onChange={onChange('specialty')}
                                disabled={readOnly}
                            >
                                <option value="" className="text-slate-700">-- Esp --</option>
                                {SPECIALTY_OPTIONS.map(opt => (
                                    <option key={opt} value={opt} className="text-slate-700 font-normal">
                                        {opt}
                                    </option>
                                ))}
                            </select>

                            {/* Visual Label (Primary) */}
                            {data.specialty && (
                                <div className="absolute inset-0 flex items-center pointer-events-none bg-transparent overflow-hidden">
                                    <span className={clsx(
                                        "text-[11px] font-medium truncate",
                                        hasSecondary ? "text-slate-600" : "text-slate-700"
                                    )}>
                                        {hasSecondary ? (SPECIALTY_ABBREVIATIONS[data.specialty] || data.specialty) : data.specialty}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Subtle Overlay Add Button */}
                    {!hasSecondary && !readOnly && data.specialty && (
                        <button
                            onClick={handleAddSecondary}
                            type="button"
                            className="absolute -top-1.5 -right-1.5 p-0.5 opacity-0 group-hover/spec:opacity-100 transition-all hover:bg-medical-100 text-medical-600 rounded-full bg-white shadow-sm z-10 border border-medical-200"
                            title="Añadir co-manejo"
                        >
                            <Plus size={8} />
                        </button>
                    )}
                </div>

                {/* Separator / and Secondary Specialty Section */}
                {hasSecondary && (
                    <div className="flex items-center flex-1 min-w-0 h-full">
                        <span className="text-slate-300 text-[10px] font-bold select-none">/</span>
                        <div className="relative flex-1 min-w-0 h-full flex items-center pl-0.5">
                            {isSecondaryOther || data.secondarySpecialty === 'Otro' ? (
                                <div className="relative flex-1 h-full flex items-center">
                                    <DebouncedInput
                                        type="text"
                                        className="w-full p-0 h-5 border-none bg-transparent focus:ring-0 text-[11px] font-medium text-teal-700"
                                        value={data.secondarySpecialty === 'Otro' ? '' : (data.secondarySpecialty || '')}
                                        onChange={(val) => {
                                            const syntheticEvent = { target: { value: val } } as unknown as React.ChangeEvent<HTMLInputElement>;
                                            onChange('secondarySpecialty')(syntheticEvent);
                                        }}
                                        placeholder="..."
                                        disabled={readOnly}
                                    />
                                </div>
                            ) : (
                                <div className="relative flex-1 min-w-0 h-full flex items-center">
                                    <select
                                        className={clsx(
                                            "w-full p-0 h-5 border-none bg-transparent focus:ring-0 text-[11px] font-medium cursor-pointer appearance-none",
                                            data.secondarySpecialty ? "text-transparent" : "text-teal-400 italic"
                                        )}
                                        value={data.secondarySpecialty || ''}
                                        onChange={onChange('secondarySpecialty')}
                                        disabled={readOnly}
                                    >
                                        <option value="" className="text-teal-700">-- 2ª --</option>
                                        {SPECIALTY_OPTIONS.map(opt => (
                                            <option key={opt} value={opt} className="text-teal-700 font-normal">
                                                {opt}
                                            </option>
                                        ))}
                                    </select>

                                    {/* Visual Label (Secondary) */}
                                    {data.secondarySpecialty && (
                                        <div className="absolute inset-0 flex items-center pointer-events-none bg-transparent overflow-hidden">
                                            <span className="text-[11px] font-medium text-teal-600 truncate">
                                                {SPECIALTY_ABBREVIATIONS[data.secondarySpecialty as string] || data.secondarySpecialty}
                                            </span>
                                        </div>
                                    )}

                                    {/* Remove Secondary Button */}
                                    {!readOnly && (
                                        <button
                                            onClick={handleRemoveSecondary}
                                            type="button"
                                            className="absolute -right-1.5 -top-1.5 p-0.5 opacity-0 group-hover/spec:opacity-100 text-slate-400 hover:text-red-500 transition-all bg-white shadow-sm rounded-full z-10 border border-slate-200"
                                            title="Quitar co-manejo"
                                        >
                                            <X size={8} />
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </td>
    );
};

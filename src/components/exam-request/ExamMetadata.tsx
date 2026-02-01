/**
 * ExamMetadata Component
 * Displays procedencia and prevision selectors for the laboratory request form.
 */

import React from 'react';
import { Check } from 'lucide-react';
import clsx from 'clsx';
import { PROCEDENCIA_OPTIONS, FONASA_LEVELS } from '@/constants/examCategories';

interface ExamMetadataProps {
    procedencia: string;
    prevision: string;
    onProcedenciaChange: (value: string) => void;
    onPrevisionChange: (value: string) => void;
}

export const ExamMetadata: React.FC<ExamMetadataProps> = ({
    procedencia,
    prevision,
    onProcedenciaChange,
    onPrevisionChange
}) => {
    return (
        <div className="flex justify-between items-start gap-4 mb-0.5">
            {/* Procedencia */}
            <div className="flex gap-2 items-center">
                <span className="text-[10px] font-black text-slate-900 uppercase">PROCEDENCIA:</span>
                <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
                    {PROCEDENCIA_OPTIONS.map(p => (
                        <label key={p} className="flex items-center gap-1 cursor-pointer" onClick={() => onProcedenciaChange(p)}>
                            <span className="text-[9px] font-medium text-slate-700">{p}</span>
                            <div className={clsx(
                                "w-3 h-3 border border-slate-900 flex items-center justify-center",
                                procedencia === p ? "bg-medical-600 text-white" : "bg-white"
                            )}>
                                {procedencia === p && <Check size={8} strokeWidth={4} />}
                            </div>
                        </label>
                    ))}
                </div>
            </div>

            {/* Prevision */}
            <div className="flex gap-2 items-start">
                <span className="text-[10px] font-black text-slate-900 uppercase">PREVISION:</span>
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold text-slate-700">FONASA:</span>
                        {FONASA_LEVELS.map(f => (
                            <label key={f} className="flex items-center gap-1 cursor-pointer" onClick={() => onPrevisionChange(`FONASA ${f}`)}>
                                <span className="text-[9px] font-medium text-slate-700">{f}</span>
                                <div className={clsx(
                                    "w-3 h-3 border border-slate-900 flex items-center justify-center",
                                    prevision === `FONASA ${f}` || (prevision === 'Fonasa' && f === 'A') ? "bg-medical-600 text-white" : "bg-white"
                                )}>
                                    {(prevision === `FONASA ${f}` || (prevision === 'Fonasa' && f === 'A')) && <Check size={8} strokeWidth={4} />}
                                </div>
                            </label>
                        ))}
                    </div>
                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1 cursor-pointer">
                            <span className="text-[9px] font-medium text-slate-700 uppercase">ISAPRE</span>
                            <div className="w-16 border-b border-slate-900 h-2.5"></div>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer" onClick={() => onPrevisionChange('Particular')}>
                            <span className="text-[9px] font-medium text-slate-700">PRAIS</span>
                            <div className={clsx(
                                "w-3 h-3 border border-slate-900 flex items-center justify-center",
                                prevision === 'Particular' ? "bg-medical-600 text-white" : "bg-white"
                            )}>
                                {prevision === 'Particular' && <Check size={8} strokeWidth={4} />}
                            </div>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
};

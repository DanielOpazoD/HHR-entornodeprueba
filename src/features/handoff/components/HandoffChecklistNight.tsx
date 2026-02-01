import React from 'react';
import { ClipboardList } from 'lucide-react';
import clsx from 'clsx';

interface HandoffChecklistNightProps {
    data?: {
        estadistica?: boolean;
        categorizacionCudyr?: boolean;
        encuestaUTI?: boolean;
        encuestaMedias?: boolean;
        conteoMedicamento?: boolean;
        conteoMedicamentoProximaFecha?: string;
        conteoNoControlados?: boolean;
        conteoNoControladosProximaFecha?: string;
    };
    onUpdate: (field: string, value: boolean | string) => void;
    readOnly?: boolean;
}

/**
 * Reusable checkbox component that renders correctly in both screen and print
 * Uses conditional classes instead of :checked pseudo-class for print compatibility
 */
const ChecklistItem: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    disabled: boolean;
}> = ({ checked, onChange, label, disabled }) => {
    return (
        <label className="flex items-center gap-2 cursor-pointer group print:gap-1">
            <div className="relative flex items-center">
                <input
                    type="checkbox"
                    className={clsx(
                        "h-4 w-4 cursor-pointer appearance-none rounded border shadow transition-all focus:ring-2",
                        "print:w-3 print:h-3 print:shadow-none",
                        "border-slate-300 focus:ring-slate-200",
                        // For screen: use :checked pseudo-class
                        "checked:border-slate-600 checked:bg-slate-600",
                        // For print: use conditional classes directly (these will always apply when checked)
                        checked && "print:!bg-slate-800 print:!border-slate-800"
                    )}
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    disabled={disabled}
                />
                {/* Checkmark - visible when checked, works for both screen and print */}
                <span
                    className={clsx(
                        "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white pointer-events-none transition-opacity",
                        checked ? "opacity-100" : "opacity-0"
                    )}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 print:h-2 print:w-2" viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" strokeWidth="1">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                </span>
            </div>
            <span className="text-slate-700 font-medium group-hover:text-slate-900 transition-colors text-xs print:text-[8px] print:text-black">
                {label}
            </span>
        </label>
    );
};

export const HandoffChecklistNight: React.FC<HandoffChecklistNightProps> = ({ data = {}, onUpdate, readOnly = false }) => {
    return (
        <div className="flex flex-wrap items-center gap-4 print:gap-3 print:bg-transparent print:border-none print:p-0">
            <div className="flex items-center gap-2 text-slate-700">
                <ClipboardList size={14} className="print:w-3 print:h-3" />
                <span className="text-xs font-bold uppercase print:text-black print:text-[9px]">Checklist TN</span>
            </div>
            <ChecklistItem
                checked={!!data.estadistica}
                onChange={(checked) => onUpdate('estadistica', checked)}
                label="Estadística"
                disabled={readOnly}
            />
            <ChecklistItem
                checked={!!data.categorizacionCudyr}
                onChange={(checked) => onUpdate('categorizacionCudyr', checked)}
                label="Categorización CUDYR"
                disabled={readOnly}
            />
            <ChecklistItem
                checked={!!data.encuestaUTI}
                onChange={(checked) => onUpdate('encuestaUTI', checked)}
                label="Encuesta camas UTI"
                disabled={readOnly}
            />
            <ChecklistItem
                checked={!!data.encuestaMedias}
                onChange={(checked) => onUpdate('encuestaMedias', checked)}
                label="Encuesta camas Medias"
                disabled={readOnly}
            />
            <ChecklistItem
                checked={!!data.conteoMedicamento}
                onChange={(checked) => onUpdate('conteoMedicamento', checked)}
                label="Conteo fármacos controlados"
                disabled={readOnly}
            />

            {/* Conteo Fármacos NO Controlados + Fecha */}
            <div className="flex items-center gap-2 print:gap-1">
                <ChecklistItem
                    checked={!!data.conteoNoControlados}
                    onChange={(checked) => onUpdate('conteoNoControlados', checked)}
                    label="Conteo fármacos no-controlados"
                    disabled={readOnly}
                />
                <div className="flex items-center gap-1 print:gap-0.5">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase print:text-[7px] print:text-black">Próx:</span>
                    <input
                        type="date"
                        value={data.conteoNoControladosProximaFecha || ''}
                        onChange={(e) => onUpdate('conteoNoControladosProximaFecha', e.target.value)}
                        className="text-xs p-1 border border-slate-200 rounded text-slate-700 focus:ring-1 focus:ring-slate-400 focus:outline-none w-24 print:hidden"
                        disabled={readOnly}
                    />
                    {/* Print-only: show date as text without calendar icon */}
                    <span className="hidden print:inline print:text-[8px] print:text-black">
                        {data.conteoNoControladosProximaFecha || '-'}
                    </span>
                </div>
            </div>
        </div>
    );
};

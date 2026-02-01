import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import clsx from 'clsx';

interface HandoffChecklistDayProps {
    data?: {
        escalaBraden?: boolean;
        escalaRiesgoCaidas?: boolean;
        escalaRiesgoLPP?: boolean;
    };
    onUpdate: (field: string, value: boolean) => void;
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
    colorScheme?: 'sky' | 'slate';
}> = ({ checked, onChange, label, disabled, colorScheme = 'sky' }) => {
    const bgColor = colorScheme === 'sky' ? 'bg-sky-600' : 'bg-slate-600';
    const borderColor = colorScheme === 'sky' ? 'border-sky-600' : 'border-slate-600';
    const hoverTextColor = colorScheme === 'sky' ? 'group-hover:text-sky-700' : 'group-hover:text-slate-900';
    const borderDefault = colorScheme === 'sky' ? 'border-sky-300' : 'border-slate-300';
    const focusRing = colorScheme === 'sky' ? 'focus:ring-sky-200' : 'focus:ring-slate-200';

    return (
        <label className="flex items-center gap-2 cursor-pointer group print:gap-1">
            <div className="relative flex items-center">
                <input
                    type="checkbox"
                    className={clsx(
                        "h-4 w-4 cursor-pointer appearance-none rounded border shadow transition-all focus:ring-2",
                        "print:w-3 print:h-3 print:shadow-none",
                        borderDefault,
                        focusRing,
                        // For screen: use :checked pseudo-class
                        `checked:${borderColor} checked:${bgColor}`,
                        // For print: use conditional classes directly (these will always apply when checked)
                        checked && [borderColor, bgColor, "print:!bg-slate-800 print:!border-slate-800"]
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
            <span className={clsx(
                "text-slate-700 font-medium transition-colors text-xs print:text-[8px] print:text-black",
                hoverTextColor
            )}>
                {label}
            </span>
        </label>
    );
};

export const HandoffChecklistDay: React.FC<HandoffChecklistDayProps> = ({ data = {}, onUpdate, readOnly = false }) => {
    return (
        <div className="flex flex-wrap items-center gap-4 print:gap-3 print:bg-transparent print:border-none print:p-0">
            <div className="flex items-center gap-2 text-sky-700">
                <ClipboardCheck size={14} className="print:w-3 print:h-3" />
                <span className="text-xs font-bold uppercase print:text-black print:text-[9px]">Checklist TL</span>
            </div>
            <ChecklistItem
                checked={!!data.escalaBraden}
                onChange={(checked) => onUpdate('escalaBraden', checked)}
                label="Escala Braden"
                disabled={readOnly}
                colorScheme="sky"
            />
            <ChecklistItem
                checked={!!data.escalaRiesgoCaidas}
                onChange={(checked) => onUpdate('escalaRiesgoCaidas', checked)}
                label="Escala Riesgo Caídas"
                disabled={readOnly}
                colorScheme="sky"
            />
            <ChecklistItem
                checked={!!data.escalaRiesgoLPP}
                onChange={(checked) => onUpdate('escalaRiesgoLPP', checked)}
                label="Evaluación LPP"
                disabled={readOnly}
                colorScheme="sky"
            />
        </div>
    );
};

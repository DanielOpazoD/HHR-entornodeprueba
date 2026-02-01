/**
 * ExamCheckbox Component
 * Renders an individual exam checkbox item for the laboratory request form.
 */

import React from 'react';
import clsx from 'clsx';

interface ExamCheckboxProps {
    exam: string;
    categoryTitle: string;
    isSelected: boolean;
    onToggle: (examKey: string) => void;
}

export const ExamCheckbox: React.FC<ExamCheckboxProps> = ({
    exam,
    categoryTitle,
    isSelected,
    onToggle
}) => {
    const examKey = `${categoryTitle}|${exam}`;

    return (
        <div
            onClick={() => onToggle(examKey)}
            className="flex items-center gap-1.5 py-0.5 px-1 cursor-pointer transition-colors text-slate-700 hover:bg-slate-50"
        >
            <div className={clsx(
                "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 border-slate-900",
                "bg-white"
            )}>
                {isSelected && (
                    <span
                        className="font-bold text-[12px] leading-none"
                        style={{
                            color: 'black',
                            display: 'block',
                            textAlign: 'center',
                            width: '100%',
                            height: '100%',
                            visibility: 'visible',
                            WebkitPrintColorAdjust: 'exact',
                            printColorAdjust: 'exact'
                        }}
                    >
                        X
                    </span>
                )}
            </div>
            <span className="text-[11px] font-medium leading-[1.1]">{exam}</span>
        </div>
    );
};

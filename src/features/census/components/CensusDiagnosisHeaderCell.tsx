import React from 'react';
import clsx from 'clsx';
import { FileText, Stethoscope } from 'lucide-react';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import { resolveDiagnosisToggleUiState } from '@/features/census/controllers/censusDiagnosisHeaderController';

interface CensusDiagnosisHeaderCellProps {
    width: number;
    isEditMode: boolean;
    onResize: (width: number) => void;
    headerClassName: string;
    readOnly: boolean;
    diagnosisMode: DiagnosisMode;
    onToggleDiagnosisMode: () => void;
}

export const CensusDiagnosisHeaderCell: React.FC<CensusDiagnosisHeaderCellProps> = ({
    width,
    isEditMode,
    onResize,
    headerClassName,
    readOnly,
    diagnosisMode,
    onToggleDiagnosisMode
}) => {
    const toggleState = resolveDiagnosisToggleUiState(diagnosisMode);

    return (
        <ResizableHeader
            width={width}
            isEditMode={isEditMode}
            onResize={onResize}
            className={headerClassName}
        >
            <div className="flex items-center justify-center gap-1">
                <span>Diagnóstico</span>
                {!readOnly && (
                    <button
                        onClick={onToggleDiagnosisMode}
                        className={clsx(
                            'text-[10px] flex items-center justify-center p-0.5 rounded transition-all print:hidden w-4 h-4',
                            toggleState.buttonClassName
                        )}
                        title={toggleState.title}
                    >
                        {toggleState.isCie10Mode ? <Stethoscope size={10} /> : <FileText size={10} />}
                    </button>
                )}
            </div>
        </ResizableHeader>
    );
};

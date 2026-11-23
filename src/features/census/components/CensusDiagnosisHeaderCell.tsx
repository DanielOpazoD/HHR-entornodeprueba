import React from 'react';
import clsx from 'clsx';
import { FileText, Stethoscope } from 'lucide-react';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

const CIE10_TITLE = 'Modo CIE-10 (clic para cambiar a texto libre)';
const FREE_TEXT_TITLE = 'Modo texto libre (clic para cambiar a CIE-10)';
const CIE10_BUTTON_CLASS = 'bg-medical-600 text-white';
const FREE_TEXT_BUTTON_CLASS =
  'bg-white border border-slate-300 text-slate-400 hover:text-medical-600';

const resolveDiagnosisToggleUiState = (diagnosisMode: DiagnosisMode) => {
  const isCie10Mode = diagnosisMode === 'cie10';
  return {
    isCie10Mode,
    title: isCie10Mode ? CIE10_TITLE : FREE_TEXT_TITLE,
    buttonClassName: isCie10Mode ? CIE10_BUTTON_CLASS : FREE_TEXT_BUTTON_CLASS,
  };
};

interface CensusDiagnosisHeaderCellProps {
  width: number;
  responsiveShare?: string;
  isEditMode: boolean;
  onResize: (width: number) => void;
  headerClassName: string;
  readOnly: boolean;
  diagnosisMode: DiagnosisMode;
  onToggleDiagnosisMode: () => void;
}

export const CensusDiagnosisHeaderCell: React.FC<CensusDiagnosisHeaderCellProps> = ({
  width,
  responsiveShare,
  isEditMode,
  onResize,
  headerClassName,
  readOnly,
  diagnosisMode,
  onToggleDiagnosisMode,
}) => {
  const toggleState = resolveDiagnosisToggleUiState(diagnosisMode);

  return (
    <ResizableHeader
      width={width}
      responsiveShare={responsiveShare}
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

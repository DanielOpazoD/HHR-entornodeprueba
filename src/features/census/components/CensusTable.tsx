import React from 'react';
import { useCensusTableViewModel } from '@/features/census/hooks/useCensusTableViewModel';
import { CensusTableHeader } from '@/features/census/components/CensusTableHeader';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { buildCensusTableLayoutBindings } from '@/features/census/controllers/censusTableLayoutController';
export type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

interface CensusTableProps {
  currentDateString: string;
  readOnly?: boolean;
}

export const CensusTable: React.FC<CensusTableProps> = ({
  currentDateString,
  readOnly = false,
}) => {
  const {
    beds,
    columns,
    isEditMode,
    handleColumnResize,
    canDeleteRecord,
    resetDayDeniedMessage,
    occupiedRows,
    emptyBeds,
    bedTypes,
    totalWidth,
    handleClearAll,
    diagnosisMode,
    toggleDiagnosisMode,
    handleRowAction,
    activateEmptyBed,
  } = useCensusTableViewModel({ currentDateString });

  if (!beds) return null;

  const { headerProps, bodyProps, tableStyle } = buildCensusTableLayoutBindings({
    currentDateString,
    readOnly,
    columns,
    isEditMode,
    canDeleteRecord,
    resetDayDeniedMessage,
    onClearAll: handleClearAll,
    diagnosisMode,
    onToggleDiagnosisMode: toggleDiagnosisMode,
    onResizeColumn: handleColumnResize,
    occupiedRows,
    emptyBeds,
    bedTypes,
    onAction: handleRowAction,
    onActivateEmptyBed: activateEmptyBed,
    totalWidth,
  });

  return (
    <div className="card print:border-none print:shadow-none !overflow-visible">
      <div className="overflow-x-auto overflow-y-hidden">
        <table
          data-testid="census-table"
          className="text-left border-collapse print:text-xs relative text-[12px] leading-tight table-fixed"
          style={tableStyle}
        >
          <CensusTableHeader {...headerProps} />
          <CensusTableBody {...bodyProps} />
        </table>
      </div>
    </div>
  );
};

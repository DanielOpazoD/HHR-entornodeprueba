import React from 'react';
import { useCensusTableViewModel } from '@/features/census/hooks/useCensusTableViewModel';
import { CensusTableHeader } from '@/features/census/components/CensusTableHeader';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
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

  return (
    <div className="card print:border-none print:shadow-none !overflow-visible">
      <div className="overflow-x-auto overflow-y-hidden">
        <table
          data-testid="census-table"
          className="text-left border-collapse print:text-xs relative text-[12px] leading-tight table-fixed"
          style={{ width: `${totalWidth}px`, minWidth: '100%' }}
        >
          <CensusTableHeader
            readOnly={readOnly}
            columns={columns}
            isEditMode={isEditMode}
            canDeleteRecord={canDeleteRecord}
            resetDayDeniedMessage={resetDayDeniedMessage}
            onClearAll={handleClearAll}
            diagnosisMode={diagnosisMode}
            onToggleDiagnosisMode={toggleDiagnosisMode}
            onResizeColumn={handleColumnResize}
          />
          <CensusTableBody
            occupiedRows={occupiedRows}
            emptyBeds={emptyBeds}
            currentDateString={currentDateString}
            readOnly={readOnly}
            diagnosisMode={diagnosisMode}
            bedTypes={bedTypes}
            onAction={handleRowAction}
            onActivateEmptyBed={activateEmptyBed}
          />
        </table>
      </div>
    </div>
  );
};

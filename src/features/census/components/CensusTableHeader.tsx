import React from 'react';
import clsx from 'clsx';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import { CensusActionHeaderCell } from '@/features/census/components/CensusActionHeaderCell';
import { CensusDiagnosisHeaderCell } from '@/features/census/components/CensusDiagnosisHeaderCell';
import { buildCensusHeaderCellModels } from '@/features/census/controllers/censusTableHeaderController';
import type { CensusTableHeaderProps } from '@/features/census/types/censusTableComponentContracts';

export const CensusTableHeader: React.FC<CensusTableHeaderProps> = ({
  readOnly,
  columns,
  isEditMode,
  canDeleteRecord,
  resetDayDeniedMessage,
  onClearAll,
  diagnosisMode,
  onToggleDiagnosisMode,
  onResizeColumn,
}) => {
  const headerClassName =
    'sticky top-0 z-20 bg-slate-50 py-1 px-1 border-r border-slate-100 text-center text-slate-500 text-[10px] uppercase tracking-wider font-bold shadow-sm';
  const headerCells = buildCensusHeaderCellModels();

  return (
    <thead className="sticky top-0 z-30 bg-white">
      <tr className="border-b border-slate-200 print:static">
        <CensusActionHeaderCell
          width={columns.actions}
          isEditMode={isEditMode}
          onResize={onResizeColumn('actions')}
          headerClassName={headerClassName}
          readOnly={readOnly}
          canDeleteRecord={canDeleteRecord}
          deniedMessage={resetDayDeniedMessage}
          onClearAll={onClearAll}
        />

        {headerCells.map(cell =>
          cell.kind === 'diagnosis' ? (
            <CensusDiagnosisHeaderCell
              key={cell.key}
              width={columns.diagnosis}
              isEditMode={isEditMode}
              onResize={onResizeColumn('diagnosis')}
              headerClassName={clsx(headerClassName, cell.className)}
              readOnly={readOnly}
              diagnosisMode={diagnosisMode}
              onToggleDiagnosisMode={onToggleDiagnosisMode}
            />
          ) : (
            <ResizableHeader
              key={cell.key}
              width={columns[cell.key]}
              isEditMode={isEditMode}
              onResize={onResizeColumn(cell.key)}
              className={clsx(headerClassName, cell.className)}
              title={cell.title}
            >
              {cell.label}
            </ResizableHeader>
          )
        )}
      </tr>
    </thead>
  );
};

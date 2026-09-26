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
  accessProfile,
  onToggleDiagnosisMode,
  onResizeColumn,
}) => {
  const headerClassName =
    'sticky top-0 z-20 bg-slate-50 py-1.5 px-1.5 border-r border-slate-200/80 text-center text-slate-500 text-[10px] leading-none uppercase tracking-[0.04em] font-semibold';
  const headerCells = buildCensusHeaderCellModels(undefined, accessProfile);
  const visibleWidth =
    columns.actions + headerCells.reduce((sum, cell) => sum + columns[cell.key], 0);
  const responsiveShare = (width: number): string => `${(width / visibleWidth) * 100}%`;

  return (
    <thead className="sticky top-0 z-30">
      <tr className="border-b border-slate-200 print:static">
        <CensusActionHeaderCell
          width={columns.actions}
          responsiveShare={responsiveShare(columns.actions)}
          isEditMode={isEditMode}
          onResize={onResizeColumn('actions')}
          headerClassName={clsx(headerClassName, 'census-column-actions')}
          readOnly={readOnly}
          canDeleteRecord={accessProfile === 'specialist' ? false : canDeleteRecord}
          deniedMessage={resetDayDeniedMessage}
          onClearAll={onClearAll}
        />

        {headerCells.map(cell =>
          cell.kind === 'diagnosis' ? (
            <CensusDiagnosisHeaderCell
              key={cell.key}
              width={columns.diagnosis}
              responsiveShare={responsiveShare(columns.diagnosis)}
              isEditMode={isEditMode}
              onResize={onResizeColumn('diagnosis')}
              headerClassName={clsx(headerClassName, cell.className, `census-column-${cell.key}`)}
              readOnly={readOnly}
              diagnosisMode={diagnosisMode}
              onToggleDiagnosisMode={onToggleDiagnosisMode}
            />
          ) : (
            <ResizableHeader
              key={cell.key}
              width={columns[cell.key]}
              responsiveShare={responsiveShare(columns[cell.key])}
              isEditMode={isEditMode}
              onResize={onResizeColumn(cell.key)}
              className={clsx(headerClassName, cell.className, `census-column-${cell.key}`)}
              title={cell.title}
              ariaLabel={cell.key === 'status' ? 'Estado clínico' : undefined}
              minWidth={cell.key === 'status' ? 32 : undefined}
            >
              {cell.label}
            </ResizableHeader>
          )
        )}
      </tr>
    </thead>
  );
};

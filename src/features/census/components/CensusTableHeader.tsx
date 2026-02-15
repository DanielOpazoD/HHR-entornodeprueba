import React from 'react';
import clsx from 'clsx';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import { CensusActionHeaderCell } from '@/features/census/components/CensusActionHeaderCell';
import { CensusDiagnosisHeaderCell } from '@/features/census/components/CensusDiagnosisHeaderCell';
import { CENSUS_HEADER_COLUMNS } from '@/features/census/controllers/censusTableHeaderController';
import type { TableColumnConfig } from '@/context/TableConfigContext';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

interface CensusTableHeaderProps {
  readOnly: boolean;
  columns: TableColumnConfig;
  isEditMode: boolean;
  canDeleteRecord: boolean;
  resetDayDeniedMessage: string;
  onClearAll: () => Promise<void>;
  diagnosisMode: DiagnosisMode;
  onToggleDiagnosisMode: () => void;
  onResizeColumn: (column: keyof TableColumnConfig) => (width: number) => void;
}

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

        {CENSUS_HEADER_COLUMNS.map(column =>
          column.key === 'diagnosis' ? (
            <CensusDiagnosisHeaderCell
              key={column.key}
              width={columns.diagnosis}
              isEditMode={isEditMode}
              onResize={onResizeColumn('diagnosis')}
              headerClassName={clsx(headerClassName, column.className)}
              readOnly={readOnly}
              diagnosisMode={diagnosisMode}
              onToggleDiagnosisMode={onToggleDiagnosisMode}
            />
          ) : (
            <ResizableHeader
              key={column.key}
              width={columns[column.key]}
              isEditMode={isEditMode}
              onResize={onResizeColumn(column.key)}
              className={clsx(headerClassName, column.className)}
              title={column.title}
            >
              {column.label}
            </ResizableHeader>
          )
        )}
      </tr>
    </thead>
  );
};

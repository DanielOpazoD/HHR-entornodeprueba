import React, { useCallback } from 'react';
import { PatientRow } from '@/features/census/components/PatientRow';
import { EmptyBedRow } from '@/features/census/components/EmptyBedRow';
import { useDailyRecordBeds, useDailyRecordActions, useDailyRecordStaff, useDailyRecordOverrides } from '@/context/DailyRecordContext';
import { useCensusActionCommands } from './CensusActionsContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useAuth } from '@/context/AuthContext';
import { useTableConfig, TableColumnConfig } from '@/context/TableConfigContext';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import { Bed } from 'lucide-react';
import clsx from 'clsx';
import { useEmptyBedActivation } from '@/features/census/components/useEmptyBedActivation';
import { CensusActionHeaderCell } from '@/features/census/components/CensusActionHeaderCell';
import { CensusDiagnosisHeaderCell } from '@/features/census/components/CensusDiagnosisHeaderCell';
import { CENSUS_HEADER_COLUMNS } from '@/features/census/controllers/censusTableHeaderController';
import { useDiagnosisMode } from '@/features/census/hooks/useDiagnosisMode';
import { useCensusTableModel } from '@/features/census/hooks/useCensusTableModel';
export type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

interface CensusTableProps {
    currentDateString: string;
    readOnly?: boolean;
}

export const CensusTable: React.FC<CensusTableProps> = ({
    currentDateString,
    readOnly = false
}) => {
    const beds = useDailyRecordBeds();
    const staff = useDailyRecordStaff();
    const { resetDay, updatePatient } = useDailyRecordActions();
    const { handleRowAction } = useCensusActionCommands();
    const { confirm } = useConfirmDialog();
    const { warning } = useNotification();
    const { role } = useAuth();
    const overrides = useDailyRecordOverrides();
    const { config, isEditMode, updateColumnWidth } = useTableConfig();
    const { activateEmptyBed } = useEmptyBedActivation({ updatePatient });
    const { diagnosisMode, toggleDiagnosisMode } = useDiagnosisMode();
    const { columns } = config;

    const {
        canDeleteRecord,
        resetDayDeniedMessage,
        occupiedRows,
        emptyBeds,
        bedTypes,
        totalWidth,
        handleClearAll
    } = useCensusTableModel({
        currentDateString,
        role,
        beds,
        activeExtraBeds: staff?.activeExtraBeds || [],
        overrides,
        columns,
        resetDay,
        confirm,
        warning
    });

    const handleColumnResize = useCallback((column: keyof TableColumnConfig) => (width: number) => {
        updateColumnWidth(column, width);
    }, [updateColumnWidth]);

    if (!beds) return null;

    // Common header classes
    const headerClass = "sticky top-0 z-20 bg-slate-50 py-1 px-1 border-r border-slate-100 text-center text-slate-500 text-[10px] uppercase tracking-wider font-bold shadow-sm";

    return (
        <div className="card print:border-none print:shadow-none !overflow-visible">
            <div className="overflow-x-auto overflow-y-hidden">
                <table
                    data-testid="census-table"
                    className="text-left border-collapse print:text-xs relative text-[12px] leading-tight table-fixed"
                    style={{ width: `${totalWidth}px`, minWidth: '100%' }}
                >
                    <thead className="sticky top-0 z-30 bg-white">
                        <tr className="border-b border-slate-200 print:static">
                            <CensusActionHeaderCell
                                width={columns.actions}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('actions')}
                                headerClassName={headerClass}
                                readOnly={readOnly}
                                canDeleteRecord={canDeleteRecord}
                                deniedMessage={resetDayDeniedMessage}
                                onClearAll={handleClearAll}
                            />

                            {CENSUS_HEADER_COLUMNS.map((column) => (
                                column.key === 'diagnosis' ? (
                                    <CensusDiagnosisHeaderCell
                                        key={column.key}
                                        width={columns.diagnosis}
                                        isEditMode={isEditMode}
                                        onResize={handleColumnResize('diagnosis')}
                                        headerClassName={clsx(headerClass, column.className)}
                                        readOnly={readOnly}
                                        diagnosisMode={diagnosisMode}
                                        onToggleDiagnosisMode={toggleDiagnosisMode}
                                    />
                                ) : (
                                    <ResizableHeader
                                        key={column.key}
                                        width={columns[column.key]}
                                        isEditMode={isEditMode}
                                        onResize={handleColumnResize(column.key)}
                                        className={clsx(headerClass, column.className)}
                                        title={column.title}
                                    >
                                        {column.label}
                                    </ResizableHeader>
                                )
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {/* Occupied beds - full rows */}
                        {occupiedRows.map((row, index) => (
                            <PatientRow
                                key={row.id}
                                bed={row.bed}
                                data={row.data}
                                currentDateString={currentDateString}
                                onAction={handleRowAction}
                                readOnly={readOnly}
                                actionMenuAlign={index >= occupiedRows.length - 4 ? 'bottom' : 'top'}
                                diagnosisMode={diagnosisMode}
                                isSubRow={row.isSubRow}
                                bedType={bedTypes[row.bed.id]}
                            />
                        ))}

                        {/* Separator row for empty beds */}
                        {emptyBeds.length > 0 && (
                            <tr className="border-t-2 border-slate-200 print:hidden">
                                <td colSpan={12} className="py-2 px-3 bg-slate-50/50">
                                    <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
                                        <Bed size={14} />
                                        <span>Camas disponibles ({emptyBeds.length})</span>
                                    </div>
                                </td>
                            </tr>
                        )}

                        {/* Empty beds - compact rows */}
                            {emptyBeds.map(bed => (
                                <EmptyBedRow
                                    key={bed.id}
                                    bed={bed}
                                    readOnly={readOnly}
                                    onClick={() => activateEmptyBed(bed.id)}
                                />
                            ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

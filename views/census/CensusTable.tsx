import React, { useMemo, useCallback } from 'react';
import { DailyRecord } from '@/types';
import { BEDS } from '@/constants';
import { PatientRow } from '@/components/census/PatientRow';
import { useCensusActions } from './CensusActionsContext';
import { useConfirmDialog } from '@/context/UIContext';
import { useTableConfig, TableColumnConfig } from '@/context/TableConfigContext';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import { Trash2, Baby, Settings2 } from 'lucide-react';
import clsx from 'clsx';

interface CensusTableProps {
    record: DailyRecord;
    currentDateString: string;
    onResetDay: () => void;
    readOnly?: boolean;
}

export const CensusTable: React.FC<CensusTableProps> = ({
    record,
    currentDateString,
    onResetDay,
    readOnly = false
}) => {
    const { showCribConfig, setShowCribConfig, handleRowAction } = useCensusActions();
    const { confirm } = useConfirmDialog();
    const { config, isEditMode, setEditMode, updateColumnWidth } = useTableConfig();
    const { columns } = config;

    // Filter beds to display: All normal beds + Enabled extra beds
    const visibleBeds = useMemo(() => {
        const activeExtras = record.activeExtraBeds || [];
        return BEDS.filter(b => !b.isExtra || activeExtras.includes(b.id));
    }, [record.activeExtraBeds]);

    const handleClearAll = useCallback(async () => {
        const confirmed = await confirm({
            title: '⚠️ Reiniciar registro del día',
            message: '¿Está seguro de que desea ELIMINAR todos los datos del día?\n\nEsto eliminará el registro completo y podrá crear uno nuevo (copiar del anterior o en blanco).',
            confirmText: 'Sí, reiniciar',
            cancelText: 'Cancelar',
            variant: 'danger'
        });

        if (confirmed) {
            onResetDay();
        }
    }, [confirm, onResetDay]);

    const handleColumnResize = useCallback((column: keyof TableColumnConfig) => (width: number) => {
        updateColumnWidth(column, width);
    }, [updateColumnWidth]);

    // Common header classes
    const headerClass = "sticky top-0 z-20 bg-slate-50 py-1 px-1 border-r border-slate-100 text-center text-slate-500 text-[10px] uppercase tracking-wider font-bold shadow-sm";

    return (
        <div className="card print:border-none print:shadow-none flex flex-col overflow-visible">
            <div className="relative overflow-visible">
                <table
                    data-testid="census-table"
                    className="w-full text-left border-collapse print:text-xs relative text-[12px] leading-tight table-fixed"
                >
                    <thead>
                        <tr className="border-b border-slate-200 print:static">
                            {/* Action column - resizable */}
                            <ResizableHeader
                                width={columns.actions}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('actions')}
                                className={clsx(headerClass, "print:hidden")}
                            >
                                <button
                                    onClick={handleClearAll}
                                    className="p-1 rounded-md bg-slate-500/20 hover:bg-slate-500/40 text-slate-400 hover:text-slate-600 transition-all mx-auto block"
                                    title="Limpiar todos los datos del día"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </ResizableHeader>

                            {/* Bed column */}
                            <ResizableHeader
                                width={columns.bed}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('bed')}
                                className={headerClass}
                            >
                                <div className="flex flex-col items-center gap-0.5">
                                    <span>Cama</span>
                                    {!readOnly && (
                                        <button
                                            onClick={() => setShowCribConfig(!showCribConfig)}
                                            className={clsx(
                                                "text-[10px] flex items-center justify-center p-0.5 rounded transition-all print:hidden w-5 h-5",
                                                showCribConfig ? "bg-medical-600 text-white" : "bg-white border border-slate-300 text-slate-400 hover:text-medical-600"
                                            )}
                                            title="Configurar Cunas"
                                        >
                                            <Baby size={12} />
                                        </button>
                                    )}
                                </div>
                            </ResizableHeader>

                            {/* Type column */}
                            <ResizableHeader
                                width={columns.type}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('type')}
                                className={headerClass}
                            >
                                Tipo
                            </ResizableHeader>

                            {/* Name column */}
                            <ResizableHeader
                                width={columns.name}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('name')}
                                className={headerClass}
                            >
                                Nombre Paciente
                            </ResizableHeader>

                            {/* RUT column */}
                            <ResizableHeader
                                width={columns.rut}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('rut')}
                                className={headerClass}
                            >
                                RUT
                            </ResizableHeader>

                            {/* Age column */}
                            <ResizableHeader
                                width={columns.age}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('age')}
                                className={headerClass}
                            >
                                Edad
                            </ResizableHeader>

                            {/* Diagnosis column */}
                            <ResizableHeader
                                width={columns.diagnosis}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('diagnosis')}
                                className={headerClass}
                            >
                                Diagnóstico
                            </ResizableHeader>

                            {/* Specialty column */}
                            <ResizableHeader
                                width={columns.specialty}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('specialty')}
                                className={headerClass}
                            >
                                Esp
                            </ResizableHeader>

                            {/* Status column */}
                            <ResizableHeader
                                width={columns.status}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('status')}
                                className={headerClass}
                            >
                                Estado
                            </ResizableHeader>

                            {/* Admission column */}
                            <ResizableHeader
                                width={columns.admission}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('admission')}
                                className={headerClass}
                            >
                                Ingreso
                            </ResizableHeader>

                            {/* DMI column */}
                            <ResizableHeader
                                width={columns.dmi}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('dmi')}
                                className={headerClass}
                                title="Dispositivos médicos invasivos"
                            >
                                DMI
                            </ResizableHeader>

                            {/* C.QX column */}
                            <ResizableHeader
                                width={columns.cqx}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('cqx')}
                                className={headerClass}
                                title="Comp. Quirurgica"
                            >
                                C.QX
                            </ResizableHeader>

                            {/* UPC column */}
                            <ResizableHeader
                                width={columns.upc}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('upc')}
                                className={clsx(headerClass, "border-r-0")}
                            >
                                UPC
                            </ResizableHeader>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {visibleBeds.map((bed, index) => (
                            <PatientRow
                                key={bed.id}
                                bed={bed}
                                data={record.beds[bed.id]}
                                currentDateString={currentDateString}
                                onAction={handleRowAction}
                                showCribControls={showCribConfig}
                                readOnly={readOnly}
                                actionMenuAlign={index >= visibleBeds.length - 4 ? 'bottom' : 'top'}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

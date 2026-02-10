import React, { useMemo, useCallback, useState } from 'react';
import { BEDS } from '@/constants';
import { PatientRow } from '@/features/census/components/PatientRow';
import { EmptyBedRow } from '@/features/census/components/EmptyBedRow';
import { useDailyRecordBeds, useDailyRecordActions, useDailyRecordStaff, useDailyRecordOverrides } from '@/context/DailyRecordContext';
import { useCensusActions } from './CensusActionsContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useAuth } from '@/context/AuthContext';
import { useTableConfig, TableColumnConfig } from '@/context/TableConfigContext';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import { Trash2, FileText, Stethoscope, Bed, ShieldAlert } from 'lucide-react';
import { BedDefinition, PatientData, BedType } from '@/types';
import { getBedTypeForRecord } from '@/utils/bedTypeUtils';
import { canDoAction, ACTIONS, isAdmin } from '@/utils/permissions';
import { getTodayISO } from '@/utils/dateUtils';
import clsx from 'clsx';

// Type for diagnosis input mode
export type DiagnosisMode = 'free' | 'cie10';

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
    const { handleRowAction } = useCensusActions();
    const { confirm } = useConfirmDialog();
    const { warning } = useNotification();
    const { role } = useAuth();
    const overrides = useDailyRecordOverrides();
    const { config, isEditMode, updateColumnWidth } = useTableConfig();

    const today = getTodayISO();
    const isToday = currentDateString === today;
    const isUserAdmin = isAdmin(role);

    // Permission check for deleting the record
    const canDeleteRecord = useMemo(() => {
        if (isUserAdmin) return true;
        // User is nurse or other with delete permission: only if it's today
        return canDoAction(role, ACTIONS.RECORD_DELETE) && isToday;
    }, [role, isUserAdmin, isToday]);

    // Diagnosis mode: 'free' (text libre) or 'cie10' (CIE-10 search)
    const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>(() => {
        if (typeof localStorage !== 'undefined') {
            return (localStorage.getItem('hhr_diagnosis_mode') as DiagnosisMode) || 'free';
        }
        return 'free';
    });

    const toggleDiagnosisMode = useCallback(() => {
        const newMode: DiagnosisMode = diagnosisMode === 'free' ? 'cie10' : 'free';
        setDiagnosisMode(newMode);
        localStorage.setItem('hhr_diagnosis_mode', newMode);
    }, [diagnosisMode]);

    // Filter beds to display: All normal beds + Enabled extra beds
    const visibleBeds = useMemo(() => {
        const activeExtras = staff?.activeExtraBeds || [];
        return BEDS.filter(b => !b.isExtra || activeExtras.includes(b.id));
    }, [staff?.activeExtraBeds]);

    // Flatten rows (Main and Sub rows) and separate occupied from empty
    const { occupiedRows, emptyBeds } = useMemo(() => {
        const occupied: { id: string; bed: BedDefinition; data: PatientData; isSubRow: boolean }[] = [];
        const empty: BedDefinition[] = [];

        visibleBeds.forEach(bed => {
            const bedData = beds ? beds[bed.id] : undefined;
            const hasPatient = bedData?.patientName || bedData?.isBlocked;

            if (hasPatient) {
                occupied.push({ id: bed.id, bed, data: bedData, isSubRow: false });

                // Add clinical crib as a separate row item if it exists and bed isn't blocked
                if (bedData && bedData.clinicalCrib && !bedData.isBlocked) {
                    occupied.push({
                        id: `${bed.id}-cuna`,
                        bed,
                        data: bedData.clinicalCrib,
                        isSubRow: true
                    });
                }
            } else {
                empty.push(bed);
            }
        });

        return { occupiedRows: occupied, emptyBeds: empty };
    }, [beds, visibleBeds]);

    // Calculate bed types memoized
    const bedTypes = useMemo(() => {
        const types: Record<string, BedType> = {};
        visibleBeds.forEach(bed => {
            types[bed.id] = getBedTypeForRecord(bed, { bedTypeOverrides: overrides } as any);
        });
        return types;
    }, [visibleBeds, overrides]);

    const handleClearAll = useCallback(async () => {
        if (!canDeleteRecord) {
            warning(
                'Acceso Denegado',
                isUserAdmin ? 'No puedes eliminar este registro.' : 'Solo el administrador puede eliminar registros de días anteriores. Los enfermeros solo pueden reiniciar el día actual.'
            );
            return;
        }

        const confirmed = await confirm({
            title: '⚠️ Reiniciar registro del día',
            message: '¿Está seguro de que desea ELIMINAR todos los datos del día?\n\nEsto eliminará el registro completo y podrá crear uno nuevo (copiar del anterior o en blanco).',
            confirmText: 'Sí, reiniciar',
            cancelText: 'Cancelar',
            variant: 'danger'
        });

        if (confirmed) {
            resetDay();
        }
    }, [confirm, resetDay, canDeleteRecord, isUserAdmin, warning]);

    const handleColumnResize = useCallback((column: keyof TableColumnConfig) => (width: number) => {
        updateColumnWidth(column, width);
    }, [updateColumnWidth]);

    const { columns } = config;
    const totalWidth = useMemo(() => {
        return Object.values(columns).reduce((sum, w) => sum + w, 0);
    }, [columns]);

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
                            {/* Action column - resizable */}
                            <ResizableHeader
                                width={columns.actions}
                                isEditMode={isEditMode}
                                onResize={handleColumnResize('actions')}
                                className={clsx(headerClass, "print:hidden")}
                            >
                                {(!readOnly || canDeleteRecord) && (
                                    <button
                                        onClick={handleClearAll}
                                        className={clsx(
                                            "p-1 rounded-md transition-all mx-auto block",
                                            canDeleteRecord
                                                ? "bg-slate-500/10 hover:bg-rose-500/20 text-slate-400 hover:text-rose-600"
                                                : "bg-slate-100 text-slate-300 cursor-not-allowed opacity-50"
                                        )}
                                        title={canDeleteRecord ? "Limpiar todos los datos del día" : "No tienes permisos para eliminar este día"}
                                    >
                                        {canDeleteRecord ? <Trash2 size={12} /> : <ShieldAlert size={10} />}
                                    </button>
                                )}
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
                                <div className="flex items-center justify-center gap-1">
                                    <span>Diagnóstico</span>
                                    {!readOnly && (
                                        <button
                                            onClick={toggleDiagnosisMode}
                                            className={clsx(
                                                "text-[10px] flex items-center justify-center p-0.5 rounded transition-all print:hidden w-4 h-4",
                                                diagnosisMode === 'cie10'
                                                    ? "bg-medical-600 text-white"
                                                    : "bg-white border border-slate-300 text-slate-400 hover:text-medical-600"
                                            )}
                                            title={diagnosisMode === 'cie10' ? 'Modo CIE-10 (clic para cambiar a texto libre)' : 'Modo texto libre (clic para cambiar a CIE-10)'}
                                        >
                                            {diagnosisMode === 'cie10' ? <Stethoscope size={10} /> : <FileText size={10} />}
                                        </button>
                                    )}
                                </div>
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
                                onClick={() => {
                                    // Initialize the bed with a placeholder to trigger PatientRow rendering
                                    updatePatient(bed.id, 'patientName', ' ');
                                    // Focus on the name input after React re-renders
                                    requestAnimationFrame(() => {
                                        const nameInput = document.querySelector(`[data-bed-id="${bed.id}"] input[name="patientName"]`) as HTMLInputElement;
                                        if (nameInput) {
                                            nameInput.value = ''; // Clear the placeholder
                                            nameInput.focus();
                                        }
                                    });
                                }}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

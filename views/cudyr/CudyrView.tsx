import React, { useMemo, useEffect, useCallback } from 'react';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { BEDS } from '@/constants';
import { CudyrScore } from '@/types';
import { BarChart3 } from 'lucide-react';

// Sub-components
import { CudyrHeader } from './CudyrHeader';
import { CudyrRow, VerticalHeader } from './CudyrRow';
import { getCategorization } from './CudyrScoreUtils';
import { CudyrSummaryTable } from './CudyrSummaryTable';
import { buildDailyCudyrSummary } from '@/services/calculations/cudyrSummary';
import { useAuditContext } from '@/context/AuditContext';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import { useAuth } from '@/context/AuthContext';
import { updatePartial } from '@/services/repositories/DailyRecordRepository';

interface CudyrViewProps {
    readOnly?: boolean;
}
/**
 * Helper: Check if a patient was admitted after CUDYR was locked.
 * If locked, patients admitted AFTER the lock time should be hidden.
 * Also, patients without admission data are treated as "new" and hidden.
 */
const wasAdmittedAfterLock = (
    admissionDate?: string,
    admissionTime?: string,
    lockedAt?: string,
    patientName?: string
): boolean => {

    // If not locked, don't hide anyone
    if (!lockedAt) return false;

    // If there's no patient, don't hide (empty bed)
    if (!patientName) return false;

    // If patient exists but has no admission date, they were likely just added - hide them
    if (!admissionDate) {
        return true;
    }

    // Build admission timestamp: combine date + time
    const admissionDateTime = admissionTime
        ? `${admissionDate}T${admissionTime}:00`
        : `${admissionDate}T00:00:00`;

    const admissionTs = new Date(admissionDateTime).getTime();
    const lockTs = new Date(lockedAt).getTime();

    // If admission is after lock, return true (should be hidden)
    return admissionTs > lockTs;
};

export const CudyrView: React.FC<CudyrViewProps> = ({ readOnly = false }) => {
    const { record } = useDailyRecordData();
    const { updateCudyr, updateClinicalCribCudyr, refresh } = useDailyRecordActions();
    const { logEvent, userId } = useAuditContext();
    const { user, isEditor, role } = useAuth();

    // Permission check: Admin or Hospitalized nurse can toggle lock
    const canToggleLock = useMemo(() => {
        if (!user) return false;
        // Admin (role === 'admin') or Editor can toggle
        if (role === 'admin' || isEditor) {
            // Additionally check if hospitalized nurse
            const hospitalizedEmails = ['hospitalizados@hospitalhangaroa.cl', 'enfermeria.hospitalizados@hospitalhangaroa.cl'];
            const isHospitalizedNurse = hospitalizedEmails.includes(user.email?.toLowerCase() || '');
            // Admin always can, or hospitalized nurse
            return role === 'admin' || isHospitalizedNurse;
        }
        return false;
    }, [user, role, isEditor]);

    // Toggle CUDYR lock
    const handleToggleLock = useCallback(async () => {
        if (!record || !canToggleLock) return;

        const newLockedState = !record.cudyrLocked;
        const now = new Date().toISOString();

        try {
            await updatePartial(record.date, {
                cudyrLocked: newLockedState,
                cudyrLockedAt: newLockedState ? now : undefined,
                cudyrLockedBy: newLockedState ? (user?.email || userId) : undefined
            });
            // Refresh to get updated state
            refresh();
        } catch (error) {
            console.error('Error toggling CUDYR lock:', error);
        }
    }, [record, canToggleLock, user, userId, refresh]);

    // MINSAL Traceability: Log when patient CUDYR is viewed
    useEffect(() => {
        if (record && record.date) {
            // Attribution logic for shared accounts (MINSAL requirement)
            const authors = getAttributedAuthors(userId, record);

            logEvent(
                'VIEW_CUDYR',
                'dailyRecord',
                record.date,
                { view: 'cudyr' },
                undefined,
                record.date,
                authors
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record?.date, userId]); // Only log when the date changes or user changes

    // Filter beds to display - MUST be called before any early return
    const visibleBeds = useMemo(() => {
        if (!record) return [];
        const activeExtras = record.activeExtraBeds || [];
        return BEDS.filter(b => !b.isExtra || activeExtras.includes(b.id));
    }, [record]);

    // Calculate statistics - MUST be called before any early return
    // Now includes clinical cribs in the count
    const stats = useMemo(() => {
        if (!record) return { occupiedCount: 0, categorizedCount: 0 };

        let occupiedCount = 0;
        let categorizedCount = 0;

        visibleBeds.forEach(b => {
            const p = record.beds[b.id];
            if (!p) return;

            // Count main patient
            if (p.patientName && !p.isBlocked) {
                occupiedCount++;
                const { isCategorized } = getCategorization(p.cudyr);
                if (isCategorized) categorizedCount++;
            }
            // Count clinical crib if exists
            if (p.clinicalCrib?.patientName) {
                occupiedCount++;
                const { isCategorized } = getCategorization(p.clinicalCrib.cudyr);
                if (isCategorized) categorizedCount++;
            }
        });

        return { occupiedCount, categorizedCount };
    }, [visibleBeds, record]);

    // Calculate CUDYR summary with category breakdown
    const cudyrSummary = useMemo(() => {
        if (!record) return null;
        return buildDailyCudyrSummary(record);
    }, [record]);

    // Early return AFTER all hooks have been called
    if (!record) {
        return <div className="p-8 text-center text-slate-500">Seleccione una fecha con registros para ver el CUDYR.</div>;
    }

    const handleScoreChange = (bedId: string, field: keyof CudyrScore, value: number) => {
        updateCudyr(bedId, field, value);
    };

    const handleCribScoreChange = (bedId: string, field: keyof CudyrScore, value: number) => {
        updateClinicalCribCudyr(bedId, field, value);
    };

    // Determine if editing is locked
    const isEditingLocked = record.cudyrLocked || readOnly;

    // Format date for print header
    const formatPrintDate = () => {
        const [year, month, day] = record.date.split('-');
        return `${day}-${month}-${year}`;
    };

    // Get night shift nurses for print header (CUDYR is filled by night nurses)
    const responsibleNurses = (record.nursesNightShift || []).filter(n => n && n.trim() !== '');

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-none print:px-0 print:space-y-2 print:pb-0 print:break-inside-avoid">
            {/* Print-only Header with Icon, Date, Nurses, and Stats */}
            <div className="hidden print:block mb-2 pb-2 border-b border-slate-300">
                <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-1">
                    <BarChart3 size={20} className="text-medical-600" />
                    Instrumento CUDYR
                </h1>
                <div className="flex items-center gap-4 text-sm text-slate-700">
                    <span className="font-semibold">Fecha: {formatPrintDate()}</span>
                    <span className="text-slate-400">|</span>
                    <span>
                        <span className="font-semibold">Enfermeros/as: </span>
                        {responsibleNurses.length > 0
                            ? responsibleNurses.join(', ')
                            : <span className="italic text-slate-400">No registrados</span>
                        }
                    </span>
                </div>
                {/* Statistics row */}
                <div className="flex items-center gap-4 text-xs text-slate-600 mt-1">
                    <span>Ocupadas: <strong>{stats.occupiedCount}</strong></span>
                    <span className="text-slate-400">|</span>
                    <span>Categorizados: <strong>{stats.categorizedCount}</strong></span>
                    <span className="text-slate-400">|</span>
                    <span>Índice: <strong>{stats.occupiedCount > 0 ? Math.round((stats.categorizedCount / stats.occupiedCount) * 100) : 0}%</strong></span>
                </div>
            </div>

            {/* Category Summary Tables (Screen only) */}
            {cudyrSummary && (
                <CudyrSummaryTable
                    counts={cudyrSummary.counts}
                    utiTotal={cudyrSummary.utiTotal}
                    mediaTotal={cudyrSummary.mediaTotal}
                />
            )}

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-none print:p-0 print:break-inside-avoid">
                {/* Hide CudyrHeader when printing - title already in print header */}
                <div className="print:hidden">
                    <CudyrHeader
                        occupiedCount={stats.occupiedCount}
                        categorizedCount={stats.categorizedCount}
                        currentDate={record.date}
                        isLocked={record.cudyrLocked}
                        lockedAt={record.cudyrLockedAt}
                        lockedBy={record.cudyrLockedBy}
                        onToggleLock={handleToggleLock}
                        canToggle={canToggleLock}
                    />
                </div>

                <div className="overflow-x-auto print:overflow-visible">
                    <table className="w-full text-left text-xs border-collapse border border-slate-300 min-w-[900px] print:table-auto print:min-w-0 print:text-[7px]">
                        <thead>
                            {/* Group Headers */}
                            <tr>
                                <th colSpan={2} className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 print:bg-white print:p-1">PACIENTE</th>
                                <th colSpan={6} className="bg-blue-50 border border-blue-200 p-2 text-center font-bold text-blue-800 print:bg-white print:text-black print:border-slate-300 print:p-1">PUNTOS DEPENDENCIA (0-3)</th>
                                <th colSpan={8} className="bg-red-50 border border-red-200 p-2 text-center font-bold text-red-800 print:bg-white print:text-black print:border-slate-300 print:p-1">PUNTOS DE RIESGO (0-3)</th>
                                {/* RESULTADOS: colspan 3 on screen, only shows CAT on print */}
                                <th colSpan={3} className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 print:hidden">RESULTADOS</th>
                                <th className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 hidden print:table-cell print:bg-white print:p-1">CAT</th>
                            </tr>
                            {/* Column Headers */}
                            <tr className="text-center">
                                {/* Fixed */}
                                <th className="border border-slate-300 p-1 w-10 bg-slate-50 align-middle print:w-auto">CAMA</th>
                                <th className="border border-slate-300 p-1 w-[100px] max-w-[100px] bg-slate-50 align-middle print:w-[88px] print:max-w-[88px]">
                                    <span className="print:hidden">NOMBRE</span>
                                    <span className="hidden print:inline">RUT</span>
                                </th>

                                {/* Dep - Vertical */}
                                <VerticalHeader text="Cuidados Cambio Ropa" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Cuidados de Movilización" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Cuidados de Alimentación" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Cuidados de Eliminación" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Apoyo Psicosocial y Emocional" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Vigilancia" colorClass="bg-blue-50/50" />

                                {/* Risk - Vertical */}
                                <VerticalHeader text="Medicición Signos Vitales" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Balance Hìdrico" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Cuidados de Oxigenoterapia" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Cuidados diarios de Vía Aérea" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Intervenciones Profesionales" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Cuidados de la Piel y Curaciones" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Administración Tto Farmacológico" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Presencia Elem. Invasivos" colorClass="bg-red-50/50" />

                                {/* Results - P.DEP and P.RIES first (hidden on print), then CAT */}
                                <th className="border border-slate-300 p-1 w-12 bg-slate-50 text-blue-800 align-middle print:hidden">P.DEP</th>
                                <th className="border border-slate-300 p-1 w-12 bg-slate-50 text-red-800 align-middle print:hidden">P.RIES</th>
                                <th className="border border-slate-300 p-1 w-14 bg-slate-50 align-middle print:w-auto print:p-0.5 print:bg-white">CAT</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleBeds.map(bed => {
                                const patient = record.beds[bed.id];

                                // If CUDYR is locked, hide patients admitted after the lock
                                const shouldHidePatient = record.cudyrLocked && wasAdmittedAfterLock(
                                    patient?.admissionDate,
                                    patient?.admissionTime,
                                    record.cudyrLockedAt,
                                    patient?.patientName
                                );

                                // Get displayable patient (null if should be hidden)
                                const displayPatient = shouldHidePatient ? undefined : patient;

                                const hasCrib = !!displayPatient?.clinicalCrib?.patientName;

                                // Also check if clinical crib was added after lock
                                const shouldHideCrib = record.cudyrLocked && hasCrib && wasAdmittedAfterLock(
                                    displayPatient?.clinicalCrib?.admissionDate,
                                    displayPatient?.clinicalCrib?.admissionTime,
                                    record.cudyrLockedAt,
                                    displayPatient?.clinicalCrib?.patientName
                                );

                                return (
                                    <React.Fragment key={bed.id}>
                                        <CudyrRow
                                            bed={bed}
                                            patient={displayPatient as any}
                                            onScoreChange={handleScoreChange}
                                            readOnly={isEditingLocked}
                                        />
                                        {hasCrib && !shouldHideCrib && (
                                            <CudyrRow
                                                bed={{ ...bed, id: `${bed.id}-crib`, name: `${bed.name} (CC)` }}
                                                patient={displayPatient!.clinicalCrib!}
                                                onScoreChange={(_, field, value) => handleCribScoreChange(bed.id, field, value)}
                                                readOnly={isEditingLocked}
                                                isCrib={true}
                                            />
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

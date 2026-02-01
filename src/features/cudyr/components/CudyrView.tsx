import React from 'react';
import { BarChart3 } from 'lucide-react';
import { CudyrHeader } from './CudyrHeader';
import { CudyrRow, VerticalHeader } from './CudyrRow';
import { CudyrSummaryTable } from './CudyrSummaryTable';
import { useCudyrLogic } from '../hooks/useCudyrLogic';

interface CudyrViewProps {
    readOnly?: boolean;
}

export const CudyrView: React.FC<CudyrViewProps> = ({ readOnly = false }) => {
    const {
        record,
        visibleBeds,
        stats,
        cudyrSummary,
        canToggleLock,
        isEditingLocked,
        handleToggleLock,
        handleScoreChange,
        handleCribScoreChange,
        wasAdmittedAfterLock
    } = useCudyrLogic(readOnly);

    if (!record) {
        return <div className="p-8 text-center text-slate-500">Seleccione una fecha con registros para ver el CUDYR.</div>;
    }

    // Format date for print header
    const formatPrintDate = () => {
        const [year, month, day] = record.date.split('-');
        return `${day}-${month}-${year}`;
    };

    const responsibleNurses = (record.nursesNightShift || []).filter(n => n && n.trim() !== '');

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-none print:px-0 print:space-y-2 print:pb-0 print:break-inside-avoid">
            {/* Print-only Header */}
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
                        {responsibleNurses.length > 0 ? responsibleNurses.join(', ') : <span className="italic text-slate-400">No registrados</span>}
                    </span>
                </div>
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
                            <tr>
                                <th colSpan={2} className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 print:bg-white print:p-1">PACIENTE</th>
                                <th colSpan={6} className="bg-blue-50 border border-blue-200 p-2 text-center font-bold text-blue-800 print:bg-white print:text-black print:border-slate-300 print:p-1">PUNTOS DEPENDENCIA (0-3)</th>
                                <th colSpan={8} className="bg-red-50 border border-red-200 p-2 text-center font-bold text-red-800 print:bg-white print:text-black print:border-slate-300 print:p-1">PUNTOS DE RIESGO (0-3)</th>
                                <th colSpan={3} className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 print:hidden">RESULTADOS</th>
                                <th className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 hidden print:table-cell print:bg-white print:p-1">CAT</th>
                            </tr>
                            <tr className="text-center">
                                <th className="border border-slate-300 p-1 w-10 bg-slate-50 align-middle print:w-auto">CAMA</th>
                                <th className="border border-slate-300 p-1 w-[100px] max-w-[100px] bg-slate-50 align-middle print:w-[88px] print:max-w-[88px]">
                                    <span className="print:hidden">NOMBRE</span>
                                    <span className="hidden print:inline">RUT</span>
                                </th>
                                <VerticalHeader text="Cuidados Cambio Ropa" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Cuidados de Movilización" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Cuidados de Alimentación" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Cuidados de Eliminación" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Apoyo Psicosocial y Emocional" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Vigilancia" colorClass="bg-blue-50/50" />
                                <VerticalHeader text="Medicición Signos Vitales" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Balance Hìdrico" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Cuidados de Oxigenoterapia" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Cuidados diarios de Vía Aérea" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Intervenciones Profesionales" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Cuidados de la Piel y Curaciones" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Administración Tto Farmacológico" colorClass="bg-red-50/50" />
                                <VerticalHeader text="Presencia Elem. Invasivos" colorClass="bg-red-50/50" />
                                <th className="border border-slate-300 p-1 w-12 bg-slate-50 text-blue-800 align-middle print:hidden">P.DEP</th>
                                <th className="border border-slate-300 p-1 w-12 bg-slate-50 text-red-800 align-middle print:hidden">P.RIES</th>
                                <th className="border border-slate-300 p-1 w-14 bg-slate-50 align-middle print:w-auto print:p-0.5 print:bg-white">CAT</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleBeds.map(bed => {
                                const patient = record.beds[bed.id];
                                const shouldHidePatient = record.cudyrLocked && wasAdmittedAfterLock(patient?.admissionDate, patient?.admissionTime, record.cudyrLockedAt, patient?.patientName);
                                const displayPatient = shouldHidePatient ? undefined : patient;
                                const hasCrib = !!displayPatient?.clinicalCrib?.patientName;
                                const shouldHideCrib = record.cudyrLocked && hasCrib && wasAdmittedAfterLock(displayPatient?.clinicalCrib?.admissionDate, displayPatient?.clinicalCrib?.admissionTime, record.cudyrLockedAt, displayPatient?.clinicalCrib?.patientName);

                                return (
                                    <React.Fragment key={bed.id}>
                                        <CudyrRow
                                            bed={bed}
                                            patient={displayPatient}
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

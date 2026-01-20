import React, { useMemo } from 'react';
import clsx from 'clsx';
import { ClipboardList } from 'lucide-react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { BEDS } from '@/constants';
import { VerticalHeader } from '@/views/cudyr/CudyrRow';
import { getCategorization } from '@/views/cudyr/CudyrScoreUtils';
import { CudyrScore } from '@/types';
import { calculateStats } from '@/services/calculations/statsCalculator';

// ... (existing imports)

export const HandoffCudyrPrint: React.FC = () => {
    const { record } = useDailyRecordData();

    const visibleBeds = useMemo(() => {
        if (!record) return [];
        const activeExtras = record.activeExtraBeds || [];
        return BEDS.filter((b) => !b.isExtra || activeExtras.includes(b.id));
    }, [record]);

    // Calculate Summary Metrics for Header
    const metrics = useMemo(() => {
        if (!record) return { occupied: 0, categorized: 0, index: 0 };

        const stats = calculateStats(record.beds);
        const occupied = stats.totalHospitalized;

        let categorized = 0;

        Object.entries(record.beds).forEach(([_bedId, data]) => {
            if (data.isBlocked) return;

            // Check main patient
            if (data.patientName && data.patientName.trim()) {
                const { isCategorized } = getCategorization(data.cudyr);
                if (isCategorized) categorized++;
            }

            // Check clinical crib
            if (data.clinicalCrib?.patientName && data.clinicalCrib.patientName.trim()) {
                const { isCategorized } = getCategorization(data.clinicalCrib.cudyr);
                if (isCategorized) categorized++;
            }
        });

        const index = occupied > 0 ? Math.round((categorized / occupied) * 100) : 0;

        return { occupied, categorized, index };
    }, [record]);

    if (!record) return null;

    const formatPrintDate = () => {
        const [year, month, day] = record.date.split('-');
        return `${day}-${month}-${year}`;
    };

    const responsibleNurses = (record.nursesNightShift || []).filter((n) => n && n.trim() !== '');

    // Helper to render score values consistently
    const renderScore = (value?: number) => {
        if (value === 0) return 0;
        if (value === undefined || value === null) return '-';
        return value;
    };

    return (
        <div className="handoff-cudyr-print bg-white print:bg-white print:m-0 print:p-0 list-none">
            <div className="mb-3 pb-3 border-b border-slate-300">
                <div className="flex justify-between items-center mb-1">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <ClipboardList size={18} className="text-medical-700 print:hidden" />
                        Instrumento CUDYR
                    </h2>
                    {/* Metrics Badge */}
                    <div className="flex gap-3 text-[10px] font-bold bg-slate-50 px-2 py-1 rounded-md border border-slate-200 print:bg-white print:border-slate-300">
                        <div className="flex flex-col items-center leading-none">
                            <span className="text-slate-400 text-[8px] uppercase tracking-tighter mb-0.5">Ocupadas</span>
                            <span className="text-sm text-slate-700">{metrics.occupied}</span>
                        </div>
                        <div className="w-px bg-slate-200 h-5 self-center"></div>
                        <div className="flex flex-col items-center leading-none">
                            <span className="text-slate-400 text-[8px] uppercase tracking-tighter mb-0.5">Categ.</span>
                            <span className="text-sm text-blue-600">{metrics.categorized}</span>
                        </div>
                        <div className="w-px bg-slate-200 h-5 self-center"></div>
                        <div className="flex flex-col items-center leading-none">
                            <span className="text-slate-400 text-[8px] uppercase tracking-tighter mb-0.5">Índice</span>
                            <span className="text-sm text-slate-700">{metrics.index}%</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700 mt-2">
                    <span className="font-semibold">Fecha: {formatPrintDate()}</span>
                    <span className="text-slate-400">|</span>
                    <span>
                        <span className="font-semibold">Enfermeros/as: </span>
                        {responsibleNurses.length > 0 ? (
                            responsibleNurses.join(', ')
                        ) : (
                            <span className="italic text-slate-400">No registrados</span>
                        )}
                    </span>
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-none print:p-0 print:rounded-none">
                <div className="overflow-x-auto print:overflow-visible">
                    <table className="w-full text-left text-xs border-collapse border border-slate-300 table-fixed min-w-[720px] print:table-auto print:min-w-0 print:text-[7px]">
                        <thead>
                            <tr>
                                <th colSpan={2} className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 print:bg-white print:p-1">PACIENTE</th>
                                <th colSpan={6} className="bg-blue-50 border border-blue-200 p-2 text-center font-bold text-blue-800 print:bg-white print:text-black print:border-slate-300 print:p-1">PUNTOS DEPENDENCIA (0-3)</th>
                                <th colSpan={8} className="bg-red-50 border border-red-200 p-2 text-center font-bold text-red-800 print:bg-white print:text-black print:border-slate-300 print:p-1">PUNTOS DE RIESGO (0-3)</th>
                                <th className="bg-slate-100 border border-slate-300 p-2 text-center font-bold text-slate-700 hidden print:table-cell print:bg-white print:p-1">CAT</th>
                            </tr>
                            <tr className="text-center">
                                <th className="border border-slate-300 p-1 w-10 bg-slate-50 align-middle print:w-auto">CAMA</th>
                                <th className="border border-slate-300 p-1 w-32 bg-slate-50 align-middle print:w-[88px] print:max-w-[88px]">
                                    <span className="print:hidden">NOMBRE</span>
                                    <span className="hidden print:inline">RUT</span>
                                </th>

                                <VerticalHeader text="Cuidados Cambio Ropa" colorClass="bg-blue-50 print:bg-white" />
                                <VerticalHeader text="Cuidados de Movilización" colorClass="bg-blue-50 print:bg-white" />
                                <VerticalHeader text="Cuidados de Alimentación" colorClass="bg-blue-50 print:bg-white" />
                                <VerticalHeader text="Cuidados de Eliminación" colorClass="bg-blue-50 print:bg-white" />
                                <VerticalHeader text="Apoyo Psicosocial y Emocional" colorClass="bg-blue-50 print:bg-white" />
                                <VerticalHeader text="Vigilancia" colorClass="bg-blue-50 print:bg-white" />

                                <VerticalHeader text="Medicición Signos Vitales" colorClass="bg-red-50 print:bg-white" />
                                <VerticalHeader text="Balance Hìdrico" colorClass="bg-red-50 print:bg-white" />
                                <VerticalHeader text="Cuidados de Oxigenoterapia" colorClass="bg-red-50 print:bg-white" />
                                <VerticalHeader text="Cuidados diarios de Vía Aérea" colorClass="bg-red-50 print:bg-white" />
                                <VerticalHeader text="Intervenciones Profesionales" colorClass="bg-red-50 print:bg-white" />
                                <VerticalHeader text="Cuidados de la Piel y Curaciones" colorClass="bg-red-50 print:bg-white" />
                                <VerticalHeader text="Administración Tto Farmacológico" colorClass="bg-red-50 print:bg-white" />
                                <VerticalHeader text="Presencia Elem. Invasivos" colorClass="bg-red-50 print:bg-white" />

                                <th className="border border-slate-300 p-1 w-14 bg-slate-50 align-middle print:w-auto print:p-0.5 print:bg-white">CAT</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleBeds.map((bed) => {
                                const patient = record.beds[bed.id];
                                const cudyr: Partial<CudyrScore> = patient?.cudyr || {};
                                const { finalCat, badgeColor } = getCategorization(cudyr as CudyrScore);
                                const isUTI = bed.type === 'UTI';

                                // Empty bed row - consistent height with occupied beds
                                if (!patient?.patientName) {
                                    return (
                                        <tr
                                            key={bed.id}
                                            className={clsx(
                                                'border-b border-slate-300 h-8 print:h-6',
                                                isUTI ? 'bg-yellow-50 print:bg-white' : 'bg-white'
                                            )}
                                        >
                                            <td className="border-r border-slate-300 p-1 text-center font-bold text-slate-700">{bed.name}</td>
                                            <td colSpan={15} className="border-r border-slate-300 p-1 text-center text-slate-400 italic text-[10px] print:text-[8px]">
                                                Cama disponible
                                            </td>
                                            <td className="p-1 text-center font-semibold">-</td>
                                        </tr>
                                    );
                                }

                                // Occupied bed row - consistent height
                                return (
                                    <tr
                                        key={bed.id}
                                        className={clsx(
                                            'border-b border-slate-300 h-8 print:h-6',
                                            isUTI ? 'bg-yellow-50 print:bg-white' : 'bg-white'
                                        )}
                                    >
                                        <td className="border-r border-slate-300 p-1 text-center font-bold text-slate-700">{bed.name}</td>
                                        <td className="border-r border-slate-300 p-1 truncate font-medium text-slate-700 w-32 print:w-[88px] print:max-w-[88px] print:whitespace-nowrap print:overflow-visible" title={patient.patientName}>
                                            <span className="print:hidden">{patient.patientName}</span>
                                            <span className="hidden print:inline text-[10px]">{patient.rut || '-'}</span>
                                        </td>

                                        {/* Dependency scores with borders */}
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.changeClothes)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.mobilization)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.feeding)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.elimination)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.psychosocial)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.surveillance)}</td>

                                        {/* Risk scores with borders */}
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.vitalSigns)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.fluidBalance)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.oxygenTherapy)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.airway)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.proInterventions)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.skinCare)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.pharmacology)}</td>
                                        <td className="border-r border-slate-300 p-1 text-center">{renderScore(cudyr.invasiveElements)}</td>

                                        <td className="p-1 text-center print:p-0.5">
                                            <span className={clsx(
                                                'px-2 py-0.5 rounded font-bold text-xs block w-full shadow-sm print:px-1 print:text-[10px] print:shadow-none print:rounded-none print:border print:bg-transparent',
                                                badgeColor,
                                                // Print Override: Force B/W aggressively
                                                'print:!bg-white print:!text-black print:!border print:!border-black'
                                            )}>
                                                {finalCat}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

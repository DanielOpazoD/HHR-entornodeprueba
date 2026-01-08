import React, { useState } from 'react';
import { ClipboardList, Calculator, FileSpreadsheet, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { generateCudyrMonthlyExcel } from '@/services/exporters/cudyrExportService';

interface CudyrHeaderProps {
    occupiedCount: number;
    categorizedCount: number;
    currentDate?: string; // YYYY-MM-DD format
}

export const CudyrHeader: React.FC<CudyrHeaderProps> = ({
    occupiedCount,
    categorizedCount,
    currentDate
}) => {
    const [isExporting, setIsExporting] = useState(false);

    const categorizationIndex = occupiedCount > 0
        ? Math.round((categorizedCount / occupiedCount) * 100)
        : 0;

    const handleExportExcel = async () => {
        if (!currentDate || isExporting) return;

        setIsExporting(true);
        try {
            const [year, month] = currentDate.split('-').map(Number);
            await generateCudyrMonthlyExcel(year, month, currentDate);
        } catch (error) {
            console.error('Error exporting CUDYR Excel:', error);
            alert('Error al exportar Excel. Por favor intente nuevamente.');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <header className="mb-4 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <ClipboardList className="text-medical-600" />
                Instrumento CUDYR
            </h2>

            <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
                {/* Stats Box */}
                <div className="flex-1 sm:flex-none flex items-center gap-2 text-[10px] font-bold uppercase bg-blue-50 px-2 py-1 rounded border border-blue-200 text-blue-800 shadow-sm whitespace-nowrap">
                    <span className="flex items-center gap-1"><Calculator size={12} /> Resumen:</span>
                    <span className="border-l border-blue-200 pl-2">
                        Ocupadas: <span className="text-sm">{occupiedCount}</span>
                    </span>
                    <span className="border-l border-blue-200 pl-2">
                        Categorizados: <span className="text-sm">{categorizedCount}</span>
                    </span>
                    <span className="border-l border-blue-200 pl-2">
                        Índice: <span className={clsx(
                            "text-sm",
                            categorizationIndex === 100 ? "text-green-600" : "text-blue-800"
                        )}>{categorizationIndex}%</span>
                    </span>
                </div>

                {/* Legend Box */}
                <div className="flex-1 sm:flex-none flex items-center justify-center sm:justify-start gap-2 text-[10px] font-bold uppercase bg-slate-50 px-2 py-1 rounded border border-slate-200 shadow-sm">
                    <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 bg-red-600 rounded-full"></span> A: Máximo
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 bg-orange-500 rounded-full"></span> B: Alto
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 bg-yellow-400 rounded-full"></span> C: Medio
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 bg-green-600 rounded-full"></span> D: Bajo
                    </span>
                </div>

                {/* Excel Export Button */}
                {currentDate && (
                    <button
                        onClick={handleExportExcel}
                        disabled={isExporting}
                        className={clsx(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm",
                            isExporting
                                ? "bg-slate-100 text-slate-400 cursor-wait"
                                : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95"
                        )}
                        title="Exportar resumen mensual a Excel"
                    >
                        {isExporting ? (
                            <>
                                <Loader2 size={14} className="animate-spin" />
                                Exportando...
                            </>
                        ) : (
                            <>
                                <FileSpreadsheet size={14} />
                                Excel Mensual
                            </>
                        )}
                    </button>
                )}
            </div>
        </header>
    );
};

import React, { useState } from 'react';
import { BarChart3, Calculator, FileSpreadsheet, Loader2, Lock, Unlock, ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { generateCudyrMonthlyExcel } from '@/services/exporters/cudyrExportService';

interface CudyrHeaderProps {
    occupiedCount: number;
    categorizedCount: number;
    currentDate?: string; // YYYY-MM-DD format
    isLocked?: boolean;
    lockedAt?: string;
    lockedBy?: string;
    onToggleLock?: () => void;
    canToggle?: boolean;
}

export const CudyrHeader: React.FC<CudyrHeaderProps> = ({
    occupiedCount,
    categorizedCount,
    currentDate,
    isLocked = false,
    lockedAt,
    lockedBy,
    onToggleLock,
    canToggle = false
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

    // Format lock timestamp for tooltip
    const formatLockTime = (isoString?: string) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        return date.toLocaleString('es-CL', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const lockTooltip = isLocked && lockedAt
        ? `Bloqueado el ${formatLockTime(lockedAt)}${lockedBy ? ` por ${lockedBy}` : ''}`
        : 'Click para bloquear edición CUDYR';

    return (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {/* Left: Back Button + Title + Lock */}
            <div className="flex items-center gap-2">
                {/* Back to Night Handoff Button */}
                <button
                    onClick={() => {
                        // Navigate to nursing handoff and set shift to night
                        window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'NURSING_HANDOFF' }));
                        window.dispatchEvent(new CustomEvent('set-shift', { detail: 'night' }));
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                    title="Volver a Entrega de Turno Noche"
                >
                    <ArrowLeft size={12} />
                    <span className="hidden sm:inline">Turno Noche</span>
                </button>

                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-1.5">
                    <BarChart3 size={20} className="text-slate-600" />
                    Instrumento CUDYR
                </h2>

                {/* Lock Button */}
                {canToggle && onToggleLock && (
                    <button
                        onClick={onToggleLock}
                        className={clsx(
                            "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-all border",
                            isLocked
                                ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        )}
                        title={lockTooltip}
                    >
                        {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                        {isLocked ? "Bloqueado" : "Desbloqueado"}
                    </button>
                )}
            </div>

            {/* Right: Stats + Legend + Excel Button */}
            <div className="flex flex-wrap items-center gap-1.5">
                {/* Stats Box - Compact */}
                <div className="flex items-center gap-1 text-[9px] font-bold uppercase bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 text-blue-800">
                    <Calculator size={10} />
                    <span>Ocupadas: <b className="text-xs">{occupiedCount}</b></span>
                    <span className="text-blue-300">|</span>
                    <span>Categ: <b className="text-xs">{categorizedCount}</b></span>
                    <span className="text-blue-300">|</span>
                    <span>Índice: <b className={clsx("text-xs", categorizationIndex === 100 && "text-green-600")}>{categorizationIndex}%</b></span>
                </div>

                {/* Legend Box - Compact */}
                <div className="flex items-center gap-1.5 text-[8px] font-bold uppercase bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                    <span className="flex items-center gap-0.5">
                        <span className="w-2 h-2 bg-red-600 rounded-full"></span>A
                    </span>
                    <span className="flex items-center gap-0.5">
                        <span className="w-2 h-2 bg-orange-500 rounded-full"></span>B
                    </span>
                    <span className="flex items-center gap-0.5">
                        <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>C
                    </span>
                    <span className="flex items-center gap-0.5">
                        <span className="w-2 h-2 bg-green-600 rounded-full"></span>D
                    </span>
                </div>

                {/* Excel Export Button */}
                {currentDate && (
                    <button
                        onClick={handleExportExcel}
                        disabled={isExporting}
                        className={clsx(
                            "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-all",
                            isExporting
                                ? "bg-slate-100 text-slate-400 cursor-wait"
                                : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95"
                        )}
                        title="Exportar resumen mensual a Excel"
                    >
                        {isExporting ? (
                            <>
                                <Loader2 size={12} className="animate-spin" />
                                Exportando...
                            </>
                        ) : (
                            <>
                                <FileSpreadsheet size={12} />
                                Excel
                            </>
                        )}
                    </button>
                )}
            </div>
        </header>
    );
};

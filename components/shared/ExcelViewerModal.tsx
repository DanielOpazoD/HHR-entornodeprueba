/**
 * ExcelViewerModal Component
 * 
 * A reusable modal for viewing Excel files with multi-sheet support.
 * Uses the useExcelParser hook for parsing logic.
 * 
 * Features:
 * - Multi-sheet navigation via tabs
 * - Merged cell support (colSpan/rowSpan)
 * - Compact data columns (dates, RUTs)
 * - Overflow labels for long headers
 * - Download button integration
 */

import React, { useEffect } from 'react';
import {
    FileSpreadsheet,
    Download,
    X,
    Loader2,
    AlertCircle,
    Layout,
    ShieldCheck
} from 'lucide-react';
import clsx from 'clsx';
import { useExcelParser, ParsedCell } from '../../hooks/useExcelParser';

// ============================================================================
// Types
// ============================================================================

export interface ExcelViewerModalProps {
    /** File name to display in header */
    fileName: string;
    /** URL to download the Excel file from */
    downloadUrl: string;
    /** Whether user can download the file */
    canDownload?: boolean;
    /** Callback when user closes the modal */
    onClose: () => void;
    /** Callback when user clicks download */
    onDownload?: () => void;
    /** Optional subtitle for the header */
    subtitle?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if cell value looks like a compact data type (date or RUT)
 */
const isCompactData = (value: string): boolean => {
    // Date format: DD-MM-YYYY or similar
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(value)) return true;
    // Chilean RUT format
    if (/^\d{1,2}\.\d{3}\.\d{3}-[\dK]$/i.test(value)) return true;
    return false;
};

/**
 * Check if cell value is a label that should overflow visually
 */
const isLabelOverflow = (value: string): boolean => {
    return (
        value.includes('CENSO') ||
        value.includes('TABLA') ||
        value.includes('Fecha:') ||
        value.includes('Enfermeros') ||
        value.includes('ALTAS DEL DÍA') ||
        value.includes('TRASLADOS DEL DÍA') ||
        value.includes('HOSPITALIZACIÓN DIURNA') ||
        value.includes('FALLECIDO')
    );
};

// ============================================================================
// Component
// ============================================================================

export const ExcelViewerModal: React.FC<ExcelViewerModalProps> = ({
    fileName,
    downloadUrl,
    canDownload = false,
    onClose,
    onDownload,
    subtitle = 'Censo Hospital Hanga Roa'
}) => {
    const {
        workbookData,
        sheetNames,
        activeSheet,
        setActiveSheet,
        isParsing,
        parseError,
        parseFromUrl,
        reset
    } = useExcelParser();

    // Parse file on mount
    useEffect(() => {
        parseFromUrl(downloadUrl);

        // Cleanup on unmount
        return () => reset();
    }, [downloadUrl, parseFromUrl, reset]);

    const handleClose = () => {
        reset();
        onClose();
    };

    const currentSheet = workbookData[activeSheet] || [];

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full h-full max-w-6xl max-h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                {/* Compact Modal Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center text-green-600 border border-green-100">
                            <FileSpreadsheet size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800 leading-tight">
                                {fileName}
                            </h2>
                            <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">
                                {subtitle}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {canDownload && onDownload && (
                            <button
                                onClick={onDownload}
                                className="hidden sm:flex bg-medical-600 hover:bg-medical-700 text-white font-bold h-10 px-6 rounded-xl text-xs transition-all items-center gap-2 shadow-sm shadow-medical-100"
                            >
                                <Download size={16} />
                                Descargar Original
                            </button>
                        )}
                        <button
                            onClick={handleClose}
                            className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="flex-1 bg-slate-50 relative overflow-hidden flex flex-col">
                    {isParsing ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 p-12 text-center">
                            <Loader2 className="w-12 h-12 text-medical-600 animate-spin mb-4" />
                            <p className="text-slate-600 font-bold">Cargando censo diario...</p>
                            <p className="text-slate-400 text-xs mt-1">Optimizando visualización de todas las hojas</p>
                        </div>
                    ) : parseError ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-white">
                            <AlertCircle size={48} className="text-amber-500 mb-4" />
                            <h3 className="text-xl font-bold text-slate-800 mb-2">Error de Apertura</h3>
                            <p className="text-slate-500 max-w-md mb-8">{parseError}</p>
                            {canDownload && onDownload && (
                                <button
                                    onClick={onDownload}
                                    className="bg-medical-600 text-white font-bold py-3 px-8 rounded-2xl transition-all flex items-center gap-2 shadow-lg shadow-medical-200"
                                >
                                    <Download size={20} />
                                    Descargar para ver en Excel
                                </button>
                            )}
                        </div>
                    ) : activeSheet && currentSheet.length > 0 ? (
                        <div className="flex-1 overflow-auto bg-slate-100 custom-scrollbar relative">
                            <div className="bg-white m-3 sm:m-4 rounded-xl shadow-sm border border-slate-200 min-w-max overflow-hidden">
                                <table className="table-auto border-collapse">
                                    <tbody className="bg-white">
                                        {currentSheet.map((row, rowIndex) => (
                                            <tr
                                                key={rowIndex}
                                                className="hover:bg-medical-50/20 transition-colors group"
                                            >
                                                {row.map((cell: ParsedCell, cellIndex: number) => {
                                                    if (cell.hidden) return null;

                                                    const valStr = cell.value === null || cell.value === undefined
                                                        ? ''
                                                        : String(cell.value);
                                                    const isCompact = isCompactData(valStr);
                                                    const isIndexCol = cellIndex === 0 && cell.colSpan === 1;
                                                    const isOverflow = isLabelOverflow(valStr);

                                                    return (
                                                        <td
                                                            key={cellIndex}
                                                            colSpan={cell.colSpan}
                                                            rowSpan={cell.rowSpan}
                                                            className={clsx(
                                                                "px-3 py-2 text-[10px] sm:text-[11px] text-slate-600 border border-slate-100 relative",
                                                                isIndexCol && "w-[40px] max-w-[40px] min-w-[40px] text-center text-slate-400 bg-slate-50/50 font-bold",
                                                                isCompact && "w-[1%] whitespace-nowrap text-center",
                                                                !isIndexCol && !isCompact && !isOverflow && (cell.colSpan > 1 ? "whitespace-normal max-w-[400px]" : "whitespace-nowrap"),
                                                                isOverflow && "font-bold text-slate-800",
                                                                rowIndex < 10 && !isOverflow && "font-medium"
                                                            )}
                                                        >
                                                            {isOverflow ? (
                                                                <div className="relative">
                                                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 whitespace-nowrap z-20 bg-white/80 pr-2 backdrop-blur-[1px]">
                                                                        {valStr}
                                                                    </div>
                                                                    <div className="invisible">...</div>
                                                                </div>
                                                            ) : (
                                                                valStr
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}

                    {/* Sheet Tabs - Bottom Navigation */}
                    {!isParsing && !parseError && sheetNames.length > 1 && (
                        <div className="bg-white border-t border-slate-200 flex items-center gap-1 px-4 h-11 overflow-x-auto shrink-0 scrollbar-hide">
                            <div className="flex items-center gap-1.5 mr-4 text-slate-400 text-[10px] font-extrabold uppercase tracking-widest shrink-0">
                                <Layout size={14} />
                                Hojas:
                            </div>
                            {sheetNames.map((name) => (
                                <button
                                    key={name}
                                    onClick={() => setActiveSheet(name)}
                                    className={clsx(
                                        "h-full px-5 text-xs font-bold transition-all border-b-2 flex items-center gap-2 whitespace-nowrap",
                                        activeSheet === name
                                            ? "border-medical-500 text-medical-700 bg-medical-50/20"
                                            : "border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                                    )}
                                >
                                    {name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Standard Modal Footer */}
                <div className="px-6 py-4 bg-white border-t border-slate-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 text-slate-400 text-[9px] font-bold uppercase tracking-wider">
                        <ShieldCheck size={14} className="text-green-500" />
                        Acceso Seguro Directo
                    </div>
                    <button
                        onClick={handleClose}
                        className="bg-slate-100 text-slate-600 font-bold h-9 px-8 rounded-xl text-xs hover:bg-slate-200 transition-all active:scale-95"
                    >
                        Cerrar Documento
                    </button>
                </div>
            </div>
        </div>
    );
};

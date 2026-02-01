/**
 * ExcelViewerModal Component
 * 
 * A reusable modal for viewing Excel files with multi-sheet support.
 * Uses the useExcelParser hook for parsing logic.
 */

import React, { useEffect } from 'react';
import {
    FileSpreadsheet,
    Download,
    Loader2,
    AlertCircle,
    Layout,
    ShieldCheck
} from 'lucide-react';
import clsx from 'clsx';
import { useExcelParser, ParsedCell } from '@/hooks/useExcelParser';
import { BaseModal } from './BaseModal';

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

const isCompactData = (value: string): boolean => {
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(value)) return true;
    if (/^\d{1,2}\.\d{3}\.\d{3}-[\dK]$/i.test(value)) return true;
    return false;
};

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

    useEffect(() => {
        parseFromUrl(downloadUrl);
        return () => reset();
    }, [downloadUrl, parseFromUrl, reset]);

    const handleClose = () => {
        reset();
        onClose();
    };

    const currentSheet = workbookData[activeSheet] || [];

    return (
        <BaseModal
            isOpen={true}
            onClose={handleClose}
            title={
                <div>
                    <h2 className="text-lg font-bold text-slate-800 leading-tight">{fileName}</h2>
                    <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">{subtitle}</p>
                </div>
            }
            icon={<FileSpreadsheet size={20} />}
            size="full"
            variant="white"
            headerIconColor="text-emerald-600"
            headerActions={
                canDownload && onDownload && (
                    <button
                        onClick={onDownload}
                        className="hidden sm:flex bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-9 px-4 rounded-xl text-xs transition-all items-center gap-2 shadow-sm shadow-emerald-100 active:scale-95"
                    >
                        <Download size={14} />
                        Descargar
                    </button>
                )
            }
        >
            <div className="flex flex-col h-[70vh] -m-6 box-border">
                {/* Modal Body Content */}
                <div className="flex-1 bg-slate-50 relative overflow-hidden flex flex-col">
                    {isParsing ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 p-12 text-center">
                            <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
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
                                    className="bg-emerald-600 text-white font-bold py-3 px-8 rounded-2xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-200"
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
                                                className="hover:bg-emerald-50/20 transition-colors group"
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
                                            ? "border-emerald-500 text-emerald-700 bg-emerald-50/20"
                                            : "border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                                    )}
                                >
                                    {name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer Section inside Body */}
                <div className="px-6 py-4 bg-white border-t border-slate-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 text-slate-400 text-[9px] font-bold uppercase tracking-wider">
                        <ShieldCheck size={14} className="text-emerald-500" />
                        Acceso Seguro Directo
                    </div>
                    <button
                        onClick={handleClose}
                        className="bg-slate-100 text-slate-600 font-bold h-9 px-8 rounded-xl text-xs hover:bg-slate-200 transition-all active:scale-95"
                    >
                        Cerrar Ventana
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};

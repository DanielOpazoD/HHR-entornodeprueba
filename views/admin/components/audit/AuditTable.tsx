import React from 'react';
import {
    RefreshCw, Search, List, Rows3, Box, Boxes, FileDown, Download
} from 'lucide-react';
import clsx from 'clsx';
import { AuditLogEntry } from '@/types/audit';
import { AuditLogRow } from './AuditLogRow';

interface AuditTableProps {
    filteredLogs: AuditLogEntry[];
    paginatedLogs: AuditLogEntry[];
    loading: boolean;
    compactView: boolean;
    setCompactView: (val: boolean) => void;
    groupedView: boolean;
    setGroupedView: (val: boolean) => void;
    expandedRows: Set<string>;
    toggleRow: (id: string) => void;
    onPdfExport: () => void;
    onExcelExport: () => void;
    isExporting: boolean;
}

export const AuditTable: React.FC<AuditTableProps> = ({
    filteredLogs,
    paginatedLogs,
    loading,
    compactView,
    setCompactView,
    groupedView,
    setGroupedView,
    expandedRows,
    toggleRow,
    onPdfExport,
    onExcelExport,
    isExporting
}) => {
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Table Toolbar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/30">
                <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-slate-500">
                        {filteredLogs.length} registros
                    </span>
                    {/* Compact View Toggle */}
                    <button
                        onClick={() => setCompactView(!compactView)}
                        className={clsx(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                            compactView
                                ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        )}
                        title={compactView ? "Vista normal" : "Vista compacta"}
                    >
                        {compactView ? <List size={14} /> : <Rows3 size={14} />}
                        {compactView ? "Compacto" : "Normal"}
                    </button>
                    {/* Grouped View Toggle */}
                    <button
                        onClick={() => setGroupedView(!groupedView)}
                        className={clsx(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                            groupedView
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        )}
                        title={groupedView ? "Vista individual" : "Agrupar por sección/día"}
                    >
                        {groupedView ? <Box size={14} /> : <Boxes size={14} />}
                        {groupedView ? "Agrupado" : "Individual"}
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {/* PDF Export Button */}
                    <button
                        onClick={onPdfExport}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-all"
                    >
                        <FileDown size={14} />
                        PDF
                    </button>
                    {/* Excel Export Button */}
                    <button
                        onClick={onExcelExport}
                        disabled={isExporting}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-50"
                    >
                        <Download size={14} />
                        Excel
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50/50 border-b border-slate-100">
                        <tr className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                            <th className="px-6 py-4 text-left w-6"></th>
                            <th className="px-4 py-4 text-left">Fecha/Hora</th>
                            <th className="px-4 py-4 text-left">Operador</th>
                            {!compactView && <th className="px-4 py-4 text-left">Acción</th>}
                            <th className="px-4 py-4 text-left">Resumen</th>
                            {!compactView && <th className="px-4 py-4 text-left">Paciente</th>}
                            {!compactView && <th className="px-4 py-4 text-left">Cama</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="px-4 py-20 text-center">
                                    <div className="flex flex-col items-center gap-3">
                                        <RefreshCw size={40} className="animate-spin text-indigo-500 opacity-20" />
                                        <p className="text-slate-400 font-medium animate-pulse">Sincronizando registros clínicos...</p>
                                    </div>
                                </td>
                            </tr>
                        ) : filteredLogs.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-4 py-20 text-center">
                                    <div className="flex flex-col items-center gap-3 opacity-30">
                                        <Search size={48} className="text-slate-300" />
                                        <p className="text-slate-500 font-bold">No se encontraron rastros para los filtros aplicados</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            paginatedLogs.map((log) => (
                                <AuditLogRow
                                    key={log.id}
                                    log={log}
                                    isExpanded={expandedRows.has(log.id)}
                                    onToggle={() => toggleRow(log.id)}
                                    compactView={compactView}
                                />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

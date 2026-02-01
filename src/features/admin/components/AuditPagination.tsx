/**
 * AuditPagination Component
 * Extracted from AuditView.tsx for better maintainability
 */
import React from 'react';
import { AlertCircle } from 'lucide-react';

interface AuditPaginationProps {
    currentPage: number;
    totalPages: number;
    paginatedCount: number;
    filteredCount: number;
    totalCount: number;
    onPageChange: (page: number) => void;
}

/**
 * Pagination controls for audit logs
 * Shows page navigation and record counts
 */
export const AuditPagination: React.FC<AuditPaginationProps> = ({
    currentPage,
    totalPages,
    paginatedCount,
    filteredCount,
    totalCount,
    onPageChange
}) => {
    return (
        <div className="flex items-center justify-between text-slate-500 text-xs font-medium px-2 py-3 bg-slate-50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                Mostrando {paginatedCount} de {filteredCount} filtrados ({totalCount} totales)
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold"
                    >
                        ← Anterior
                    </button>
                    <span className="text-slate-700 font-bold">
                        Página {currentPage} de {totalPages}
                    </span>
                    <button
                        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold"
                    >
                        Siguiente →
                    </button>
                </div>
            )}

            <div className="flex items-center gap-4 italic text-slate-400">
                <AlertCircle size={14} />
                Los registros de auditoría son de solo lectura y no pueden ser modificados.
            </div>
        </div>
    );
};

import React from 'react';
import { ClipboardList, Info, Download, RefreshCw, Layers } from 'lucide-react';

interface AuditHeaderProps {
    onShowCompliance: () => void;
    onExport: () => void;
    onRefresh: () => void;
    onConsolidate?: () => void;
    isExporting: boolean;
    isLoading: boolean;
    isConsolidating?: boolean;
    hasLogs: boolean;
    isAdmin?: boolean;
}

export const AuditHeader: React.FC<AuditHeaderProps> = ({
    onShowCompliance,
    onExport,
    onRefresh,
    onConsolidate,
    isExporting,
    isLoading,
    isConsolidating = false,
    hasLogs,
    isAdmin = false
}) => {
    return (
        <header className="sticky top-0 z-20 backdrop-blur-md bg-white/80 p-6 rounded-2xl shadow-sm border border-slate-200/60 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
                    <ClipboardList className="text-white" size={24} />
                </div>
                <div>
                    <h2 className="text-2xl font-display font-bold text-slate-900 tracking-tight">
                        Registro de Auditoría
                    </h2>
                    <p className="text-sm text-slate-500 font-medium">Cumplimiento Ley 20.584 • Integridad Clínica</p>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button
                    onClick={onShowCompliance}
                    className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all border border-indigo-100"
                    title="Ver enfoque de auditoría MINSAL"
                >
                    <Info size={20} />
                </button>

                {/* Consolidate button - Admin only */}
                {isAdmin && onConsolidate && (
                    <button
                        onClick={onConsolidate}
                        disabled={isConsolidating || !hasLogs}
                        className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 text-amber-700 rounded-xl hover:bg-amber-100 transition-all font-bold text-sm border border-amber-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        title="Consolidar logs duplicados"
                    >
                        <Layers size={18} className={isConsolidating ? 'animate-pulse' : ''} />
                        {isConsolidating ? 'Consolidando...' : 'Consolidar'}
                    </button>
                )}

                <button
                    onClick={onExport}
                    disabled={isExporting || !hasLogs}
                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl hover:bg-emerald-100 transition-all font-bold text-sm border border-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                    <Download size={18} className={isExporting ? 'animate-bounce' : ''} />
                    {isExporting ? 'Exportando...' : 'Exportar Excel'}
                </button>
                <button
                    onClick={onRefresh}
                    className="p-2.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all border border-slate-200"
                    title="Actualizar datos"
                >
                    <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>
        </header>
    );
};


import React from 'react';
import { Search, Filter, History } from 'lucide-react';
import { AuditAction } from '@/types/audit';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditService';

interface AuditFiltersProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
    searchRut: string;
    onSearchRutChange: (value: string) => void;
    filterAction: AuditAction | 'ALL';
    onFilterActionChange: (value: AuditAction | 'ALL') => void;
    startDate: string;
    onStartDateChange: (value: string) => void;
    endDate: string;
    onEndDateChange: (value: string) => void;
    onFocusTraceability?: () => void;
}

export const AuditFilters: React.FC<AuditFiltersProps> = ({
    searchTerm,
    onSearchChange,
    searchRut,
    onSearchRutChange,
    filterAction,
    onFilterActionChange,
    startDate,
    onStartDateChange,
    endDate,
    onEndDateChange,
    onFocusTraceability
}) => {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-white p-5 rounded-2xl shadow-sm border border-slate-100 items-end">
            {/* Search */}
            <div className="lg:col-span-3 space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Búsqueda Inteligente</label>
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Nombre o RUT..."
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
                    />
                </div>
            </div>

            {/* Filter Action */}
            <div className="lg:col-span-3 space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Filtrar Acción</label>
                <div className="relative">
                    <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <select
                        value={filterAction}
                        onChange={(e) => onFilterActionChange(e.target.value as AuditAction | 'ALL')}
                        className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all appearance-none cursor-pointer"
                    >
                        <option value="ALL">Todas las acciones</option>
                        {Object.entries(AUDIT_ACTION_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Search Rut (Traceability) */}
            <div className="lg:col-span-3 space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Trazabilidad por RUT</label>
                <div className="relative">
                    <History size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-500" />
                    <input
                        type="text"
                        placeholder="RUT para trazabilidad..."
                        value={searchRut}
                        onChange={(e) => onSearchRutChange(e.target.value)}
                        onFocus={onFocusTraceability}
                        className="w-full pl-10 pr-4 py-2.5 text-sm bg-cyan-50/30 border border-cyan-100 rounded-xl focus:outline-none focus:ring-4 focus:ring-cyan-500/10 focus:border-cyan-500 transition-all font-mono"
                    />
                </div>
            </div>

            {/* Date Range */}
            <div className="lg:col-span-3 grid grid-cols-2 gap-3 items-end">
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Desde</label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => onStartDateChange(e.target.value)}
                        className="w-full px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
                    />
                </div>
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Hasta</label>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => onEndDateChange(e.target.value)}
                        className="w-full px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
                    />
                </div>
            </div>
        </div>
    );
};

import React from 'react';
import { Search, Filter, CalendarRange } from 'lucide-react';
import { AuditAction } from '@/types/auditActionTypes';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditConstants';
import {
  AUDIT_DATE_RANGE_PRESETS,
  type AuditDateRangePreset,
} from '@/services/admin/auditDateRangePresets';

interface AuditFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filterAction: AuditAction | 'ALL';
  onFilterActionChange: (value: AuditAction | 'ALL') => void;
  startDate: string;
  onStartDateChange: (value: string) => void;
  endDate: string;
  onEndDateChange: (value: string) => void;
  onDateRangePreset: (preset: AuditDateRangePreset) => void;
}

export const AuditFilters: React.FC<AuditFiltersProps> = ({
  searchTerm,
  onSearchChange,
  filterAction,
  onFilterActionChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  onDateRangePreset,
}) => {
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-1">
          <CalendarRange size={14} className="text-slate-400" />
          Rango rápido
        </div>
        {AUDIT_DATE_RANGE_PRESETS.map(preset => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onDateRangePreset(preset.id)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-9 gap-4 items-end">
        {/* Search */}
        <div className="lg:col-span-3 space-y-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
            Búsqueda clínica/legal
          </label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Paciente, RUT, usuario, UID, IP, acción o registro..."
              value={searchTerm}
              onChange={e => onSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
            />
          </div>
        </div>

        {/* Filter Action */}
        <div className="lg:col-span-3 space-y-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
            Filtrar Acción
          </label>
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={filterAction}
              onChange={e => onFilterActionChange(e.target.value as AuditAction | 'ALL')}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all appearance-none cursor-pointer"
            >
              <option value="ALL">Todas las acciones</option>
              {Object.entries(AUDIT_ACTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Date Range */}
        <div className="lg:col-span-3 grid grid-cols-2 gap-3 items-end">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
              Desde
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => onStartDateChange(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
              Hasta
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => onEndDateChange(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

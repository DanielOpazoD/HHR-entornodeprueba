import { CalendarDays, ChevronLeft, ChevronRight, Filter, Search } from 'lucide-react';
import type {
  SystemHealthDateRange,
  SystemHealthEventTypeFilter,
  SystemHealthSeverityFilter,
} from './systemHealthIncidentUtils';

export const SystemHealthTriageToolbar = ({
  searchTerm,
  dateRange,
  selectedDate,
  severity,
  eventType,
  onSearchTermChange,
  onDateRangeChange,
  onSelectedDateChange,
  onSeverityChange,
  onEventTypeChange,
  onShiftDate,
}: {
  searchTerm: string;
  dateRange: SystemHealthDateRange;
  selectedDate: string;
  severity: SystemHealthSeverityFilter;
  eventType: SystemHealthEventTypeFilter;
  onSearchTermChange: (value: string) => void;
  onDateRangeChange: (value: SystemHealthDateRange) => void;
  onSelectedDateChange: (value: string) => void;
  onSeverityChange: (value: SystemHealthSeverityFilter) => void;
  onEventTypeChange: (value: SystemHealthEventTypeFilter) => void;
  onShiftDate: (deltaDays: number) => void;
}) => (
  <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.3fr)_160px_150px_170px_190px]">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input
          type="text"
          placeholder="Buscar usuario, modulo, cama o campo..."
          value={searchTerm}
          onChange={event => onSearchTermChange(event.target.value)}
          className="w-full rounded-md border border-slate-200 bg-white py-2 pr-4 pl-9 text-xs outline-none transition-all focus:border-medical-500 focus:ring-2 focus:ring-medical-500/20"
        />
      </div>

      <label className="relative">
        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <select
          value={severity}
          onChange={event => onSeverityChange(event.target.value as SystemHealthSeverityFilter)}
          className="w-full appearance-none rounded-md border border-slate-200 bg-white py-2 pr-3 pl-9 text-xs font-semibold text-slate-700 outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-500/20"
        >
          <option value="all">Toda severidad</option>
          <option value="critical">Criticos</option>
          <option value="warning">Advertencias</option>
          <option value="healthy">Saludables</option>
        </select>
      </label>

      <select
        value={eventType}
        onChange={event => onEventTypeChange(event.target.value as SystemHealthEventTypeFilter)}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-500/20"
      >
        <option value="all">Todo tipo</option>
        <option value="sync">Sync</option>
        <option value="local_error">Errores locales</option>
        <option value="sync_conflict">Conflictos</option>
        <option value="operational">Operacional</option>
      </select>

      <label className="relative">
        <CalendarDays
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          size={14}
        />
        <select
          value={dateRange}
          onChange={event => onDateRangeChange(event.target.value as SystemHealthDateRange)}
          className="w-full appearance-none rounded-md border border-slate-200 bg-white py-2 pr-3 pl-9 text-xs font-semibold text-slate-700 outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-500/20"
        >
          <option value="last24h">Ultimas 24 h</option>
          <option value="day">Fecha</option>
          <option value="last7d">Ultimos 7 dias</option>
          <option value="all">Todo</option>
        </select>
      </label>

      <div className="grid grid-cols-[32px_minmax(0,1fr)_32px] gap-2">
        <button
          type="button"
          onClick={() => onShiftDate(-1)}
          disabled={dateRange !== 'day'}
          className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          title="Fecha anterior"
          aria-label="Fecha anterior"
        >
          <ChevronLeft size={14} />
        </button>
        <input
          type="date"
          value={selectedDate}
          onChange={event => onSelectedDateChange(event.target.value)}
          disabled={dateRange !== 'day'}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-500/20 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <button
          type="button"
          onClick={() => onShiftDate(1)}
          disabled={dateRange !== 'day'}
          className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          title="Fecha siguiente"
          aria-label="Fecha siguiente"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  </section>
);

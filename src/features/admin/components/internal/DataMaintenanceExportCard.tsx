import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Database,
  Download,
  FileJson,
  ShieldCheck,
} from 'lucide-react';
import clsx from 'clsx';

interface DataMaintenanceExportCardProps {
  isExporting: boolean;
  exportError: string | null;
  exportWarning: string | null;
  exportSuccess: boolean;
  exportingScope: 'month' | 'year' | null;
  selectedYear: number;
  selectedMonth: number;
  years: number[];
  months: Array<{ value: number; label: string }>;
  onSelectYear: (year: number) => void;
  onSelectMonth: (month: number) => void;
  onExport: (scope: 'month' | 'year') => void;
}

export const DataMaintenanceExportCard: React.FC<DataMaintenanceExportCardProps> = ({
  isExporting,
  exportError,
  exportWarning,
  exportSuccess,
  exportingScope,
  selectedYear,
  selectedMonth,
  years,
  months,
  onSelectYear,
  onSelectMonth,
  onExport,
}) => (
  <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
      <Download className="text-emerald-600" size={20} />
    </div>
    <h3 className="mb-1 text-base font-bold text-slate-800">Exportar Respaldo Mensual</h3>
    <p className="mb-4 text-[11px] leading-relaxed text-slate-500">
      Selecciona el periodo y descarga todos los registros en un archivo JSON seguro.
    </p>

    <div className="mb-6 grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <label className="ml-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
          Año
        </label>
        <div className="relative">
          <select
            value={selectedYear}
            onChange={event => onSelectYear(parseInt(event.target.value, 10))}
            className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            {years.map(year => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={14}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="ml-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
          Mes
        </label>
        <div className="relative">
          <select
            value={selectedMonth}
            onChange={event => onSelectMonth(parseInt(event.target.value, 10))}
            className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            {months.map(month => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={14}
          />
        </div>
      </div>
    </div>

    <div className="mt-auto space-y-4">
      {exportError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700"
        >
          <AlertCircle size={14} />
          {exportError}
        </div>
      )}
      {exportWarning && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-800"
        >
          <AlertTriangle size={14} className="shrink-0" />
          {exportWarning}
        </div>
      )}
      {exportSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
          <ShieldCheck size={14} />
          Respaldo generado correctamente
        </div>
      )}
      <div className="grid grid-cols-1 gap-3">
        <button
          onClick={() => onExport('month')}
          disabled={isExporting}
          className={clsx(
            'flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 font-bold shadow-lg transition-all',
            isExporting
              ? 'cursor-not-allowed bg-slate-100 text-slate-400'
              : 'bg-emerald-600 text-white shadow-emerald-100 hover:scale-[1.02] hover:bg-emerald-700 active:scale-95'
          )}
        >
          {isExporting && exportingScope === 'month' ? (
            <Database className="animate-spin" size={20} />
          ) : (
            <FileJson size={20} />
          )}
          {isExporting && exportingScope === 'month' ? 'Procesando...' : 'Descargar mes en JSON'}
        </button>
        <button
          onClick={() => onExport('year')}
          disabled={isExporting}
          className={clsx(
            'flex w-full items-center justify-center gap-2 rounded-2xl border px-6 py-3.5 font-bold transition-all',
            isExporting
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              : 'border-emerald-200 bg-white text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50'
          )}
        >
          {isExporting && exportingScope === 'year' ? (
            <Database className="animate-spin" size={18} />
          ) : (
            <Download size={18} />
          )}
          {isExporting && exportingScope === 'year'
            ? 'Procesando...'
            : 'Descargar año hasta la fecha'}
        </button>
      </div>
    </div>
  </div>
);

import React from 'react';
import clsx from 'clsx';
import { CalendarDays, Clock, FileText, RotateCcw, Search } from 'lucide-react';

interface LabViewerComparisonToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  includeTimeInColumns: boolean;
  onIncludeTimeInColumnsChange: (value: boolean) => void;
  hiddenColumnCount: number;
  onRestoreColumns: () => void;
  onToggleExportConfig: () => void;
}

export const LabViewerComparisonToolbar: React.FC<LabViewerComparisonToolbarProps> = ({
  searchQuery,
  onSearchChange,
  includeTimeInColumns,
  onIncludeTimeInColumnsChange,
  hiddenColumnCount,
  onRestoreColumns,
  onToggleExportConfig,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-1.5">
    <div className="relative min-w-[220px] max-w-sm flex-1">
      <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        value={searchQuery}
        onChange={event => onSearchChange(event.target.value)}
        placeholder="Buscar variable…"
        className="w-full rounded-lg border border-slate-200 bg-white py-1 pl-7 pr-2 text-[10px] text-slate-700 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
      />
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      {hiddenColumnCount > 0 ? (
        <button
          type="button"
          onClick={onRestoreColumns}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          <RotateCcw size={11} />
          Mostrar columnas ({hiddenColumnCount})
        </button>
      ) : null}
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
        <button
          type="button"
          aria-pressed={!includeTimeInColumns}
          onClick={() => onIncludeTimeInColumnsChange(false)}
          className={clsx(
            'inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors',
            !includeTimeInColumns
              ? 'bg-slate-800 text-white'
              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
          )}
        >
          <CalendarDays size={11} />
          Solo fecha
        </button>
        <button
          type="button"
          aria-pressed={includeTimeInColumns}
          onClick={() => onIncludeTimeInColumnsChange(true)}
          className={clsx(
            'inline-flex items-center gap-1 border-l border-slate-200 px-2 py-1 text-[10px] font-medium transition-colors',
            includeTimeInColumns
              ? 'bg-slate-800 text-white'
              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
          )}
        >
          <Clock size={11} />
          Fecha + hora
        </button>
      </div>
      <button
        type="button"
        onClick={onToggleExportConfig}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
      >
        <FileText size={11} />
        Exportar Excel
      </button>
    </div>
  </div>
);

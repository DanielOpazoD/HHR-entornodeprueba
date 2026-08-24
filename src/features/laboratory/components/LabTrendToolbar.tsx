import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, Search, SlidersHorizontal } from 'lucide-react';
import type { LabTrendTimeRange } from '../controllers/labTrendFilterController';

interface LabTrendToolbarProps {
  timeRange: LabTrendTimeRange;
  searchTerm: string;
  onlyAbnormal: boolean;
  visibleVariables: number;
  totalVariables: number;
  onTimeRangeChange: (range: LabTrendTimeRange) => void;
  onSearchTermChange: (value: string) => void;
  onOnlyAbnormalChange: (value: boolean) => void;
}

const RANGE_OPTIONS: Array<{ value: LabTrendTimeRange; label: string }> = [
  { value: '24h', label: '24 h' },
  { value: '3d', label: '3 días' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: 'all', label: 'Todo' },
];

export const LabTrendToolbar: React.FC<LabTrendToolbarProps> = ({
  timeRange,
  searchTerm,
  onlyAbnormal,
  visibleVariables,
  totalVariables,
  onTimeRangeChange,
  onSearchTermChange,
  onOnlyAbnormalChange,
}) => (
  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 p-2">
    <label className="relative min-w-[180px] flex-1 sm:max-w-[260px]">
      <span className="sr-only">Buscar variable de laboratorio</span>
      <Search
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        type="search"
        value={searchTerm}
        onChange={event => onSearchTermChange(event.target.value)}
        placeholder="Buscar variable"
        className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[12px] font-medium text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
      />
    </label>

    <div
      className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white p-0.5"
      aria-label="Rango temporal"
    >
      {RANGE_OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={timeRange === option.value}
          onClick={() => onTimeRangeChange(option.value)}
          className={clsx(
            'h-7 rounded-md px-2 text-[10px] font-semibold transition sm:px-2.5 sm:text-[11px]',
            timeRange === option.value
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>

    <button
      type="button"
      aria-pressed={onlyAbnormal}
      onClick={() => onOnlyAbnormalChange(!onlyAbnormal)}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition',
        onlyAbnormal
          ? 'border-amber-300 bg-amber-50 text-amber-800 shadow-sm'
          : 'border-slate-200 bg-white text-slate-600 hover:border-amber-200 hover:text-amber-700'
      )}
    >
      <AlertTriangle size={13} aria-hidden="true" />
      Sólo alterados
    </button>

    <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
      <SlidersHorizontal size={12} aria-hidden="true" />
      {visibleVariables === totalVariables
        ? `${totalVariables} variables`
        : `${visibleVariables} de ${totalVariables}`}
    </span>
  </div>
);

import React from 'react';
import { Users, Settings, Sun, Moon, ChevronDown } from 'lucide-react';
import { useStaffContext } from '@/context/StaffContext';
import type { ShiftIndicatorState } from '@/features/census/controllers/censusStaffHeaderController';
import {
  buildResolvedStaffSelectionOptions,
  normalizeStaffSelectionValue,
} from '@/services/staff/staffSelectionPresentation';
import { buildStaffSelectionSelectClassName } from './staffSelectionSelectStyles';

interface TensSelectorProps {
  tensDayShift: string[];
  tensNightShift: string[];
  tensList: string[];
  onUpdateTens: (shift: 'day' | 'night', index: number, name: string) => void;
  shiftIndicators?: Record<'day' | 'night', ShiftIndicatorState>;
  onOpenDetailedStaffing?: () => void;
  className?: string;
}

export const TensSelector: React.FC<TensSelectorProps> = ({
  tensDayShift,
  tensNightShift,
  tensList,
  onUpdateTens,
  shiftIndicators,
  onOpenDetailedStaffing,
  className,
}) => {
  const { setShowTensManager } = useStaffContext();
  const selectClassName =
    'py-0 pl-1 pr-4 border border-slate-200 text-[10px] focus:ring-1 focus:outline-none text-slate-700 h-[20px] w-[60px] appearance-none transition-all';
  const resolvedTensOptions = React.useMemo(
    () => buildResolvedStaffSelectionOptions(tensList, [...tensDayShift, ...tensNightShift]),
    [tensList, tensDayShift, tensNightShift]
  );
  const hasDayAdjustments = Boolean(
    shiftIndicators?.day?.hasSpecialSchedule || (shiftIndicators?.day?.extraCount ?? 0) > 0
  );
  const hasNightAdjustments = Boolean(
    shiftIndicators?.night?.hasSpecialSchedule || (shiftIndicators?.night?.extraCount ?? 0) > 0
  );

  return (
    <div
      className={`card px-2 py-1.5 flex flex-col gap-0.5 !border-slate-200/80 !shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:!border-slate-300 transition-colors w-fit !overflow-visible ${className || ''}`}
    >
      <div className="flex justify-between items-center pb-0.5 border-b border-slate-100">
        <button
          type="button"
          onClick={() => setShowTensManager(true)}
          className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1 transition-colors hover:text-medical-600"
          aria-label="Abrir catálogo de TENS"
        >
          <Users size={11} /> TENS
        </button>
        <button
          type="button"
          onClick={onOpenDetailedStaffing}
          className="text-slate-300 hover:text-medical-600 transition-colors"
          aria-label="Abrir configuración detallada de TENS"
        >
          <Settings size={11} />
        </button>
      </div>

      {/* Day Shift Row */}
      <div className="flex items-center gap-1 mt-0.5">
        <Sun size={10} className="text-amber-500" />
        <span className="text-[9px] font-bold text-slate-500 uppercase w-[34px]">
          Largo
          {hasDayAdjustments && (
            <sup className="ml-0.5 text-[8px] font-semibold normal-case text-slate-400">*</sup>
          )}
        </span>
        {[0, 1, 2].map(idx => (
          <div key={`day-${idx}`} className="relative">
            <select
              className={buildStaffSelectionSelectClassName({
                baseClassName: selectClassName,
                selectionValue: tensDayShift[idx],
                tone: 'day',
              })}
              value={normalizeStaffSelectionValue(tensDayShift[idx])}
              onChange={e => onUpdateTens('day', idx, e.target.value)}
            >
              {resolvedTensOptions.map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <ChevronDown
              size={10}
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-slate-400"
            />
          </div>
        ))}
      </div>

      {/* Night Shift Row */}
      <div className="flex items-center gap-1">
        <Moon size={10} className="text-slate-500" />
        <span className="text-[9px] font-bold text-slate-500 uppercase w-[34px]">
          Noche
          {hasNightAdjustments && (
            <sup className="ml-0.5 text-[8px] font-semibold normal-case text-slate-400">*</sup>
          )}
        </span>
        {[0, 1, 2].map(idx => (
          <div key={`night-${idx}`} className="relative">
            <select
              className={buildStaffSelectionSelectClassName({
                baseClassName: selectClassName,
                selectionValue: tensNightShift[idx],
                tone: 'night',
              })}
              value={normalizeStaffSelectionValue(tensNightShift[idx])}
              onChange={e => onUpdateTens('night', idx, e.target.value)}
            >
              {resolvedTensOptions.map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <ChevronDown
              size={10}
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-slate-400"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

import React from 'react';
import { Users, Settings, Sun, Moon, ChevronDown } from 'lucide-react';
import { useStaffContext } from '@/context/StaffContext';
import type { ShiftIndicatorState } from '@/features/census/controllers/censusStaffHeaderController';
import {
  buildResolvedStaffSelectionOptions,
  normalizeStaffSelectionValue,
} from '@/services/staff/staffSelectionPresentation';
import { buildStaffSelectionSelectClassName } from './staffSelectionSelectStyles';
import {
  reconcileNurseCatalogNames,
  reconcileSelectedNurseName,
} from '@/services/staff/nurseIdentity';

interface NurseSelectorProps {
  nursesDayShift: string[];
  nursesNightShift: string[];
  nursesList: string[];
  onUpdateNurse: (shift: 'day' | 'night', index: number, name: string) => void;
  shiftIndicators?: Record<'day' | 'night', ShiftIndicatorState>;
  onOpenDetailedStaffing?: () => void;
  className?: string;
}

export const NurseSelector: React.FC<NurseSelectorProps> = ({
  nursesDayShift,
  nursesNightShift,
  nursesList,
  onUpdateNurse,
  shiftIndicators,
  onOpenDetailedStaffing,
  className,
}) => {
  const { setShowNurseManager } = useStaffContext();
  const selectClassName =
    'py-0 pl-1 pr-4 border border-slate-200 text-[10px] focus:ring-1 focus:outline-none text-slate-700 h-[20px] w-[75px] appearance-none transition-all';
  const reconciledCatalog = React.useMemo(
    () => reconcileNurseCatalogNames(nursesList),
    [nursesList]
  );
  const reconciledDayShift = React.useMemo(
    () => nursesDayShift.map(name => reconcileSelectedNurseName(name, reconciledCatalog)),
    [nursesDayShift, reconciledCatalog]
  );
  const reconciledNightShift = React.useMemo(
    () => nursesNightShift.map(name => reconcileSelectedNurseName(name, reconciledCatalog)),
    [nursesNightShift, reconciledCatalog]
  );
  const resolvedNurseOptions = React.useMemo(
    () =>
      buildResolvedStaffSelectionOptions(reconciledCatalog, [
        ...reconciledDayShift,
        ...reconciledNightShift,
      ]),
    [reconciledCatalog, reconciledDayShift, reconciledNightShift]
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
          onClick={() => setShowNurseManager(true)}
          className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1 transition-colors hover:text-medical-600"
          aria-label="Abrir catálogo de Enfermería"
        >
          <Users size={11} /> Enfermería
        </button>
        <button
          type="button"
          onClick={onOpenDetailedStaffing}
          className="text-slate-300 hover:text-medical-600 transition-colors"
          aria-label="Abrir configuración detallada de Enfermería"
        >
          <Settings size={11} />
        </button>
      </div>

      {/* Day Shift Row */}
      <div className="flex items-center gap-1 mt-0.5">
        <span
          className="relative inline-flex w-4 shrink-0 justify-center"
          title="Turno largo"
          aria-label="Turno largo"
        >
          <Sun size={12} className="text-amber-600" aria-hidden="true" />
          {hasDayAdjustments && (
            <sup className="ml-0.5 text-[8px] font-semibold normal-case text-slate-400">*</sup>
          )}
        </span>
        {[0, 1].map(idx => (
          <div key={`day-${idx}`} className="relative">
            <select
              className={buildStaffSelectionSelectClassName({
                baseClassName: selectClassName,
                selectionValue: nursesDayShift[idx],
                tone: 'day',
              })}
              value={normalizeStaffSelectionValue(reconciledDayShift[idx])}
              onChange={e => onUpdateNurse('day', idx, e.target.value)}
              aria-label={`Enfermería · turno largo · puesto ${idx + 1}`}
            >
              {resolvedNurseOptions.map(n => (
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
        <span
          className="relative inline-flex w-4 shrink-0 justify-center"
          title="Turno noche"
          aria-label="Turno noche"
        >
          <Moon size={12} className="text-slate-500" aria-hidden="true" />
          {hasNightAdjustments && (
            <sup className="ml-0.5 text-[8px] font-semibold normal-case text-slate-400">*</sup>
          )}
        </span>
        {[0, 1].map(idx => (
          <div key={`night-${idx}`} className="relative">
            <select
              className={buildStaffSelectionSelectClassName({
                baseClassName: selectClassName,
                selectionValue: nursesNightShift[idx],
                tone: 'night',
              })}
              value={normalizeStaffSelectionValue(reconciledNightShift[idx])}
              onChange={e => onUpdateNurse('night', idx, e.target.value)}
              aria-label={`Enfermería · turno noche · puesto ${idx + 1}`}
            >
              {resolvedNurseOptions.map(n => (
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

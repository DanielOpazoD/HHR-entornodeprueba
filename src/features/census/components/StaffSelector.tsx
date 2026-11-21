import React from 'react';
import { Users, Settings, Sun, Moon, ChevronDown, type LucideIcon } from 'lucide-react';
import { useStaffContext, type StaffContextType } from '@/context/StaffContext';
import type { ShiftIndicatorState } from '@/features/census/controllers/censusStaffHeaderController';
import { listedStaffPerson, type NursingRole } from '@/services/staff/eloisaStaffIdentity';
import {
  buildResolvedStaffSelectionOptions,
  exactStaffOption,
  isAmbiguousStaffName,
  isVacancySelection,
  resolveStaffSelectionValue,
} from '@/services/staff/staffSelectionPresentation';
import { buildStaffSelectionSelectClassName } from './staffSelectionSelectStyles';
import { formatStaffDisplayName } from '@/services/staff/staffDisplayName';
import { partitionStaffOptions } from '@/services/staff/staffUsage';
import { StaffMoreOptionsButton } from './StaffMoreOptionsButton';
import { StaffSelectionNameHint } from './StaffSelectionNameHint';
import {
  formatNurseCatalogNames,
  reconcileSelectedNurseName,
} from '@/services/staff/nurseIdentity';

type Shift = 'day' | 'night';

/** What differs between the nursing and TENS selectors, as data. */
interface StaffSelectorRoleConfig {
  label: string;
  /** Positions per shift. */
  slots: number[];
  selectWidthClass: string;
  /** Nurse names are re-capitalized against their catalog; TENS names are shown as saved. */
  reconcileCatalog: (catalog: string[]) => string[];
  reconcileSelected: (name: string, catalog: string[]) => string;
  /**
   * TENS shows a selection under the option spelled like it (#1506: «Ana Pena» shows «Ana Peña»);
   * nursing does not, as before the two selectors were joined.
   */
  matchesOptionSpelling: boolean;
  catalogControls: (staff: StaffContextType) => {
    unavailable?: boolean;
    retry?: () => void;
    openManager: () => void;
  };
}

const STAFF_SELECTOR_ROLES: Record<NursingRole, StaffSelectorRoleConfig> = {
  nurse: {
    label: 'Enfermería',
    slots: [0, 1],
    selectWidthClass: 'w-[75px]',
    reconcileCatalog: formatNurseCatalogNames,
    reconcileSelected: reconcileSelectedNurseName,
    matchesOptionSpelling: false,
    catalogControls: staff => ({
      unavailable: staff.nursesCatalogUnavailable,
      retry: staff.retryNursesCatalog,
      openManager: () => staff.setShowNurseManager(true),
    }),
  },
  tens: {
    label: 'TENS',
    slots: [0, 1, 2],
    selectWidthClass: 'w-[60px]',
    reconcileCatalog: catalog => catalog,
    reconcileSelected: name => name,
    matchesOptionSpelling: true,
    catalogControls: staff => ({
      unavailable: staff.tensCatalogUnavailable,
      retry: staff.retryTensCatalog,
      openManager: () => staff.setShowTensManager(true),
    }),
  },
};

const SHIFT_ROWS: Record<
  Shift,
  { title: string; icon: LucideIcon; iconClass: string; rowClass: string }
> = {
  day: {
    title: 'Turno largo',
    icon: Sun,
    iconClass: 'text-amber-600',
    rowClass: 'flex items-center gap-1 mt-0.5',
  },
  night: {
    title: 'Turno noche',
    icon: Moon,
    iconClass: 'text-slate-500',
    rowClass: 'flex items-center gap-1',
  },
};

interface StaffSelectorProps {
  role: NursingRole;
  dayShift: string[];
  nightShift: string[];
  catalog: string[];
  onUpdate: (role: NursingRole, shift: Shift, index: number, name: string) => void;
  shiftIndicators?: Record<Shift, ShiftIndicatorState>;
  onOpenDetailedStaffing?: () => void;
  className?: string;
}

export const StaffSelector: React.FC<StaffSelectorProps> = ({
  role,
  dayShift,
  nightShift,
  catalog,
  onUpdate,
  shiftIndicators,
  onOpenDetailedStaffing,
  className,
}) => {
  const config = STAFF_SELECTOR_ROLES[role];
  const staff = useStaffContext();
  const { staffIdentities = [], staffUsage } = staff;
  const controls = config.catalogControls(staff);
  const [showAllNames, setShowAllNames] = React.useState<Record<string, boolean>>({});
  const selectClassName = `block py-0 pl-1.5 pr-4 border border-slate-200 text-[10px] focus:ring-1 focus:outline-none text-slate-700 h-[20px] ${config.selectWidthClass} appearance-none transition-all`;
  const reconciledCatalog = React.useMemo(
    () => config.reconcileCatalog(catalog),
    [config, catalog]
  );
  const reconciled = React.useMemo(() => {
    // A name two Eloísa people share is shown as written, never respelled as one of them.
    const reconcile = (name: string) =>
      isAmbiguousStaffName(name, staffIdentities, role)
        ? name
        : config.reconcileSelected(name, reconciledCatalog);
    return { day: dayShift.map(reconcile), night: nightShift.map(reconcile) };
  }, [config, dayShift, nightShift, reconciledCatalog, staffIdentities, role]);
  const options = React.useMemo(
    () =>
      buildResolvedStaffSelectionOptions(
        reconciledCatalog,
        [...reconciled.day, ...reconciled.night],
        staffIdentities,
        role
      ),
    [reconciledCatalog, reconciled, staffIdentities, role]
  );
  // Both roles show a saved name as the option written the same (case and spacing aside).
  const resolveSelected = (name: string | undefined) =>
    exactStaffOption(
      resolveStaffSelectionValue(
        name,
        staffIdentities,
        role,
        config.matchesOptionSpelling ? options : undefined
      ),
      options
    );
  const groups = partitionStaffOptions(
    options,
    [...reconciled.day, ...reconciled.night].map(resolveSelected),
    staffUsage?.[role],
    name => listedStaffPerson(name, staffIdentities, role)
  );
  const raw: Record<Shift, string[]> = { day: dayShift, night: nightShift };

  const renderShiftRow = (shift: Shift) => {
    const row = SHIFT_ROWS[shift];
    const Icon = row.icon;
    const indicator = shiftIndicators?.[shift];
    const hasAdjustments = Boolean(
      indicator?.hasSpecialSchedule || (indicator?.extraCount ?? 0) > 0
    );
    return (
      <div className={row.rowClass}>
        <span
          className="relative inline-flex w-4 shrink-0 justify-center"
          title={row.title}
          aria-label={row.title}
        >
          <Icon size={12} className={row.iconClass} aria-hidden="true" />
          {hasAdjustments && (
            <sup className="ml-0.5 text-[8px] font-semibold normal-case text-slate-400">*</sup>
          )}
        </span>
        {config.slots.map(idx => {
          const key = `${shift}-${idx}`;
          const label = `${config.label} · ${row.title.toLowerCase()} · puesto ${idx + 1}`;
          const hintId = `${role}-${shift}-${idx}-name`;
          const selected = resolveSelected(reconciled[shift][idx]);
          return (
            <div key={key} className="group relative hover:z-50 focus-within:z-50">
              <select
                className={buildStaffSelectionSelectClassName({
                  baseClassName: selectClassName,
                  selectionValue: raw[shift][idx],
                  tone: shift,
                })}
                value={selected}
                aria-describedby={isVacancySelection(raw[shift][idx]) ? undefined : hintId}
                onChange={e => onUpdate(role, shift, idx, e.target.value)}
                aria-label={label}
              >
                {(showAllNames[key] ? options : groups.visible).map(n => (
                  <option key={n} value={n} title={n}>
                    {formatStaffDisplayName(n, staffIdentities, role)}
                  </option>
                ))}
              </select>
              <StaffSelectionNameHint id={hintId} name={selected} />
              {groups.hidden.length === 0 && (
                <ChevronDown
                  size={10}
                  className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-slate-400"
                />
              )}
              <StaffMoreOptionsButton
                expanded={Boolean(showAllNames[key])}
                count={groups.hidden.length}
                label={label}
                onClick={() => setShowAllNames(value => ({ ...value, [key]: !value[key] }))}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={`census-toolbar-card rounded-xl border border-slate-200 bg-white min-h-20 px-3 py-1.5 flex flex-col justify-between gap-0.5 hover:border-slate-300 transition-colors w-fit overflow-visible ${className || ''}`}
    >
      <div className="flex justify-between items-center pb-0.5 border-b border-slate-100">
        <button
          type="button"
          onClick={controls.openManager}
          className="-my-1 min-h-7 text-[11px] font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1 transition-colors hover:text-medical-600"
          aria-label={`Abrir catálogo de ${config.label}`}
        >
          <Users size={11} /> {config.label}
        </button>
        {controls.unavailable && (
          <button
            type="button"
            onClick={controls.retry}
            className="text-[10px] text-slate-500"
            title="No se pudo leer la lista."
            aria-label="No se pudo leer la lista. Reintentar"
          >
            Reintentar
          </button>
        )}
        <button
          type="button"
          onClick={onOpenDetailedStaffing}
          className="-m-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-medical-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          aria-label={`Abrir configuración detallada de ${config.label}`}
          title={`Abrir configuración detallada de ${config.label}`}
        >
          <Settings size={11} aria-hidden="true" />
        </button>
      </div>
      {renderShiftRow('day')}
      {renderShiftRow('night')}
    </div>
  );
};

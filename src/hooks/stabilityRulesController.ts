import type { DailyRecordDateRef } from '@/types/domain/dailyRecordSlices';
import { resolveCurrentClinicalDay } from '@/utils/clinicalDayUtils';
import { canWriteCensusDay } from '@/shared/access/censusDayWriteAccessPolicy';

export interface StabilityRules {
  isDateLocked: boolean;
  isDayShiftLocked: boolean;
  isNightShiftLocked: boolean;
  canEditField: (fieldName: string) => boolean;
  canPerformActions: boolean;
  lockReason?: string;
}

interface BuildStabilityRulesOptions {
  isAdmin: boolean;
  isEditor: boolean;
  todayISO?: string;
  now?: Date;
  isDateLocked?: boolean;
}

const DAY_SHIFT_FIELD_PREFIXES = [
  'handoffNoteDayShift',
  'nursesDayShift',
  'tensDayShift',
  'handoffDayChecklist',
  'handoffNovedadesDayShift',
];

const NIGHT_SHIFT_FIELD_PREFIXES = [
  'handoffNoteNightShift',
  'nursesNightShift',
  'tensNightShift',
  'handoffNightChecklist',
  'handoffNovedadesNightShift',
  'handoffNightReceives',
];

const startsWithAny = (value: string, prefixes: readonly string[]): boolean =>
  prefixes.some(prefix => value.startsWith(prefix));

export const resolveStabilityDateLocked = (
  record: DailyRecordDateRef | null,
  {
    isAdmin,
    isEditor,
    todayISO = resolveCurrentClinicalDay(),
    now = new Date(),
  }: Omit<BuildStabilityRulesOptions, 'isDateLocked'>
): boolean => {
  if (!record || !isEditor) {
    return true;
  }
  // A past day closes for nurses with the server's window, on the hospital clock (SAVE-04).
  const isHistorical = record.date < todayISO;
  return isHistorical && !canWriteCensusDay(record.date, isAdmin, now.getTime());
};

export const buildStabilityRules = (
  record: DailyRecordDateRef | null,
  {
    isAdmin,
    isEditor,
    todayISO = resolveCurrentClinicalDay(),
    now = new Date(),
    isDateLocked: precomputedDateLocked,
  }: BuildStabilityRulesOptions
): StabilityRules => {
  if (!record || !isEditor) {
    return {
      isDateLocked: true,
      isDayShiftLocked: true,
      isNightShiftLocked: true,
      canEditField: () => false,
      canPerformActions: false,
      lockReason: 'No tiene permisos de edición o no hay registro cargado.',
    };
  }

  const isDateLocked =
    precomputedDateLocked ??
    resolveStabilityDateLocked(record, { isAdmin, isEditor, todayISO, now });

  // Manual shift locks are currently disabled at product level.
  const isDayShiftLocked = false;
  const isNightShiftLocked = false;

  const canEditField = (fieldName: string): boolean => {
    if (isAdmin) return true;
    if (isDateLocked) return false;

    if (startsWithAny(fieldName, DAY_SHIFT_FIELD_PREFIXES) && isDayShiftLocked) {
      return false;
    }

    if (startsWithAny(fieldName, NIGHT_SHIFT_FIELD_PREFIXES) && isNightShiftLocked) {
      return false;
    }

    return true;
  };

  let lockReason: string | undefined;
  if (isDateLocked) {
    lockReason = 'Este es un registro histórico (>48h). Solo administradores pueden editar.';
  } else if (isDayShiftLocked || isNightShiftLocked) {
    lockReason = 'Este turno ha sido cerrado manualmente.';
  }

  return {
    isDateLocked,
    isDayShiftLocked,
    isNightShiftLocked,
    canEditField,
    canPerformActions: !isDateLocked,
    lockReason,
  };
};

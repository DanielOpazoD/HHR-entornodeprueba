import { DailyRecord } from '@/types';
import { getTodayISO } from '@/utils/dateUtils';

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
    prefixes.some((prefix) => value.startsWith(prefix));

export const buildStabilityRules = (
    record: DailyRecord | null,
    { isAdmin, isEditor, todayISO = getTodayISO(), now = new Date() }: BuildStabilityRulesOptions
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

    const isHistorical = record.date < todayISO;
    const recordDateAtNoon = new Date(`${record.date}T12:00:00`);
    const hoursSinceRecord = (now.getTime() - recordDateAtNoon.getTime()) / (1000 * 60 * 60);
    const isWithinGracePeriod = hoursSinceRecord < 36;
    const isDateLocked = isHistorical && !isAdmin && !isWithinGracePeriod;

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
        lockReason = 'Este es un registro histórico (>24h). Solo administradores pueden editar.';
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

import { useMemo } from 'react';
import { DailyRecord } from '@/types';
import { useAuthState } from './useAuthState';
import { getTodayISO } from '@/utils/dateUtils';

export interface StabilityRules {
    /** Whether the entire record is locked due to being historical (>24h) */
    isDateLocked: boolean;
    /** Whether the day shift is manually locked */
    isDayShiftLocked: boolean;
    /** Whether the night shift is manually locked */
    isNightShiftLocked: boolean;
    /** Whether a specific field can be edited by the current user */
    canEditField: (fieldName: string) => boolean;
    /** Whether general patient actions (move, discharge) are allowed */
    canPerformActions: boolean;
    /** Human-readable reason why something is locked */
    lockReason?: string;
}

/**
 * useStabilityRules Hook
 * 
 * Centralizes the logic for data stability and editing restrictions.
 * Rules:
 * 1. Admin bypass: Admins can always edit everything.
 * 2. Date Lock: Records older than today are locked for non-admins.
 * 3. Manual Lock: If dayShiftLocked or nightShiftLocked is true, 
 *    corresponding fields are locked.
 */
export const useStabilityRules = (record: DailyRecord | null): StabilityRules => {
    const { role, isEditor } = useAuthState();
    const isAdmin = role === 'admin';

    return useMemo(() => {
        if (!record || !isEditor) {
            return {
                isDateLocked: true,
                isDayShiftLocked: true,
                isNightShiftLocked: true,
                canEditField: () => false,
                canPerformActions: false,
                lockReason: 'No tiene permisos de edición o no hay registro cargado.'
            };
        }

        // 1. Horizontal Lock (Date-based)
        const today = getTodayISO();
        const isHistorical = record.date < today;

        // Grace period: Allowed to edit records from yesterday for up to 12 hours after the day ends
        // (36 hours from the record's "midday" anchor)
        const now = new Date();
        const recordDateAtNoon = new Date(`${record.date}T12:00:00`);
        const hoursSinceRecord = (now.getTime() - recordDateAtNoon.getTime()) / (1000 * 60 * 60);
        const isWithinGracePeriod = hoursSinceRecord < 36;

        const isDateLocked = isHistorical && !isAdmin && !isWithinGracePeriod;

        // 2. Vertical Locks (Manual Shift Locks) - REVERTED
        const isDayShiftLocked = false;
        const isNightShiftLocked = false;

        /**
         * Logic to determine if a specific field is editable
         */
        const canEditField = (fieldName: string): boolean => {
            if (isAdmin) return true;
            if (isDateLocked) return false;

            // Day Shift protected fields
            const dayShiftFields = [
                'handoffNoteDayShift',
                'nursesDayShift',
                'tensDayShift',
                'handoffDayChecklist',
                'handoffNovedadesDayShift'
            ];

            // Night Shift protected fields
            const nightShiftFields = [
                'handoffNoteNightShift',
                'nursesNightShift',
                'tensNightShift',
                'handoffNightChecklist',
                'handoffNovedadesNightShift',
                'handoffNightReceives'
            ];

            if (dayShiftFields.some(f => fieldName.startsWith(f)) && isDayShiftLocked) {
                return false;
            }

            if (nightShiftFields.some(f => fieldName.startsWith(f)) && isNightShiftLocked) {
                return false;
            }

            return true;
        };

        const canPerformActions = !isDateLocked;

        let lockReason = undefined;
        if (isDateLocked) lockReason = 'Este es un registro histórico (>24h). Solo administradores pueden editar.';
        else if (isDayShiftLocked || isNightShiftLocked) lockReason = 'Este turno ha sido cerrado manualmente.';

        return {
            isDateLocked,
            isDayShiftLocked,
            isNightShiftLocked,
            canEditField,
            canPerformActions,
            lockReason
        };
    }, [record?.date, isAdmin, isEditor]);
};

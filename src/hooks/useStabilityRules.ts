import { useMemo } from 'react';
import { DailyRecord } from '@/types';
import { useAuthState } from './useAuthState';
import { buildStabilityRules, type StabilityRules } from './stabilityRulesController';
export type { StabilityRules } from './stabilityRulesController';

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

    return useMemo(
        () => buildStabilityRules(record, { isAdmin, isEditor }),
        [record, isAdmin, isEditor]
    );
};

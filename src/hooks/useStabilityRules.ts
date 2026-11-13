import { useMemo } from 'react';
import type { DailyRecordDateRef } from '@/types/domain/dailyRecordSlices';
import { useAuth } from '@/context/AuthContext';
import { buildStabilityRules, type StabilityRules } from './stabilityRulesController';
import { isE2EEditableRecordOverrideEnabled } from '@/shared/runtime/e2eRuntime';
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
export const useStabilityRules = (record: DailyRecordDateRef | null): StabilityRules => {
  const { role, isEditor } = useAuth();
  const e2eEditableOverride = isE2EEditableRecordOverrideEnabled();
  const isAdmin = role === 'admin' || e2eEditableOverride;

  return useMemo(
    () => buildStabilityRules(record, { isAdmin, isEditor: isEditor || e2eEditableOverride }),
    [record, isAdmin, isEditor, e2eEditableOverride]
  );
};

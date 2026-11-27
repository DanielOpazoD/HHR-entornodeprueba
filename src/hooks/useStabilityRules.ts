import { useEffect, useMemo, useState } from 'react';
import type { DailyRecordDateRef } from '@/types/domain/dailyRecordSlices';
import { useAuth } from '@/context/authContextCore';
import { isAdminAppRole } from '@/shared/access/operationalAccessPolicy';
import { nurseEditingWindowClosesAt } from '@/utils/clinicalWallClock';
import {
  buildStabilityRules,
  resolveStabilityDateLocked,
  type StabilityRules,
} from './stabilityRulesController';
import { isE2EEditableRecordOverrideEnabled } from '@/shared/runtime/e2eRuntime';
export type { StabilityRules } from './stabilityRulesController';

/** Longest delay `setTimeout` honours; a longer one fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Reports the instant the nurse editing window of `day` closes, once it has: one timeout aimed
 * at that instant, nothing before it. Timers run late after the computer sleeps, so returning to
 * the tab, or any render after the instant, checks again at once. The same instant reported twice
 * is the same state, so it renders once. While the window is still open it reports null, so a
 * clock set back after a first close is reported again when it closes a second time.
 */
const useNurseWindowCloseTimer = (
  day: string | null,
  onClosed: (closedAt: number | null) => void
) => {
  const closesAt = useMemo(() => (day === null ? null : nurseEditingWindowClosesAt(day)), [day]);

  useEffect(() => {
    if (closesAt !== null && Date.now() >= closesAt) onClosed(closesAt);
  });

  useEffect(() => {
    if (closesAt === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      const remaining = closesAt - Date.now();
      if (remaining <= 0) return onClosed(closesAt);
      onClosed(null);
      timer = setTimeout(check, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    check();
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('focus', check);
    };
  }, [closesAt, onClosed]);
};

/**
 * useStabilityRules Hook
 *
 * Centralizes the logic for data stability and editing restrictions.
 * Rules:
 * 1. Admin bypass: Admins can always edit everything.
 * 2. Date Lock: a past day locks for non-admins when the nurse editing window closes, also while
 *    the census stays open.
 * 3. Manual Lock: If dayShiftLocked or nightShiftLocked is true,
 *    corresponding fields are locked.
 */
export const useStabilityRules = (record: DailyRecordDateRef | null): StabilityRules => {
  const { role, isEditor } = useAuth();
  const e2eEditableOverride = isE2EEditableRecordOverrideEnabled();
  const isAdmin = isAdminAppRole(role) || e2eEditableOverride;
  const canEdit = isEditor || e2eEditableOverride;
  const recordDate = record ? record.date : null;
  const [, setWindowClosedAt] = useState<number | null>(null);

  // Recompute lock status on the hospital clock each render so a timer wake or clock correction
  // flips isDateLockedNow without rebuilding rules on unrelated edits to the same day's record.
  const isDateLockedNow = resolveStabilityDateLocked(
    recordDate !== null ? { date: recordDate } : null,
    { isAdmin, isEditor: canEdit }
  );

  const rules = useMemo(
    () =>
      buildStabilityRules(recordDate !== null ? { date: recordDate } : null, {
        isAdmin,
        isEditor: canEdit,
        isDateLocked: isDateLockedNow,
      }),
    [recordDate, isAdmin, canEdit, isDateLockedNow]
  );

  // Only a day still open to a nurse has a window left to close.
  useNurseWindowCloseTimer(
    recordDate !== null && !isAdmin && !rules.isDateLocked ? recordDate : null,
    setWindowClosedAt
  );

  return rules;
};

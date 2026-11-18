import { useEffect, useMemo, useState } from 'react';
import type { DailyRecordDateRef } from '@/types/domain/dailyRecordSlices';
import { useAuth } from '@/context/AuthContext';
import { nurseEditingWindowClosesAt } from '@/utils/clinicalWallClock';
import { buildStabilityRules, type StabilityRules } from './stabilityRulesController';
import { isE2EEditableRecordOverrideEnabled } from '@/shared/runtime/e2eRuntime';
export type { StabilityRules } from './stabilityRulesController';

/** Longest delay `setTimeout` honours; a longer one fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Reports the instant the nurse editing window of `day` closes, once it has: one timeout aimed
 * at that instant, nothing before it. Timers run late after the computer sleeps, so returning to
 * the tab, or any render after the instant, checks again at once. The same instant reported twice
 * is the same state, so it renders once.
 */
const useNurseWindowCloseTimer = (day: string | null, onClosed: (closedAt: number) => void) => {
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
      if (remaining <= 0) onClosed(closesAt);
      else timer = setTimeout(check, Math.min(remaining, MAX_TIMEOUT_MS));
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
  const isAdmin = role === 'admin' || e2eEditableOverride;
  const canEdit = isEditor || e2eEditableOverride;
  const [windowClosedAt, setWindowClosedAt] = useState<number | null>(null);

  const rules = useMemo(
    () => buildStabilityRules(record, { isAdmin, isEditor: canEdit }),
    // windowClosedAt is not read: its change re-reads the lock on the hospital clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, isAdmin, canEdit, windowClosedAt]
  );

  // Only a day still open to a nurse has a window left to close.
  useNurseWindowCloseTimer(
    record && !isAdmin && !rules.isDateLocked ? record.date : null,
    setWindowClosedAt
  );

  return rules;
};

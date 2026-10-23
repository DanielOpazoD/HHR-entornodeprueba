import { useCallback, useSyncExternalStore } from 'react';
import {
  getDailyRecordWriteState,
  subscribeDailyRecordWriteState,
} from '@/services/repositories/dailyRecordWriteCoordinator';

/** Presentation of this tab's write turns, not proof of remote confirmation. */
export const useDailyRecordWriteStatus = (date: string) => {
  const subscribe = useCallback(
    (listener: () => void) => subscribeDailyRecordWriteState(date, listener),
    [date]
  );
  const getSnapshot = useCallback(() => getDailyRecordWriteState(date), [date]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...state,
    isSyncCommit: state.activeKind === 'clinical_sync' || state.activeKind === 'structural_sync',
  };
};

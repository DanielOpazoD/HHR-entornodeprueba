import type { SyncStatus } from '@/context/dailyRecordContextContracts';

import {
  resolveDailyRecordSavedState,
  isDailyRecordWriteBlockedResult,
  type SaveDailyRecordResult,
  type UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';

export interface DailyRecordMutationFlags {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  data?: { result: SaveDailyRecordResult | UpdatePartialDailyRecordResult | null };
}

export const resolveDailyRecordSyncStatus = (
  mutations: readonly DailyRecordMutationFlags[]
): SyncStatus => {
  if (mutations.some(mutation => mutation.isPending)) {
    return 'saving';
  }

  const states = mutations.map(mutation => {
    const result = mutation.data?.result;
    if (
      mutation.isError ||
      (result && (result.outcome === 'blocked' || isDailyRecordWriteBlockedResult(result)))
    )
      return 'error';
    return mutation.isSuccess && result ? resolveDailyRecordSavedState(result) : 'idle';
  });
  if (states.includes('error')) {
    return 'error';
  }

  if (states.includes('local')) return 'local';

  if (states.includes('saved')) {
    return 'saved';
  }

  return 'idle';
};

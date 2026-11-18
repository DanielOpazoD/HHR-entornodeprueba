import type { SyncStatus } from '@/context/dailyRecordContextContracts';

import {
  resolveDailyRecordWriteStatus,
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
    if (mutation.isError) return 'error';
    if (!result) return 'idle';
    const status = resolveDailyRecordWriteStatus(result);
    const blocked = status.state === 'not_saved' && status.reason === 'blocked';
    if (!mutation.isSuccess && !blocked) return 'idle';
    if (status.state === 'confirmed') return 'saved';
    return status.state !== 'not_saved' && status.savedHere ? 'local' : 'error';
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

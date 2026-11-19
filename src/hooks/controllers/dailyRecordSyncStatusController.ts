import type { SyncStatus } from '@/context/dailyRecordContextContracts';

import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';

export interface DailyRecordMutationFlags {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  data?: { result: DailyRecordWriteResult | null };
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
    const blocked = result.state === 'not_saved' && result.reason === 'blocked';
    if (!mutation.isSuccess && !blocked) return 'idle';
    if (result.state === 'confirmed') return 'saved';
    return result.state !== 'not_saved' && result.savedHere ? 'local' : 'error';
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

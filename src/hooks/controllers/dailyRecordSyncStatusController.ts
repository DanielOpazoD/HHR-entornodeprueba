import type { SyncStatus } from '@/hooks/useDailyRecordTypes';

export interface DailyRecordMutationFlags {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}

export const resolveDailyRecordSyncStatus = (
  mutations: readonly DailyRecordMutationFlags[]
): SyncStatus => {
  if (mutations.some(mutation => mutation.isPending)) {
    return 'saving';
  }

  if (mutations.some(mutation => mutation.isError)) {
    return 'error';
  }

  if (mutations.some(mutation => mutation.isSuccess)) {
    return 'saved';
  }

  return 'idle';
};

import { useMemo } from 'react';
import { useMutationState } from '@tanstack/react-query';
import {
  getDailyRecordPatchMutationKey,
  resolvePendingIntentionalClearTarget,
  type PendingIntentionalClearTarget,
} from '@/hooks/controllers/dailyRecordPatchMutationController';

export interface PendingIntentionalClearTargets {
  bedIds: ReadonlySet<string>;
  clinicalCribBedIds: ReadonlySet<string>;
}

export const usePendingIntentionalClearTargets = (date: string): PendingIntentionalClearTargets => {
  const pendingTargets = useMutationState<PendingIntentionalClearTarget | null>({
    filters: {
      mutationKey: getDailyRecordPatchMutationKey(date),
      status: 'pending',
    },
    select: mutation => resolvePendingIntentionalClearTarget(mutation.state.variables),
  });

  return useMemo(() => {
    const bedIds = new Set<string>();
    const clinicalCribBedIds = new Set<string>();
    pendingTargets.forEach(target => {
      if (!target) return;
      if (target.target === 'clinicalCrib') clinicalCribBedIds.add(target.bedId);
      else bedIds.add(target.bedId);
    });
    return { bedIds, clinicalCribBedIds };
  }, [pendingTargets]);
};

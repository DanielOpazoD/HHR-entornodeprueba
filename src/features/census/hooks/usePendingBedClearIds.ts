import { useMemo } from 'react';
import { useMutationState } from '@tanstack/react-query';
import {
  getDailyRecordPatchMutationKey,
  resolvePendingClinicalCribCreateTarget,
  resolvePendingIntentionalClearTarget,
  type PendingClinicalCribCreateTarget,
  type PendingIntentionalClearTarget,
} from '@/hooks/controllers/dailyRecordPatchMutationController';
import type { PatientData } from '@/features/census/types/censusTablePatientContracts';

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

/**
 * Crib drafts whose guarded creation is pending confirmation, keyed by bed.
 * Mirrors the pending-clear projection: the mutation enters `pending` before
 * onMutate waits for the per-date turn, so the provisional row can appear at
 * click time while remote authority stays the only durable source.
 */
export const usePendingClinicalCribCreates = (date: string): ReadonlyMap<string, PatientData> => {
  const pendingTargets = useMutationState<PendingClinicalCribCreateTarget | null>({
    filters: {
      mutationKey: getDailyRecordPatchMutationKey(date),
      status: 'pending',
    },
    select: mutation => resolvePendingClinicalCribCreateTarget(mutation.state.variables),
  });

  return useMemo(() => {
    const cribsByBedId = new Map<string, PatientData>();
    pendingTargets.forEach(target => {
      if (!target) return;
      cribsByBedId.set(target.bedId, target.crib as unknown as PatientData);
    });
    return cribsByBedId;
  }, [pendingTargets]);
};

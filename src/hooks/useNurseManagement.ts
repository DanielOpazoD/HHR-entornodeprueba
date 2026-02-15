import { useMemo, useCallback } from 'react';
import { DailyRecord } from '@/types';
import { DailyRecordPatch } from './useDailyRecordTypes';
import { useLatestRef } from '@/hooks/useLatestRef';

export const useNurseManagement = (
  record: DailyRecord | null,
  patchRecord: (partial: DailyRecordPatch) => Promise<void>
) => {
  const recordRef = useLatestRef(record);

  const updateNurse = useCallback(
    async (shift: 'day' | 'night', index: number, name: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;

      const field = shift === 'day' ? 'nursesDayShift' : 'nursesNightShift';
      const currentArray = [...(currentRecord[field] || ['', ''])];

      while (currentArray.length <= index) {
        currentArray.push('');
      }
      currentArray[index] = name;

      await patchRecord({ [field]: currentArray } as unknown as DailyRecordPatch);
    },
    [patchRecord]
  );

  return useMemo(
    () => ({
      updateNurse,
    }),
    [updateNurse]
  );
};

export const useTensManagement = (
  record: DailyRecord | null,
  patchRecord: (partial: DailyRecordPatch) => Promise<void>
) => {
  const recordRef = useLatestRef(record);

  const updateTens = useCallback(
    async (shift: 'day' | 'night', index: number, name: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;

      const field = shift === 'day' ? 'tensDayShift' : 'tensNightShift';
      const currentArray = [...(currentRecord[field] || ['', '', ''])];

      while (currentArray.length <= index) {
        currentArray.push('');
      }
      currentArray[index] = name;

      await patchRecord({ [field]: currentArray } as unknown as DailyRecordPatch);
    },
    [patchRecord]
  );

  return useMemo(
    () => ({
      updateTens,
    }),
    [updateTens]
  );
};

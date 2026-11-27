import { useCallback, useMemo } from 'react';
import type { ApplyDailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useNotification } from '@/context/UIContext';
import { useAuditContext } from '@/context/AuditContext';
import { useLatestRef } from '@/hooks/useLatestRef';
import { getAttributedAuthors } from '@/features/handoff/services/attributionService';
import { isValidSharedChecklistValue } from '@/domain/handoff/sharedChecklist';
import {
  buildChecklistPatch,
  buildHandoffReceivesPatch,
  buildNovedadesPatch,
} from '@/features/handoff/domain/management';

/**
 * A handoff field has nobody to answer to. patchRecord already told the user and kept the edit
 * in its queue, so a refusal ends here, as it does for the shift staff selects.
 */
const settleHandoffWrite = (write: Promise<void>): Promise<boolean> =>
  Promise.resolve(write).then(
    () => true,
    () => false
  );

export const useHandoffManagement = (
  record: DailyRecord | null,
  patchRecord: ApplyDailyRecordPatch
) => {
  const { error: notifyError } = useNotification();
  const { logHandoffNovedadesModified, userId } = useAuditContext();
  const recordRef = useLatestRef(record);

  const updateHandoffChecklist = useCallback(
    (shift: 'day' | 'night' | 'shared', field: string, value: boolean | string) => {
      if (!recordRef.current) return;
      if (shift === 'shared' && !isValidSharedChecklistValue(field, value)) {
        notifyError(
          'Error al guardar',
          'Revise la fecha del carro de paro y use un código de 8 dígitos.'
        );
        return;
      }
      void settleHandoffWrite(patchRecord(buildChecklistPatch(shift, field, value)));
    },
    [notifyError, patchRecord, recordRef]
  );

  const updateHandoffNovedades = useCallback(
    (shift: 'day' | 'night', value: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      void settleHandoffWrite(patchRecord(buildNovedadesPatch(shift, value))).then(saved => {
        if (!saved) return;
        const previous =
          shift === 'day'
            ? currentRecord.handoffNovedadesDayShift
            : currentRecord.handoffNovedadesNightShift;
        logHandoffNovedadesModified(
          shift,
          value,
          previous || '',
          currentRecord.date,
          getAttributedAuthors(userId, currentRecord, shift) ?? ''
        );
      });
    },
    [logHandoffNovedadesModified, patchRecord, recordRef, userId]
  );

  const updateHandoffReceives = useCallback(
    (shift: 'day' | 'night', staffList: string[]) => {
      if (!recordRef.current) return;
      void settleHandoffWrite(patchRecord(buildHandoffReceivesPatch(shift, staffList)));
    },
    [patchRecord, recordRef]
  );

  return useMemo(
    () => ({ updateHandoffChecklist, updateHandoffNovedades, updateHandoffReceives }),
    [updateHandoffChecklist, updateHandoffNovedades, updateHandoffReceives]
  );
};

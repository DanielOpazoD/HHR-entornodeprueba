import { useMemo, useRef, useEffect } from 'react';
import type {
  ApplyDailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useNotification } from '@/context/UIContext';
import { useAuditContext } from '@/context/AuditContext';
import { useAuth } from '@/context';
import type { HandoffManagementActions } from '@/hooks/handoffManagementTypes';
import { useHandoffManagementPersistence } from '@/hooks/useHandoffManagementPersistence';
import { useHandoffManagementDelivery } from '@/hooks/useHandoffManagementDelivery';

export const useHandoffManagement = (
  record: DailyRecord | null,
  saveAndUpdate: PersistDailyRecord,
  patchRecord: ApplyDailyRecordPatch
): HandoffManagementActions => {
  const { success, error: notifyError } = useNotification();
  const { logEvent, logDebouncedEvent, logHandoffNovedadesModified, userId } = useAuditContext();
  const { role } = useAuth();
  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  const persistence = useHandoffManagementPersistence({
    recordRef,
    role,
    saveAndUpdate,
    patchRecord,
    logEvent,
    logDebouncedEvent,
    logHandoffNovedadesModified,
    userId,
    notifyError,
  });
  const delivery = useHandoffManagementDelivery({
    recordRef,
    recordDate: record?.date,
    role,
    patchRecord,
    success,
    notifyError,
  });

  return useMemo(
    () => ({
      ...persistence,
      ...delivery,
    }),
    [delivery, persistence]
  );
};

import { useEffect, useRef } from 'react';
import type {
  ApplyDailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useNotification } from '@/context/UIContext';
import { useAuditContext } from '@/context/AuditContext';
import type { HandoffManagementActions } from '@/hooks/handoffManagementTypes';
import { useHandoffGeneralPersistenceActions } from '@/hooks/useHandoffGeneralPersistenceActions';
import { useHandoffPersistenceRuntime } from '@/hooks/useHandoffPersistenceRuntime';

export const useHandoffManagement = (
  record: DailyRecord | null,
  saveAndUpdate: PersistDailyRecord,
  patchRecord: ApplyDailyRecordPatch
): HandoffManagementActions => {
  const { error: notifyError } = useNotification();
  const { logHandoffNovedadesModified, userId } = useAuditContext();
  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  const runtime = useHandoffPersistenceRuntime({
    recordRef,
    saveAndUpdate,
    patchRecord,
    logHandoffNovedadesModified,
    userId,
    notifyError,
  });
  return useHandoffGeneralPersistenceActions(runtime);
};

import { useEffect, useRef } from 'react';
import type {
  ApplyDailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useNotification } from '@/context/UIContext';
import { useAuditContext } from '@/context/AuditContext';
import { useHandoffGeneralPersistenceActions } from '@/hooks/useHandoffGeneralPersistenceActions';
import { useHandoffPersistenceRuntime } from '@/hooks/useHandoffPersistenceRuntime';

interface HandoffManagementActions {
  updateHandoffChecklist: (
    shift: 'day' | 'night' | 'shared',
    field: string,
    value: boolean | string
  ) => void;
  updateHandoffNovedades: (shift: 'day' | 'night', value: string) => void;
  updateHandoffStaff: (
    shift: 'day' | 'night',
    type: 'delivers' | 'receives' | 'tens',
    staffList: string[]
  ) => void;
}

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

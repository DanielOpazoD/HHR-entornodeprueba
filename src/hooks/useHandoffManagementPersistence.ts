import { useHandoffGeneralPersistenceActions } from '@/hooks/useHandoffGeneralPersistenceActions';
import {
  useHandoffPersistenceRuntime,
  type HandoffManagementPersistenceInput,
} from '@/hooks/useHandoffPersistenceRuntime';
import { useMedicalHandoffPersistenceActions } from '@/hooks/useMedicalHandoffPersistenceActions';

export const useHandoffManagementPersistence = ({
  recordRef,
  role,
  saveAndUpdate,
  patchRecord,
  logEvent,
  logDebouncedEvent,
  logHandoffNovedadesModified,
  userId,
  notifyError,
}: HandoffManagementPersistenceInput) => {
  const runtime = useHandoffPersistenceRuntime({
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
  const generalActions = useHandoffGeneralPersistenceActions(runtime);
  const medicalActions = useMedicalHandoffPersistenceActions(runtime);

  return {
    ...generalActions,
    ...medicalActions,
  };
};

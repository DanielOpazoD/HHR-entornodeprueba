import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { useBedManagement } from '@/hooks/useBedManagement';
import type { StaleDayEditGuard } from '@/hooks/useStaleDayEditGuard';
import { usePatientDischarges } from '@/hooks/usePatientDischarges';
import { usePatientTransfers } from '@/hooks/usePatientTransfers';
import {
  useDetailedStaffingManagement,
  useNurseManagement,
  useTensManagement,
} from '@/hooks/useNurseManagement';
import { useCMA } from '@/hooks/useCMA';
import { useHandoffManagement } from '@/hooks/useHandoffManagement';
import { useInventory } from '@/hooks/useInventory';
import { useStabilityRules } from '@/hooks/useStabilityRules';
import { useValidation } from '@/hooks/useValidation';

export const useDailyRecordDomainModules = (
  record: DailyRecord | null,
  saveAndUpdate: PersistDailyRecord,
  patchRecord: ApplyDailyRecordPatch,
  ensureStaleDayEditAllowed?: StaleDayEditGuard
) => {
  const inventory = useInventory(record);
  const stabilityRules = useStabilityRules(record);
  const validation = useValidation();
  const bedManagement = useBedManagement(
    record,
    saveAndUpdate,
    patchRecord,
    ensureStaleDayEditAllowed
  );
  const dischargeManagement = usePatientDischarges(record, saveAndUpdate, undefined, patchRecord);
  const transferManagement = usePatientTransfers(record, saveAndUpdate, undefined, patchRecord);
  const nurseManagement = useNurseManagement(record, patchRecord);
  const tensManagement = useTensManagement(record, patchRecord);
  const staffingManagement = useDetailedStaffingManagement(record, patchRecord);
  const cmaManagement = useCMA(record, saveAndUpdate, patchRecord);
  const handoffManagement = useHandoffManagement(record, saveAndUpdate, patchRecord);

  return {
    inventory,
    stabilityRules,
    validation,
    bedManagement,
    dischargeManagement,
    transferManagement,
    nurseManagement,
    tensManagement,
    staffingManagement,
    cmaManagement,
    handoffManagement,
  };
};

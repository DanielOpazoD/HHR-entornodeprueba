import { useMemo } from 'react';
import type {
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import { usePatientDischarges } from '@/hooks/usePatientDischarges';
import { usePatientTransfers } from '@/hooks/usePatientTransfers';
import type { DischargeTarget, PatientMovementActions } from '@/types/movements';

export type { DischargeTarget };

/**
 * Legacy compatibility wrapper.
 * Internally delegates to the refactored movement hooks to keep a single
 * source of truth for discharge/transfer behavior.
 */
export const useMovements = (
  record: DailyRecord | null,
  saveAndUpdate: PersistDailyRecord
): PatientMovementActions => {
  const discharges = usePatientDischarges(record, saveAndUpdate);
  const transfers = usePatientTransfers(record, saveAndUpdate);

  return useMemo(
    () => ({
      addDischarge: discharges.addDischarge,
      updateDischarge: discharges.updateDischarge,
      deleteDischarge: discharges.deleteDischarge,
      undoDischarge: discharges.undoDischarge,
      convertDischargeToCma: discharges.convertDischargeToCma,
      addTransfer: transfers.addTransfer,
      updateTransfer: transfers.updateTransfer,
      deleteTransfer: transfers.deleteTransfer,
      undoTransfer: transfers.undoTransfer,
    }),
    [discharges, transfers]
  );
};

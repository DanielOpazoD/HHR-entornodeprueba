import { useMemo } from 'react';
import { DailyRecord } from '@/types';
import { usePatientDischarges } from '@/hooks/usePatientDischarges';
import { usePatientTransfers } from '@/hooks/usePatientTransfers';
import type { DischargeTarget } from '@/features/census/types/censusActionTypes';
import type { PatientMovementActions } from '@/features/census/types/patientMovementCommandTypes';

export type { DischargeTarget };

/**
 * Legacy compatibility wrapper.
 * Internally delegates to the refactored movement hooks to keep a single
 * source of truth for discharge/transfer behavior.
 */
export const useMovements = (
  record: DailyRecord | null,
  saveAndUpdate: (updatedRecord: DailyRecord) => void
): PatientMovementActions => {
  const discharges = usePatientDischarges(record, saveAndUpdate);
  const transfers = usePatientTransfers(record, saveAndUpdate);

  return useMemo(
    () => ({
      addDischarge: discharges.addDischarge,
      updateDischarge: discharges.updateDischarge,
      deleteDischarge: discharges.deleteDischarge,
      undoDischarge: discharges.undoDischarge,
      addTransfer: transfers.addTransfer,
      updateTransfer: transfers.updateTransfer,
      deleteTransfer: transfers.deleteTransfer,
      undoTransfer: transfers.undoTransfer,
    }),
    [discharges, transfers]
  );
};

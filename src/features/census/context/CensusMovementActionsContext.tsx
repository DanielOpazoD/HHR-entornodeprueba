import React, { createContext, useContext, useMemo } from 'react';
import type { DailyRecordMovementActions } from '@/context/dailyRecordContextContracts';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useDailyRecordPersistenceActions } from '@/context/useDailyRecordScopedActions';
import { usePatientDischarges } from '@/features/census/hooks/usePatientDischarges';
import { usePatientTransfers } from '@/features/census/hooks/usePatientTransfers';
import { useCMA } from '@/features/census/hooks/useCMA';

const CensusMovementActionsContext = createContext<DailyRecordMovementActions | undefined>(
  undefined
);

/**
 * Composes discharge, transfer and CMA mutations inside the lazy census route instead of the
 * global authenticated shell. Each hook stores `record` in a ref, so the provided value keeps
 * referential stability across unrelated daily-record edits.
 */
export const CensusMovementActionsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { record } = useDailyRecordData();
  const { saveAndUpdate, patchRecord } = useDailyRecordPersistenceActions();
  const dischargeManagement = usePatientDischarges(record, saveAndUpdate, undefined, patchRecord);
  const transferManagement = usePatientTransfers(record, saveAndUpdate, undefined, patchRecord);
  const cmaManagement = useCMA(record, patchRecord);

  const value = useMemo<DailyRecordMovementActions>(
    () => ({
      addDischarge: dischargeManagement.addDischarge,
      updateDischarge: dischargeManagement.updateDischarge,
      deleteDischarge: dischargeManagement.deleteDischarge,
      undoDischarge: dischargeManagement.undoDischarge,
      convertDischargeToCma: dischargeManagement.convertDischargeToCma,
      convertDischargeToTransfer: dischargeManagement.convertDischargeToTransfer,
      addTransfer: transferManagement.addTransfer,
      updateTransfer: transferManagement.updateTransfer,
      deleteTransfer: transferManagement.deleteTransfer,
      undoTransfer: transferManagement.undoTransfer,
      convertTransferToHomeDischarge: transferManagement.convertTransferToHomeDischarge,
      convertTransferToCma: transferManagement.convertTransferToCma,
      addCMA: cmaManagement.addCMA,
      deleteCMA: cmaManagement.deleteCMA,
      updateCMA: cmaManagement.updateCMA,
      undoCMA: cmaManagement.undoCMA,
      convertCmaToHomeDischarge: cmaManagement.convertCmaToHomeDischarge,
      convertCmaToTransfer: cmaManagement.convertCmaToTransfer,
    }),
    [cmaManagement, dischargeManagement, transferManagement]
  );

  return (
    <CensusMovementActionsContext.Provider value={value}>
      {children}
    </CensusMovementActionsContext.Provider>
  );
};

export const useCensusMovementActions = (): DailyRecordMovementActions => {
  const context = useContext(CensusMovementActionsContext);
  if (!context) {
    throw new Error('useCensusMovementActions must be used within a CensusMovementActionsProvider');
  }
  return context;
};

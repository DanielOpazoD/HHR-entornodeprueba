import React, { createContext, useContext, useMemo } from 'react';
import {
  DailyRecordContextType,
  DailyRecordDataContextType,
  DailyRecordActionsContextType
} from '../hooks/useDailyRecordTypes';

// 1. Specialized Contexts
const DailyRecordDataContext = createContext<DailyRecordDataContextType | undefined>(undefined);
const DailyRecordActionsContext = createContext<DailyRecordActionsContextType | undefined>(undefined);

/**
 * Fragmented Provider
 * Wraps children in two separate contexts to optimize re-renders.
 */
export const DailyRecordProvider: React.FC<{ value: DailyRecordContextType; children: React.ReactNode }> = ({ value, children }) => {
  // Memoize data
  const dataValue: DailyRecordDataContextType = useMemo(() => ({
    record: value.record,
    syncStatus: value.syncStatus,
    lastSyncTime: value.lastSyncTime,
    inventory: value.inventory
  }), [value.record, value.syncStatus, value.lastSyncTime, value.inventory]);

  // Memoize actions
  const actionsValue: DailyRecordActionsContextType = useMemo(() => ({
    createDay: value.createDay,
    generateDemo: value.generateDemo,
    resetDay: value.resetDay,
    refresh: value.refresh,
    validateRecordSchema: value.validateRecordSchema,
    canMovePatient: value.canMovePatient,
    canDischargePatient: value.canDischargePatient,
    updatePatient: value.updatePatient,
    updatePatientMultiple: value.updatePatientMultiple,
    updateClinicalCrib: value.updateClinicalCrib,
    updateClinicalCribMultiple: value.updateClinicalCribMultiple,
    updateClinicalCribCudyr: value.updateClinicalCribCudyr,
    updateClinicalCribCudyrMultiple: value.updateClinicalCribCudyrMultiple,
    updateCudyr: value.updateCudyr,
    updateCudyrMultiple: value.updateCudyrMultiple,
    clearPatient: value.clearPatient,
    clearAllBeds: value.clearAllBeds,
    moveOrCopyPatient: value.moveOrCopyPatient,
    toggleBlockBed: value.toggleBlockBed,
    updateBlockedReason: value.updateBlockedReason,
    toggleExtraBed: value.toggleExtraBed,
    updateNurse: value.updateNurse,
    updateTens: value.updateTens,
    addDischarge: value.addDischarge,
    updateDischarge: value.updateDischarge,
    deleteDischarge: value.deleteDischarge,
    undoDischarge: value.undoDischarge,
    addTransfer: value.addTransfer,
    updateTransfer: value.updateTransfer,
    deleteTransfer: value.deleteTransfer,
    undoTransfer: value.undoTransfer,
    addCMA: value.addCMA,
    deleteCMA: value.deleteCMA,
    updateCMA: value.updateCMA,
    updateHandoffChecklist: value.updateHandoffChecklist,
    updateHandoffNovedades: value.updateHandoffNovedades,
    updateHandoffStaff: value.updateHandoffStaff,
    updateMedicalSignature: value.updateMedicalSignature,
    updateMedicalHandoffDoctor: value.updateMedicalHandoffDoctor,
    markMedicalHandoffAsSent: value.markMedicalHandoffAsSent,
    sendMedicalHandoff: value.sendMedicalHandoff
  }), [
    value.createDay, value.generateDemo, value.resetDay, value.refresh,
    value.validateRecordSchema, value.canMovePatient, value.canDischargePatient,
    value.updatePatient, value.updatePatientMultiple,
    value.updateClinicalCrib, value.updateClinicalCribMultiple,
    value.updateClinicalCribCudyr, value.updateClinicalCribCudyrMultiple,
    value.updateCudyr, value.updateCudyrMultiple,
    value.clearPatient, value.clearAllBeds, value.moveOrCopyPatient,
    value.toggleBlockBed, value.updateBlockedReason, value.toggleExtraBed,
    value.updateNurse, value.updateTens,
    value.addDischarge, value.updateDischarge, value.deleteDischarge, value.undoDischarge,
    value.addTransfer, value.updateTransfer, value.deleteTransfer, value.undoTransfer,
    value.addCMA, value.deleteCMA, value.updateCMA,
    value.updateHandoffChecklist, value.updateHandoffNovedades, value.updateHandoffStaff,
    value.updateMedicalSignature, value.updateMedicalHandoffDoctor,
    value.markMedicalHandoffAsSent, value.sendMedicalHandoff
  ]);

  return (
    <DailyRecordActionsContext.Provider value={actionsValue}>
      <DailyRecordDataContext.Provider value={dataValue}>
        {children}
      </DailyRecordDataContext.Provider>
    </DailyRecordActionsContext.Provider>
  );
};

// 2. Optimized Hooks

/**
 * Access only the reactive data.
 * Re-renders when record or sync status changes.
 */
export const useDailyRecordData = () => {
  const context = useContext(DailyRecordDataContext);
  if (!context) throw new Error('useDailyRecordData must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access only stable actions.
 * Does NOT re-render when data changes. Use for buttons, forms, etc.
 */
export const useDailyRecordActions = () => {
  const context = useContext(DailyRecordActionsContext);
  if (!context) throw new Error('useDailyRecordActions must be used within a DailyRecordProvider');
  return context;
};

/**
 * Legacy hook for compatibility.
 * Combines both (triggers re-renders on every data change).
 */
export const useDailyRecordContext = (): DailyRecordContextType => {
  const data = useDailyRecordData();
  const actions = useDailyRecordActions();
  return { ...data, ...actions };
};
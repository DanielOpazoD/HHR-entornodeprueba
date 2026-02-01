/**
 * DailyRecordContext
 * 
 * Fragmented context system for optimal rendering of census data.
 * 
 * 📘 GUÍA DE ESTILO: Para elegir el hook correcto y evitar problemas de performance,
 * consulta src/docs/HOOKS_STYLE_GUIDE.md
 */
import React, { createContext, useContext, useMemo } from 'react';
import {
  DailyRecordContextType,
  DailyRecordDataContextType,
  DailyRecordActionsContextType,
  SyncStatus,
  InventoryStats
} from '@/hooks/useDailyRecordTypes';
import { PatientData, DischargeData, TransferData, CMAData } from '@/types';
import { StabilityRules } from '@/hooks/useStabilityRules';

// 1. Specialized Contexts
const DailyRecordDataContext = createContext<DailyRecordDataContextType | undefined>(undefined);
const DailyRecordActionsContext = createContext<DailyRecordActionsContextType | undefined>(undefined);

// Fragmented Data Contexts
const DailyRecordBedsContext = createContext<Record<string, PatientData> | null | undefined>(undefined);
const DailyRecordMovementsContext = createContext<{
  discharges: DischargeData[];
  transfers: TransferData[];
  cma: CMAData[];
} | null | undefined>(undefined);
const DailyRecordSyncContext = createContext<{
  syncStatus: SyncStatus;
  lastSyncTime: Date | null;
} | undefined>(undefined);
const DailyRecordStabilityContext = createContext<StabilityRules | null | undefined>(undefined);
const DailyRecordInventoryContext = createContext<InventoryStats | null | undefined>(undefined);
const DailyRecordStaffContext = createContext<{
  nursesDayShift: string[];
  nursesNightShift: string[];
  tensDayShift: string[];
  tensNightShift: string[];
  activeExtraBeds: string[];
} | null | undefined>(undefined);

/**
 * Fragmented Provider
 * Wraps children in multiple specialized contexts to optimize re-renders.
 */
export const DailyRecordProvider: React.FC<{ value: DailyRecordContextType; children: React.ReactNode }> = ({ value, children }) => {
  // Sync Status Context
  const syncValue = useMemo(() => ({
    syncStatus: value?.syncStatus || 'idle',
    lastSyncTime: value?.lastSyncTime || null
  }), [value?.syncStatus, value?.lastSyncTime]);

  // Beds Context
  const bedsValue = useMemo(() =>
    value?.record?.beds || null,
    [value?.record?.beds]);

  // Movements Context
  const movementsValue = useMemo(() => {
    if (!value?.record) return null;
    return {
      discharges: value.record.discharges || [],
      transfers: value.record.transfers || [],
      cma: value.record.cma || []
    };
  }, [value?.record]);

  // Stability Context
  const stabilityValue = useMemo(() =>
    value?.stabilityRules || null,
    [value?.stabilityRules]);

  // Inventory Context
  const inventoryValue = useMemo(() =>
    value?.inventory || null,
    [value?.inventory]);

  // Staff Context
  const staffValue = useMemo(() => {
    if (!value?.record) return null;
    return {
      nursesDayShift: value.record.nursesDayShift || ['', ''],
      nursesNightShift: value.record.nursesNightShift || ['', ''],
      tensDayShift: value.record.tensDayShift || ['', '', ''],
      tensNightShift: value.record.tensNightShift || ['', '', ''],
      activeExtraBeds: value.record.activeExtraBeds || []
    };
  }, [value?.record]);

  // Unified Data (Legacy/Heavy)
  const dataValue: DailyRecordDataContextType = useMemo(() => ({
    record: value?.record || null,
    syncStatus: value?.syncStatus || 'idle',
    lastSyncTime: value?.lastSyncTime || null,
    inventory: value?.inventory as any,
    stabilityRules: value?.stabilityRules as any
  }), [value?.record, value?.syncStatus, value?.lastSyncTime, value?.inventory, value?.stabilityRules]);

  const hasRecord = !!value?.record;

  // Stable Actions
  const actionsValue: DailyRecordActionsContextType = useMemo(() => ({
    createDay: value?.createDay,
    generateDemo: value?.generateDemo,
    resetDay: value?.resetDay,
    refresh: value?.refresh,
    validateRecordSchema: value?.validateRecordSchema,
    canMovePatient: value?.canMovePatient,
    canDischargePatient: value?.canDischargePatient,
    updatePatient: value?.updatePatient,
    updatePatientMultiple: value?.updatePatientMultiple,
    updateClinicalCrib: value?.updateClinicalCrib,
    updateClinicalCribMultiple: value?.updateClinicalCribMultiple,
    updateClinicalCribCudyr: value?.updateClinicalCribCudyr,
    updateClinicalCribCudyrMultiple: value?.updateClinicalCribCudyrMultiple,
    updateCudyr: value?.updateCudyr,
    updateCudyrMultiple: value?.updateCudyrMultiple,
    clearPatient: value?.clearPatient,
    clearAllBeds: value?.clearAllBeds,
    moveOrCopyPatient: value?.moveOrCopyPatient,
    toggleBlockBed: value?.toggleBlockBed,
    updateBlockedReason: value?.updateBlockedReason,
    toggleExtraBed: value?.toggleExtraBed,
    updateNurse: value?.updateNurse,
    updateTens: value?.updateTens,
    addDischarge: value?.addDischarge,
    updateDischarge: value?.updateDischarge,
    deleteDischarge: value?.deleteDischarge,
    undoDischarge: value?.undoDischarge,
    addTransfer: value?.addTransfer,
    updateTransfer: value?.updateTransfer,
    deleteTransfer: value?.deleteTransfer,
    undoTransfer: value?.undoTransfer,
    addCMA: value?.addCMA,
    deleteCMA: value?.deleteCMA,
    updateCMA: value?.updateCMA,
    updateHandoffChecklist: value?.updateHandoffChecklist,
    updateHandoffNovedades: value?.updateHandoffNovedades,
    updateHandoffStaff: value?.updateHandoffStaff,
    updateMedicalSignature: value?.updateMedicalSignature,
    updateMedicalHandoffDoctor: value?.updateMedicalHandoffDoctor,
    markMedicalHandoffAsSent: value?.markMedicalHandoffAsSent,
    sendMedicalHandoff: value?.sendMedicalHandoff,
    copyPatientToDate: value?.copyPatientToDate
  }) as any, [
    hasRecord,
    value?.createDay, value?.generateDemo, value?.resetDay, value?.refresh,
    value?.validateRecordSchema, value?.canMovePatient, value?.canDischargePatient,
    value?.updatePatient, value?.updatePatientMultiple,
    value?.updateClinicalCrib, value?.updateClinicalCribMultiple,
    value?.updateClinicalCribCudyr, value?.updateClinicalCribCudyrMultiple,
    value?.updateCudyr, value?.updateCudyrMultiple,
    value?.clearPatient, value?.clearAllBeds, value?.moveOrCopyPatient,
    value?.toggleBlockBed, value?.updateBlockedReason, value?.toggleExtraBed,
    value?.updateNurse, value?.updateTens,
    value?.addDischarge, value?.updateDischarge, value?.deleteDischarge, value?.undoDischarge,
    value?.addTransfer, value?.updateTransfer, value?.deleteTransfer, value?.undoTransfer,
    value?.addCMA, value?.deleteCMA, value?.updateCMA,
    value?.updateHandoffChecklist, value?.updateHandoffNovedades, value?.updateHandoffStaff,
    value?.updateMedicalSignature, value?.updateMedicalHandoffDoctor,
    value?.markMedicalHandoffAsSent, value?.sendMedicalHandoff,
    value?.copyPatientToDate
  ]);

  return (
    <DailyRecordActionsContext.Provider value={actionsValue}>
      <DailyRecordSyncContext.Provider value={syncValue}>
        <DailyRecordStabilityContext.Provider value={stabilityValue}>
          <DailyRecordInventoryContext.Provider value={inventoryValue}>
            <DailyRecordStaffContext.Provider value={staffValue}>
              <DailyRecordMovementsContext.Provider value={movementsValue}>
                <DailyRecordBedsContext.Provider value={bedsValue}>
                  <DailyRecordDataContext.Provider value={dataValue}>
                    {children}
                  </DailyRecordDataContext.Provider>
                </DailyRecordBedsContext.Provider>
              </DailyRecordMovementsContext.Provider>
            </DailyRecordStaffContext.Provider>
          </DailyRecordInventoryContext.Provider>
        </DailyRecordStabilityContext.Provider>
      </DailyRecordSyncContext.Provider>
    </DailyRecordActionsContext.Provider>
  );
};

// 2. Optimized Hooks

/**
 * Access only the full reactive data.
 * Re-renders when ANY part of the record or sync status changes.
 */
export const useDailyRecordData = () => {
  const context = useContext(DailyRecordDataContext);
  if (context === undefined) throw new Error('useDailyRecordData must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access only the beds data.
 * Re-renders only when record.beds changes.
 */
export const useDailyRecordBeds = () => {
  const context = useContext(DailyRecordBedsContext);
  if (context === undefined) throw new Error('useDailyRecordBeds must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access only movement data (discharges, transfers, cma).
 */
export const useDailyRecordMovements = () => {
  const context = useContext(DailyRecordMovementsContext);
  if (context === undefined) throw new Error('useDailyRecordMovements must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access only sync status.
 */
export const useDailyRecordSync = () => {
  const context = useContext(DailyRecordSyncContext);
  if (context === undefined) throw new Error('useDailyRecordSync must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access stability rules.
 */
export const useDailyRecordStability = () => {
  const context = useContext(DailyRecordStabilityContext);
  if (context === undefined) throw new Error('useDailyRecordStability must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access inventory stats.
 */
export const useDailyRecordInventory = () => {
  const context = useContext(DailyRecordInventoryContext);
  if (context === undefined) throw new Error('useDailyRecordInventory must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access staff data.
 */
export const useDailyRecordStaff = () => {
  const context = useContext(DailyRecordStaffContext);
  if (context === undefined) throw new Error('useDailyRecordStaff must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access only stable actions.
 * Does NOT re-render when data changes. Use for buttons, forms, etc.
 */
export const useDailyRecordActions = () => {
  const context = useContext(DailyRecordActionsContext);
  if (context === undefined) throw new Error('useDailyRecordActions must be used within a DailyRecordProvider');
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

// Hook for accessing specific bed data efficiently
export const usePatientData = (bedId: string) => {
  const beds = useDailyRecordBeds();
  return beds ? (beds as Record<string, PatientData>)[bedId] : undefined;
};
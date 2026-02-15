/**
 * DailyRecordContext
 *
 * Fragmented context system for optimal rendering of census data.
 *
 * 📘 GUÍA DE ESTILO: Para elegir el hook correcto y evitar problemas de performance,
 * consulta src/docs/HOOKS_STYLE_GUIDE.md
 */
import React, { createContext, useContext } from 'react';
import {
  DailyRecordContextType,
  DailyRecordDataContextType,
  DailyRecordActionsContextType,
  SyncStatus,
  InventoryStats,
} from '@/hooks/useDailyRecordTypes';
import { PatientData, DischargeData, TransferData, CMAData } from '@/types';
import { StabilityRules } from '@/hooks/useStabilityRules';
import { useDailyRecordFragmentedValues } from '@/context/useDailyRecordFragmentedValues';

// 1. Specialized Contexts
const DailyRecordDataContext = createContext<DailyRecordDataContextType | undefined>(undefined);
const DailyRecordActionsContext = createContext<DailyRecordActionsContextType | undefined>(
  undefined
);

// Fragmented Data Contexts
const DailyRecordBedsContext = createContext<Record<string, PatientData> | null | undefined>(
  undefined
);
const DailyRecordMovementsContext = createContext<
  | {
      discharges: DischargeData[];
      transfers: TransferData[];
      cma: CMAData[];
    }
  | null
  | undefined
>(undefined);
const DailyRecordSyncContext = createContext<
  | {
      syncStatus: SyncStatus;
      lastSyncTime: Date | null;
    }
  | undefined
>(undefined);
const DailyRecordStabilityContext = createContext<StabilityRules | null | undefined>(undefined);
const DailyRecordInventoryContext = createContext<InventoryStats | null | undefined>(undefined);
const DailyRecordStaffContext = createContext<
  | {
      nursesDayShift: string[];
      nursesNightShift: string[];
      tensDayShift: string[];
      tensNightShift: string[];
      activeExtraBeds: string[];
    }
  | null
  | undefined
>(undefined);
const DailyRecordOverridesContext = createContext<Record<string, string> | undefined>(undefined);

/**
 * Fragmented Provider
 * Wraps children in multiple specialized contexts to optimize re-renders.
 */
export const DailyRecordProvider: React.FC<{
  value: DailyRecordContextType;
  children: React.ReactNode;
}> = ({ value, children }) => {
  const {
    syncValue,
    bedsValue,
    movementsValue,
    stabilityValue,
    inventoryValue,
    staffValue,
    overridesValue,
    dataValue,
    actionsValue,
  } = useDailyRecordFragmentedValues(value);

  return (
    <DailyRecordActionsContext.Provider value={actionsValue}>
      <DailyRecordSyncContext.Provider value={syncValue}>
        <DailyRecordStabilityContext.Provider value={stabilityValue}>
          <DailyRecordInventoryContext.Provider value={inventoryValue}>
            <DailyRecordStaffContext.Provider value={staffValue}>
              <DailyRecordMovementsContext.Provider value={movementsValue}>
                <DailyRecordBedsContext.Provider value={bedsValue}>
                  <DailyRecordDataContext.Provider value={dataValue}>
                    <DailyRecordOverridesContext.Provider value={overridesValue}>
                      {children}
                    </DailyRecordOverridesContext.Provider>
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
  if (context === undefined)
    throw new Error('useDailyRecordData must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access only the beds data.
 * Re-renders only when record.beds changes.
 */
export const useDailyRecordBeds = () => {
  const context = useContext(DailyRecordBedsContext);
  if (context === undefined)
    throw new Error('useDailyRecordBeds must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access only movement data (discharges, transfers, cma).
 */
export const useDailyRecordMovements = () => {
  const context = useContext(DailyRecordMovementsContext);
  if (context === undefined)
    throw new Error('useDailyRecordMovements must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access only sync status.
 */
export const useDailyRecordSync = () => {
  const context = useContext(DailyRecordSyncContext);
  if (context === undefined)
    throw new Error('useDailyRecordSync must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access stability rules.
 */
export const useDailyRecordStability = () => {
  const context = useContext(DailyRecordStabilityContext);
  if (context === undefined)
    throw new Error('useDailyRecordStability must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access inventory stats.
 */
export const useDailyRecordInventory = () => {
  const context = useContext(DailyRecordInventoryContext);
  if (context === undefined)
    throw new Error('useDailyRecordInventory must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access staff data.
 */
export const useDailyRecordStaff = () => {
  const context = useContext(DailyRecordStaffContext);
  if (context === undefined)
    throw new Error('useDailyRecordStaff must be used within a DailyRecordProvider');
  return context;
};

/**
 * Access bed type overrides.
 */
export const useDailyRecordOverrides = () => {
  const context = useContext(DailyRecordOverridesContext);
  if (context === undefined)
    throw new Error('useDailyRecordOverrides must be used within a DailyRecordProvider');
  return context || {};
};

/**
 * Access only stable actions.
 * Does NOT re-render when data changes. Use for buttons, forms, etc.
 */
export const useDailyRecordActions = () => {
  const context = useContext(DailyRecordActionsContext);
  if (context === undefined)
    throw new Error('useDailyRecordActions must be used within a DailyRecordProvider');
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

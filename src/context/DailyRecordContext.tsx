import type { PatientData } from '@/types/domain/patient';

/**
 * DailyRecordContext
 *
 * Fragmented context system for optimal rendering of census data.
 *
 * 📘 GUÍA DE ESTILO: Para elegir el hook correcto y evitar problemas de performance,
 * consulta src/docs/HOOKS_STYLE_GUIDE.md
 */
import React from 'react';
import { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { DailyRecordProviderTree } from '@/context/dailyRecordProviderTree';
import { buildDailyRecordStatusModel } from '@/context/dailyRecordStatusController';

import { useDailyRecordFragmentedValues } from '@/context/useDailyRecordFragmentedValues';
import { useRequiredDailyRecordActionsContext } from './dailyRecordActionsContext';
import { useRequiredContextValue } from './contextHookSupport';
import {
  DailyRecordBedsContext,
  DailyRecordDataContext,
  DailyRecordInventoryContext,
  DailyRecordMovementsContext,
  DailyRecordOverridesContext,
  DailyRecordStaffContext,
  DailyRecordStabilityContext,
  DailyRecordSyncContext,
} from './dailyRecordProviderTree';

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
    <DailyRecordProviderTree
      actionsValue={actionsValue}
      syncValue={syncValue}
      stabilityValue={stabilityValue}
      inventoryValue={inventoryValue}
      staffValue={staffValue}
      movementsValue={movementsValue}
      bedsValue={bedsValue}
      dataValue={dataValue}
      overridesValue={overridesValue}
    >
      {children}
    </DailyRecordProviderTree>
  );
};

// 2. Optimized Hooks

/**
 * Access only the full reactive data.
 * Re-renders when ANY part of the record or sync status changes.
 */
export const useDailyRecordData = () => {
  return useRequiredContextValue(DailyRecordDataContext, 'useDailyRecordData');
};

/**
 * Access only the beds data.
 * Re-renders only when record.beds changes.
 */
export const useDailyRecordBeds = () => {
  return useRequiredContextValue(DailyRecordBedsContext, 'useDailyRecordBeds');
};

/**
 * Access only movement data (discharges, transfers, cma).
 */
export const useDailyRecordMovements = () => {
  return useRequiredContextValue(DailyRecordMovementsContext, 'useDailyRecordMovements');
};

/**
 * Access only sync status.
 */
export const useDailyRecordSync = () => {
  return useRequiredContextValue(DailyRecordSyncContext, 'useDailyRecordSync');
};

/**
 * Access sync UI state (status badges, watchers, indicators).
 * Alias intentionally explicit for presentation-layer consumers.
 */
export const useDailyRecordStatus = () => {
  const { syncStatus, lastSyncTime, bootstrapPhase } = useDailyRecordSync();
  return buildDailyRecordStatusModel({
    syncStatus,
    lastSyncTime,
    bootstrapPhase,
  });
};

/**
 * Access stability rules.
 */
export const useDailyRecordStability = () => {
  return useRequiredContextValue(DailyRecordStabilityContext, 'useDailyRecordStability');
};

/**
 * Access inventory stats.
 */
export const useDailyRecordInventory = () => {
  return useRequiredContextValue(DailyRecordInventoryContext, 'useDailyRecordInventory');
};

/**
 * Access staff data.
 */
export const useDailyRecordStaff = () => {
  return useRequiredContextValue(DailyRecordStaffContext, 'useDailyRecordStaff');
};

/**
 * Access bed type overrides.
 */
export const useDailyRecordOverrides = () => {
  return useRequiredContextValue(DailyRecordOverridesContext, 'useDailyRecordOverrides') || {};
};

/**
 * Access only stable actions.
 * Does NOT re-render when data changes. Use for buttons, forms, etc.
 */
export const useDailyRecordActions = () => {
  return useRequiredDailyRecordActionsContext('useDailyRecordActions');
};

/**
 * Legacy hook for compatibility.
 * Combines both (triggers re-renders on every data change).
 * @deprecated Prefer fragmented hooks: useDailyRecordData/useDailyRecordActions/useDailyRecordBeds...
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

export {
  useDailyRecordBedActions,
  useDailyRecordCudyrActions,
  useDailyRecordDayActions,
  useDailyRecordHandoffActions,
  useDailyRecordMovementActions,
  useDailyRecordStaffActions,
} from '@/context/useDailyRecordScopedActions';

/**
 * DailyRecordContext
 *
 * Fragmented context system for optimal rendering of census data.
 *
 * 📘 GUÍA DE ESTILO: Para elegir el hook correcto y evitar problemas de performance,
 * consulta «El registro diario» en docs/architecture.md
 */
import React, { useContext, useMemo } from 'react';
import { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { DailyRecordProviderTree } from '@/context/dailyRecordProviderTree';
import { buildDailyRecordStatusModel } from '@/context/dailyRecordStatusController';

import { useDailyRecordFragmentedValues } from '@/context/useDailyRecordFragmentedValues';
import {
  DailyRecordBedsContext,
  DailyRecordDataContext,
  DailyRecordMetaContext,
  DailyRecordMovementsContext,
  DailyRecordOverridesContext,
  DailyRecordStaffContext,
  DailyRecordStabilityContext,
  DailyRecordSyncContext,
} from './dailyRecordProviderTree';

const EMPTY_OVERRIDES: Record<string, string> = {};

const useRequiredContextValue = <T,>(
  context: React.Context<T | undefined>,
  hookName: string
): T => {
  const value = useContext(context);
  if (value === undefined) {
    throw new Error(`${hookName} must be used within a DailyRecordProvider`);
  }
  return value;
};

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
    metaValue,
    movementsValue,
    stabilityValue,
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
      staffValue={staffValue}
      movementsValue={movementsValue}
      bedsValue={bedsValue}
      metaValue={metaValue}
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
 * Optional beds reader for host boundaries that may be rendered outside DailyRecordProvider in
 * isolated tests. Returns `undefined` when no provider is mounted.
 */
export const useOptionalDailyRecordBeds = () => {
  return useContext(DailyRecordBedsContext);
};

/**
 * Access stable day metadata (date, Rayen coverage completion timestamp, active extra beds).
 * Avoids re-rendering on bed edits, sync status ticks, staff edits, or movement updates.
 */
export const useDailyRecordMeta = () => {
  return useRequiredContextValue(DailyRecordMetaContext, 'useDailyRecordMeta');
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
  return useMemo(
    () =>
      buildDailyRecordStatusModel({
        syncStatus,
        lastSyncTime,
        bootstrapPhase,
      }),
    [syncStatus, lastSyncTime, bootstrapPhase]
  );
};

/**
 * Access stability rules.
 */
export const useDailyRecordStability = () => {
  return useRequiredContextValue(DailyRecordStabilityContext, 'useDailyRecordStability');
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
  return (
    useRequiredContextValue(DailyRecordOverridesContext, 'useDailyRecordOverrides') ||
    EMPTY_OVERRIDES
  );
};

export {
  useDailyRecordBedActions,
  useDailyRecordDayActions,
  useDailyRecordHandoffActions,
  useDailyRecordMovementActions,
  useDailyRecordStaffActions,
} from '@/context/useDailyRecordScopedActions';

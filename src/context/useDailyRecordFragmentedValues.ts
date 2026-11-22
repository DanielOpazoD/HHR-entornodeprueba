import type { PatientData } from '@/types/domain/patient';

import { useMemo } from 'react';
import type {
  DailyRecordActionsContextType,
  DailyRecordContextType,
  DailyRecordDataContextType,
  InventoryStats,
  SyncStatus,
} from '@/context/dailyRecordContextContracts';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/domain/movements/movementTombstonePolicy';

import type { StabilityRules } from '@/hooks/useStabilityRules';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';

interface UseDailyRecordFragmentedValuesResult {
  syncValue: {
    syncStatus: SyncStatus;
    lastSyncTime: Date | null;
    bootstrapPhase: DailyRecordBootstrapPhase;
  };
  bedsValue: Record<string, PatientData> | null;
  movementsValue: {
    discharges: DischargeData[];
    transfers: TransferData[];
    cma: CMAData[];
  } | null;
  stabilityValue: StabilityRules | null;
  staffValue: {
    date?: string;
    nursesDayShift: string[];
    nursesNightShift: string[];
    tensDayShift: string[];
    tensNightShift: string[];
    staffingDetailsV1: NonNullable<DailyRecordContextType['record']>['staffingDetailsV1'];
    activeExtraBeds: string[];
  } | null;
  overridesValue: Record<string, string>;
  dataValue: DailyRecordDataContextType;
  actionsValue: DailyRecordActionsContextType;
}

const DEFAULT_INVENTORY: InventoryStats = {
  occupiedCount: 0,
  blockedCount: 0,
  availableCount: 0,
  occupancyRate: 0,
  occupiedBeds: [],
  freeBeds: [],
  blockedBeds: [],
  isFull: false,
};

const DEFAULT_LOCKED_STABILITY: StabilityRules = {
  isDateLocked: true,
  isDayShiftLocked: true,
  isNightShiftLocked: true,
  canEditField: () => false,
  canPerformActions: false,
};

const EMPTY_OVERRIDES: Record<string, string> = {};
const DEFAULT_NURSES_SHIFT: string[] = ['', ''];
const DEFAULT_TENS_SHIFT: string[] = ['', '', ''];
const EMPTY_EXTRA_BEDS: string[] = [];

export const useDailyRecordFragmentedValues = (
  value: DailyRecordContextType
): UseDailyRecordFragmentedValuesResult => {
  const syncValue = useMemo(
    () => ({
      syncStatus: value?.syncStatus || 'idle',
      lastSyncTime: value?.lastSyncTime || null,
      bootstrapPhase: value?.bootstrapPhase || 'local_only',
    }),
    [value?.bootstrapPhase, value?.syncStatus, value?.lastSyncTime]
  );

  const bedsValue = useMemo(() => value?.record?.beds || null, [value?.record?.beds]);

  const record = value?.record;
  const hasRecord = !!record;
  const {
    discharges,
    transfers,
    cma,
    date,
    nursesDayShift,
    nursesNightShift,
    tensDayShift,
    tensNightShift,
    staffingDetailsV1,
    activeExtraBeds,
  } = record || {};
  const movementsValue = useMemo(() => {
    if (!hasRecord) return null;
    return {
      discharges: getActiveDischarges(discharges),
      transfers: getActiveTransfers(transfers),
      cma: getActiveCma(cma),
    };
  }, [hasRecord, discharges, transfers, cma]);

  const stabilityValue = useMemo(() => value?.stabilityRules || null, [value?.stabilityRules]);

  const staffValue = useMemo(() => {
    if (!hasRecord) return null;
    return {
      date,
      nursesDayShift: nursesDayShift || DEFAULT_NURSES_SHIFT,
      nursesNightShift: nursesNightShift || DEFAULT_NURSES_SHIFT,
      tensDayShift: tensDayShift || DEFAULT_TENS_SHIFT,
      tensNightShift: tensNightShift || DEFAULT_TENS_SHIFT,
      staffingDetailsV1,
      activeExtraBeds: activeExtraBeds || EMPTY_EXTRA_BEDS,
    };
  }, [
    hasRecord,
    date,
    nursesDayShift,
    nursesNightShift,
    tensDayShift,
    tensNightShift,
    staffingDetailsV1,
    activeExtraBeds,
  ]);

  const overridesValue = useMemo(
    () => value?.record?.bedTypeOverrides || EMPTY_OVERRIDES,
    [value?.record?.bedTypeOverrides]
  );

  const dataValue: DailyRecordDataContextType = useMemo(
    () => ({
      record: value?.record || null,
      syncStatus: value?.syncStatus || 'idle',
      lastSyncTime: value?.lastSyncTime || null,
      bootstrapPhase: value?.bootstrapPhase || 'local_only',
      inventory: value?.inventory ?? DEFAULT_INVENTORY,
      stabilityRules: value?.stabilityRules ?? DEFAULT_LOCKED_STABILITY,
    }),
    [
      value?.record,
      value?.syncStatus,
      value?.lastSyncTime,
      value?.bootstrapPhase,
      value?.inventory,
      value?.stabilityRules,
    ]
  );

  const actionsValue: DailyRecordActionsContextType = useMemo(
    () =>
      ({
        createDay: value?.createDay,
        resetDay: value?.resetDay,
        refresh: value?.refresh,
        updatePatient: value?.updatePatient,
        updatePatientMultiple: value?.updatePatientMultiple,
        updateClinicalCrib: value?.updateClinicalCrib,
        updateClinicalCribMultiple: value?.updateClinicalCribMultiple,
        clearPatient: value?.clearPatient,
        clearAllBeds: value?.clearAllBeds,
        moveOrCopyPatient: value?.moveOrCopyPatient,
        toggleBlockBed: value?.toggleBlockBed,
        updateBlockedReason: value?.updateBlockedReason,
        toggleExtraBed: value?.toggleExtraBed,
        toggleBedType: value?.toggleBedType,
        updateShiftStaff: value?.updateShiftStaff,
        updateDetailedStaffing: value?.updateDetailedStaffing,
        addDischarge: value?.addDischarge,
        updateDischarge: value?.updateDischarge,
        deleteDischarge: value?.deleteDischarge,
        undoDischarge: value?.undoDischarge,
        convertDischargeToCma: value?.convertDischargeToCma,
        convertDischargeToTransfer: value?.convertDischargeToTransfer,
        addTransfer: value?.addTransfer,
        updateTransfer: value?.updateTransfer,
        deleteTransfer: value?.deleteTransfer,
        undoTransfer: value?.undoTransfer,
        convertTransferToHomeDischarge: value?.convertTransferToHomeDischarge,
        convertTransferToCma: value?.convertTransferToCma,
        addCMA: value?.addCMA,
        deleteCMA: value?.deleteCMA,
        updateCMA: value?.updateCMA,
        undoCMA: value?.undoCMA,
        convertCmaToHomeDischarge: value?.convertCmaToHomeDischarge,
        convertCmaToTransfer: value?.convertCmaToTransfer,
        updateHandoffChecklist: value?.updateHandoffChecklist,
        updateHandoffNovedades: value?.updateHandoffNovedades,
        updateHandoffReceives: value?.updateHandoffReceives,
        copyPatientToDate: value?.copyPatientToDate,
      }) as DailyRecordActionsContextType,
    [
      value?.createDay,
      value?.resetDay,
      value?.refresh,
      value?.updatePatient,
      value?.updatePatientMultiple,
      value?.updateClinicalCrib,
      value?.updateClinicalCribMultiple,
      value?.clearPatient,
      value?.clearAllBeds,
      value?.moveOrCopyPatient,
      value?.toggleBlockBed,
      value?.updateBlockedReason,
      value?.toggleExtraBed,
      value?.toggleBedType,
      value?.updateShiftStaff,
      value?.updateDetailedStaffing,
      value?.addDischarge,
      value?.updateDischarge,
      value?.deleteDischarge,
      value?.undoDischarge,
      value?.convertDischargeToCma,
      value?.convertDischargeToTransfer,
      value?.addTransfer,
      value?.updateTransfer,
      value?.deleteTransfer,
      value?.undoTransfer,
      value?.convertTransferToHomeDischarge,
      value?.convertTransferToCma,
      value?.addCMA,
      value?.deleteCMA,
      value?.updateCMA,
      value?.undoCMA,
      value?.convertCmaToHomeDischarge,
      value?.convertCmaToTransfer,
      value?.updateHandoffChecklist,
      value?.updateHandoffNovedades,
      value?.updateHandoffReceives,
      value?.copyPatientToDate,
    ]
  );

  return {
    syncValue,
    bedsValue,
    movementsValue,
    stabilityValue,
    staffValue,
    overridesValue,
    dataValue,
    actionsValue,
  };
};

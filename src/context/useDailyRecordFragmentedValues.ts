import { useMemo } from 'react';
import type {
  DailyRecordActionsContextType,
  DailyRecordContextType,
  DailyRecordDataContextType,
  InventoryStats,
  SyncStatus,
} from '@/hooks/useDailyRecordTypes';
import type { CMAData, DischargeData, PatientData, TransferData } from '@/types';
import type { StabilityRules } from '@/hooks/useStabilityRules';

interface UseDailyRecordFragmentedValuesResult {
  syncValue: {
    syncStatus: SyncStatus;
    lastSyncTime: Date | null;
  };
  bedsValue: Record<string, PatientData> | null;
  movementsValue: {
    discharges: DischargeData[];
    transfers: TransferData[];
    cma: CMAData[];
  } | null;
  stabilityValue: StabilityRules | null;
  inventoryValue: InventoryStats | null;
  staffValue: {
    nursesDayShift: string[];
    nursesNightShift: string[];
    tensDayShift: string[];
    tensNightShift: string[];
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

export const useDailyRecordFragmentedValues = (
  value: DailyRecordContextType
): UseDailyRecordFragmentedValuesResult => {
  const syncValue = useMemo(
    () => ({
      syncStatus: value?.syncStatus || 'idle',
      lastSyncTime: value?.lastSyncTime || null,
    }),
    [value?.syncStatus, value?.lastSyncTime]
  );

  const bedsValue = useMemo(() => value?.record?.beds || null, [value?.record?.beds]);

  const record = value?.record;
  const movementsValue = useMemo(() => {
    if (!record) return null;
    return {
      discharges: record.discharges || [],
      transfers: record.transfers || [],
      cma: record.cma || [],
    };
  }, [record]);

  const stabilityValue = useMemo(() => value?.stabilityRules || null, [value?.stabilityRules]);
  const inventoryValue = useMemo(() => value?.inventory || null, [value?.inventory]);

  const staffValue = useMemo(() => {
    if (!record) return null;
    return {
      nursesDayShift: record.nursesDayShift || ['', ''],
      nursesNightShift: record.nursesNightShift || ['', ''],
      tensDayShift: record.tensDayShift || ['', '', ''],
      tensNightShift: record.tensNightShift || ['', '', ''],
      activeExtraBeds: record.activeExtraBeds || [],
    };
  }, [record]);

  const overridesValue = useMemo(
    () => value?.record?.bedTypeOverrides || {},
    [value?.record?.bedTypeOverrides]
  );

  const dataValue: DailyRecordDataContextType = useMemo(
    () => ({
      record: value?.record || null,
      syncStatus: value?.syncStatus || 'idle',
      lastSyncTime: value?.lastSyncTime || null,
      inventory: value?.inventory ?? DEFAULT_INVENTORY,
      stabilityRules: value?.stabilityRules ?? DEFAULT_LOCKED_STABILITY,
    }),
    [value?.record, value?.syncStatus, value?.lastSyncTime, value?.inventory, value?.stabilityRules]
  );

  const actionsValue: DailyRecordActionsContextType = useMemo(
    () =>
      ({
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
        toggleBedType: value?.toggleBedType,
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
        copyPatientToDate: value?.copyPatientToDate,
      }) as DailyRecordActionsContextType,
    [
      value?.createDay,
      value?.generateDemo,
      value?.resetDay,
      value?.refresh,
      value?.validateRecordSchema,
      value?.canMovePatient,
      value?.canDischargePatient,
      value?.updatePatient,
      value?.updatePatientMultiple,
      value?.updateClinicalCrib,
      value?.updateClinicalCribMultiple,
      value?.updateClinicalCribCudyr,
      value?.updateClinicalCribCudyrMultiple,
      value?.updateCudyr,
      value?.updateCudyrMultiple,
      value?.clearPatient,
      value?.clearAllBeds,
      value?.moveOrCopyPatient,
      value?.toggleBlockBed,
      value?.updateBlockedReason,
      value?.toggleExtraBed,
      value?.toggleBedType,
      value?.updateNurse,
      value?.updateTens,
      value?.addDischarge,
      value?.updateDischarge,
      value?.deleteDischarge,
      value?.undoDischarge,
      value?.addTransfer,
      value?.updateTransfer,
      value?.deleteTransfer,
      value?.undoTransfer,
      value?.addCMA,
      value?.deleteCMA,
      value?.updateCMA,
      value?.updateHandoffChecklist,
      value?.updateHandoffNovedades,
      value?.updateHandoffStaff,
      value?.updateMedicalSignature,
      value?.updateMedicalHandoffDoctor,
      value?.markMedicalHandoffAsSent,
      value?.sendMedicalHandoff,
      value?.copyPatientToDate,
    ]
  );

  return {
    syncValue,
    bedsValue,
    movementsValue,
    stabilityValue,
    inventoryValue,
    staffValue,
    overridesValue,
    dataValue,
    actionsValue,
  };
};

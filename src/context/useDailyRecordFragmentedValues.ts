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
} from '@/application/census/movementTombstonePolicy';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
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
  inventoryValue: InventoryStats | null;
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
  const movementsValue = useMemo(() => {
    if (!record) return null;
    return {
      discharges: getActiveDischarges(record.discharges),
      transfers: getActiveTransfers(record.transfers),
      cma: getActiveCma(record.cma),
    };
  }, [record]);

  const stabilityValue = useMemo(() => value?.stabilityRules || null, [value?.stabilityRules]);
  const inventoryValue = useMemo(() => value?.inventory || null, [value?.inventory]);

  const staffValue = useMemo(() => {
    if (!record) return null;
    return {
      date: record.date,
      nursesDayShift: record.nursesDayShift || ['', ''],
      nursesNightShift: record.nursesNightShift || ['', ''],
      tensDayShift: record.tensDayShift || ['', '', ''],
      tensNightShift: record.tensNightShift || ['', '', ''],
      staffingDetailsV1: record.staffingDetailsV1,
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
        updateCudyrBatch: value?.updateCudyrBatch,
        clearPatient: value?.clearPatient,
        clearAllBeds: value?.clearAllBeds,
        moveOrCopyPatient: value?.moveOrCopyPatient,
        toggleBlockBed: value?.toggleBlockBed,
        updateBlockedReason: value?.updateBlockedReason,
        toggleExtraBed: value?.toggleExtraBed,
        toggleBedType: value?.toggleBedType,
        updateNurse: value?.updateNurse,
        updateTens: value?.updateTens,
        updateDetailedStaffing: value?.updateDetailedStaffing,
        addDischarge: value?.addDischarge,
        updateDischarge: value?.updateDischarge,
        deleteDischarge: value?.deleteDischarge,
        undoDischarge: value?.undoDischarge,
        convertDischargeToCma: value?.convertDischargeToCma,
        addTransfer: value?.addTransfer,
        updateTransfer: value?.updateTransfer,
        deleteTransfer: value?.deleteTransfer,
        undoTransfer: value?.undoTransfer,
        addCMA: value?.addCMA,
        deleteCMA: value?.deleteCMA,
        updateCMA: value?.updateCMA,
        undoCMA: value?.undoCMA,
        convertCmaToHomeDischarge: value?.convertCmaToHomeDischarge,
        updateHandoffChecklist: value?.updateHandoffChecklist,
        updateHandoffNovedades: value?.updateHandoffNovedades,
        updateMedicalSpecialtyNote: value?.updateMedicalSpecialtyNote,
        confirmMedicalSpecialtyNoChanges: value?.confirmMedicalSpecialtyNoChanges,
        updateHandoffStaff: value?.updateHandoffStaff,
        updateMedicalSignature: value?.updateMedicalSignature,
        updateMedicalHandoffDoctor: value?.updateMedicalHandoffDoctor,
        markMedicalHandoffAsSent: value?.markMedicalHandoffAsSent,
        ensureMedicalHandoffSignatureLink: value?.ensureMedicalHandoffSignatureLink,
        resetMedicalHandoffState: value?.resetMedicalHandoffState,
        sendMedicalHandoff: value?.sendMedicalHandoff,
        copyPatientToDate: value?.copyPatientToDate,
      }) as DailyRecordActionsContextType,
    [
      value?.createDay,
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
      value?.updateCudyrBatch,
      value?.clearPatient,
      value?.clearAllBeds,
      value?.moveOrCopyPatient,
      value?.toggleBlockBed,
      value?.updateBlockedReason,
      value?.toggleExtraBed,
      value?.toggleBedType,
      value?.updateNurse,
      value?.updateTens,
      value?.updateDetailedStaffing,
      value?.addDischarge,
      value?.updateDischarge,
      value?.deleteDischarge,
      value?.undoDischarge,
      value?.convertDischargeToCma,
      value?.addTransfer,
      value?.updateTransfer,
      value?.deleteTransfer,
      value?.undoTransfer,
      value?.addCMA,
      value?.deleteCMA,
      value?.updateCMA,
      value?.undoCMA,
      value?.convertCmaToHomeDischarge,
      value?.updateHandoffChecklist,
      value?.updateHandoffNovedades,
      value?.updateMedicalSpecialtyNote,
      value?.confirmMedicalSpecialtyNoChanges,
      value?.updateHandoffStaff,
      value?.updateMedicalSignature,
      value?.updateMedicalHandoffDoctor,
      value?.markMedicalHandoffAsSent,
      value?.ensureMedicalHandoffSignatureLink,
      value?.resetMedicalHandoffState,
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

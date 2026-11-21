import type { PatientData } from '@/types/domain/patient';

import type {
  ApplyDailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';

import type { CudyrBatchUpdate, CudyrScore, CudyrScorePatch } from '@/types/domain/cudyr';
import type { CMAData } from '@/types/domain/movements';
import type { PatientFieldValue } from '@/types/valueTypes';
import type { PatientMovementActions } from '@/types/movements';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type {
  DailyRecordStaffingDetailsV1,
  DetailedStaffingRole,
  DetailedStaffingShift,
} from '@/types/domain/dailyRecordStaffingDetails';
import type { ConfirmedBedOccupantIdentity } from '@/types/domain/intentionalBedClear';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'local' | 'error';

export interface InventoryStats {
  occupiedCount: number;
  blockedCount: number;
  availableCount: number;
  occupancyRate: number;
  occupiedBeds: string[];
  freeBeds: string[];
  blockedBeds: string[];
  isFull: boolean;
}

export interface UseDailyRecordSyncResult {
  record: DailyRecord | null;
  setRecord: (
    record: DailyRecord | null | ((prev: DailyRecord | null) => DailyRecord | null)
  ) => void;
  syncStatus: SyncStatus;
  hasSaveException?: boolean;
  lastSyncTime: Date | null;
  bootstrapPhase: DailyRecordBootstrapPhase;
  saveAndUpdate: PersistDailyRecord;
  patchRecord: ApplyDailyRecordPatch;
  markLocalChange: () => void;
  refresh: () => void;
}

export interface DailyRecordDataContextType {
  record: DailyRecord | null;
  syncStatus: SyncStatus;
  hasSaveException?: boolean;
  lastSyncTime: Date | null;
  bootstrapPhase: DailyRecordBootstrapPhase;
  inventory: InventoryStats;
  stabilityRules: StabilityRules;
}

export interface DailyRecordDayActions {
  createDay: (sourceDate: string) => Promise<boolean>;
  resetDay: () => Promise<void>;
  refresh: () => void;
}

export interface DailyRecordBedActions {
  updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
  updatePatientMultiple: (
    bedId: string,
    fields: Partial<PatientData>
  ) => void | Promise<boolean | void>;
  updateClinicalCrib: (
    bedId: string,
    field: keyof PatientData | 'create' | 'remove',
    value?: PatientFieldValue,
    confirmedLastUpdated?: string,
    confirmedOccupant?: ConfirmedBedOccupantIdentity
  ) => void | Promise<boolean>;
  updateClinicalCribMultiple: (
    bedId: string,
    fields: Partial<PatientData>
  ) => void | Promise<boolean | void>;
  updateClinicalCribCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;
  updateClinicalCribCudyrMultiple?: (bedId: string, fields: CudyrScorePatch) => void;
  updateCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;
  updateCudyrMultiple?: (bedId: string, fields: CudyrScorePatch) => void;
  updateCudyrBatch?: (changes: CudyrBatchUpdate) => Promise<boolean>;
  clearPatient: (
    bedId: string,
    confirmedLastUpdated?: string,
    confirmedOccupant?: ConfirmedBedOccupantIdentity,
    confirmedAssociatedCrib?: ConfirmedBedOccupantIdentity | null
  ) => Promise<boolean>;
  clearAllBeds: () => void;
  moveOrCopyPatient: (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => void;
  toggleBlockBed: (bedId: string, reason?: string) => void;
  updateBlockedReason: (bedId: string, reason: string) => void;
  toggleExtraBed: (bedId: string) => void;
  toggleBedType: (bedId: string) => void;
  copyPatientToDate: (bedId: string, targetDate: string, targetBedId?: string) => Promise<void>;
}

export interface DailyRecordStaffActions {
  updateShiftStaff: (
    role: DetailedStaffingRole,
    shift: DetailedStaffingShift,
    index: number,
    name: string
  ) => void;
  updateDetailedStaffing: (detail: DailyRecordStaffingDetailsV1) => Promise<void> | void;
}

export interface DailyRecordMovementActions extends PatientMovementActions {
  addCMA: (data: Omit<CMAData, 'id' | 'timestamp'>) => void;
  deleteCMA: (id: string) => void;
  updateCMA: (id: string, updates: Partial<CMAData>) => void;
  undoCMA: (item: CMAData) => void;
  convertCmaToHomeDischarge: (id: string) => void;
  convertCmaToTransfer: (id: string) => void;
}

export interface DailyRecordHandoffActions {
  updateHandoffChecklist: (
    shift: 'day' | 'night' | 'shared',
    field: string,
    value: boolean | string
  ) => void;
  updateHandoffNovedades: (shift: 'day' | 'night', value: string) => void;
  updateHandoffReceives: (shift: 'day' | 'night', staffList: string[]) => void;
}

export interface DailyRecordActionsContextType
  extends
    DailyRecordDayActions,
    DailyRecordBedActions,
    DailyRecordStaffActions,
    DailyRecordMovementActions,
    DailyRecordHandoffActions {}

export type DailyRecordContextType = DailyRecordDataContextType & DailyRecordActionsContextType;

import type {
  ApplyDailyRecordPatch,
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type {
  MedicalHandoffActor,
  MedicalSpecialty,
} from '@/application/shared/dailyRecordMedicalContracts';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import type { CudyrBatchUpdate, CudyrScore, CudyrScorePatch } from '@/types/domain/cudyr';
import type { CMAData } from '@/types/domain/movements';
import type { PatientFieldValue } from '@/types/valueTypes';
import type { PatientMovementActions } from '@/types/movements';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type { DailyRecordStaffingDetailsV1 } from '@/types/domain/dailyRecordStaffingDetails';
import type { ConfirmedBedOccupantIdentity } from '@/types/domain/intentionalBedClear';

export type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';

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
  lastSyncTime: Date | null;
  bootstrapPhase: DailyRecordBootstrapPhase;
  saveAndUpdate: PersistDailyRecord;
  patchRecord: ApplyDailyRecordPatch;
  markLocalChange: () => void;
  refresh: () => void;
  createDay: (
    copyFromPrevious: boolean,
    specificDate?: string,
    options?: { forceCopyScheduleOverride?: boolean }
  ) => Promise<void>;
  resetDay: () => Promise<void>;
}

export interface DailyRecordDataContextType {
  record: DailyRecord | null;
  syncStatus: SyncStatus;
  lastSyncTime: Date | null;
  bootstrapPhase: DailyRecordBootstrapPhase;
  inventory: InventoryStats;
  stabilityRules: StabilityRules;
}

export interface DailyRecordDayActions {
  createDay: (
    copyFromPrevious: boolean,
    specificDate?: string,
    options?: { forceCopyScheduleOverride?: boolean }
  ) => void;
  resetDay: () => Promise<void>;
  refresh: () => void;
}

export interface DailyRecordValidationActions {
  validateRecordSchema: (record: DailyRecord) => {
    isValid: boolean;
    errors: import('zod').ZodIssue[];
  };
  canMovePatient: (
    sourceBedId: string,
    targetBedId: string,
    record: DailyRecord | null
  ) => { canMove: boolean; reason?: string };
  canDischargePatient: (patient: PatientData) => boolean;
}

export interface DailyRecordBedActions {
  updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
  updateClinicalCrib: (
    bedId: string,
    field: keyof PatientData | 'create' | 'remove',
    value?: PatientFieldValue,
    confirmedLastUpdated?: string,
    confirmedOccupant?: ConfirmedBedOccupantIdentity
  ) => void | Promise<boolean>;
  updateClinicalCribMultiple: (bedId: string, fields: Partial<PatientData>) => void;
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
  updateNurse: (shift: 'day' | 'night', index: number, name: string) => void;
  updateTens: (shift: 'day' | 'night', index: number, name: string) => void;
  updateDetailedStaffing: (detail: DailyRecordStaffingDetailsV1) => void;
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
  updateHandoffChecklist: (shift: 'day' | 'night', field: string, value: boolean | string) => void;
  updateHandoffNovedades: (shift: 'day' | 'night' | 'medical', value: string) => void;
  updateMedicalSpecialtyNote: (
    specialty: MedicalSpecialty,
    value: string,
    actor: Partial<MedicalHandoffActor>
  ) => Promise<void>;
  confirmMedicalSpecialtyNoChanges: (input: {
    specialty: MedicalSpecialty;
    actor: Partial<MedicalHandoffActor>;
    comment?: string;
    dateKey?: string;
  }) => Promise<void>;
  updateHandoffStaff: (
    shift: 'day' | 'night',
    type: 'delivers' | 'receives' | 'tens',
    staffList: string[]
  ) => void;
  updateMedicalSignature: (doctorName: string, scope?: MedicalHandoffScope) => Promise<void>;
  updateMedicalHandoffDoctor: (doctorName: string) => Promise<void>;
  markMedicalHandoffAsSent: (doctorName?: string, scope?: MedicalHandoffScope) => Promise<void>;
  ensureMedicalHandoffSignatureLink: (
    scope?: MedicalHandoffScope
  ) => Promise<ApplicationOutcome<{ handoffUrl: string } | null>>;
  resetMedicalHandoffState: () => Promise<void>;
  sendMedicalHandoff: (templateContent: string, targetGroupId: string) => Promise<void>;
}

export interface DailyRecordActionsContextType
  extends
    DailyRecordDayActions,
    DailyRecordValidationActions,
    DailyRecordBedActions,
    DailyRecordStaffActions,
    DailyRecordMovementActions,
    DailyRecordHandoffActions {}

export type DailyRecordContextType = DailyRecordDataContextType & DailyRecordActionsContextType;

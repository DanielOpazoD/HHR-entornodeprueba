import type { DailyRecord as RootDailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch as RootDailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { IntentionalBedClearRequest } from '@/types/domain/intentionalBedClear';
import type {
  DailyRecordBackfillRef as RootDailyRecordBackfillRef,
  DailyRecordBedLayoutState as RootDailyRecordBedLayoutState,
  DailyRecordBedsState as RootDailyRecordBedsState,
  DailyRecordCmaState as RootDailyRecordCmaState,
  DailyRecordCriticalValidationState as RootDailyRecordCriticalValidationState,
  DailyRecordCsvExportState as RootDailyRecordCsvExportState,
  DailyRecordCudyrExportState as RootDailyRecordCudyrExportState,
  DailyRecordCudyrState as RootDailyRecordCudyrState,
  DailyRecordDateRef as RootDailyRecordDateRef,
  DailyRecordHandoffPdfState as RootDailyRecordHandoffPdfState,
  DailyRecordMetadataState as RootDailyRecordMetadataState,
  DailyRecordMovementState as RootDailyRecordMovementState,
  DailyRecordPatientHistoryState as RootDailyRecordPatientHistoryState,
  DailyRecordRawExportState as RootDailyRecordRawExportState,
  DailyRecordStaffingState as RootDailyRecordStaffingState,
} from '@/types/domain/dailyRecordSlices';
import type {
  MedicalHandoffActor as RootMedicalHandoffActor,
  MedicalSpecialty as RootMedicalSpecialty,
} from '@/types/domain/dailyRecordMedicalHandoff';
import type {
  DailyRecordStaffingDetailsV1 as RootDailyRecordStaffingDetailsV1,
  DetailedStaffAssignment as RootDetailedStaffAssignment,
  DetailedStaffingRole as RootDetailedStaffingRole,
  DetailedStaffingShift as RootDetailedStaffingShift,
} from '@/types/domain/dailyRecordStaffingDetails';

/**
 * Service-layer daily record contracts.
 *
 * Non-repository services should depend on this entrypoint instead of importing
 * the persistence root contract directly. That keeps service code insulated from
 * future slicing of the `DailyRecord` shape.
 */
export type DailyRecord = RootDailyRecord;
export type DailyRecordPatch = RootDailyRecordPatch;
export type ApplyDailyRecordPatchOptions = {
  consistency?: 'eventual' | 'remote_confirmed';
  intentionalBedClear?: IntentionalBedClearRequest;
};
export type ApplyDailyRecordPatch = (
  patch: DailyRecordPatch,
  options?: ApplyDailyRecordPatchOptions
) => Promise<void>;
export type PersistDailyRecord = (record: DailyRecord) => Promise<void>;
export type MedicalHandoffActor = RootMedicalHandoffActor;
export type MedicalSpecialty = RootMedicalSpecialty;
export type DailyRecordDateRef = RootDailyRecordDateRef;
export type DailyRecordBackfillRef = RootDailyRecordBackfillRef;
export type DailyRecordMetadataState = RootDailyRecordMetadataState;
export type DailyRecordBedsState = RootDailyRecordBedsState;
export type DailyRecordBedLayoutState = RootDailyRecordBedLayoutState;
export type DailyRecordMovementState = RootDailyRecordMovementState;
export type DailyRecordPatientHistoryState = RootDailyRecordPatientHistoryState;
export type DailyRecordStaffingState = RootDailyRecordStaffingState;
export type DailyRecordCriticalValidationState = RootDailyRecordCriticalValidationState;
export type DailyRecordCmaState = RootDailyRecordCmaState;
export type DailyRecordCudyrState = RootDailyRecordCudyrState;
export type DailyRecordCudyrExportState = RootDailyRecordCudyrExportState;
export type DailyRecordCsvExportState = RootDailyRecordCsvExportState;
export type DailyRecordRawExportState = RootDailyRecordRawExportState;
export type DailyRecordHandoffPdfState = RootDailyRecordHandoffPdfState;
export type DailyRecordStaffingDetailsV1 = RootDailyRecordStaffingDetailsV1;
export type DetailedStaffAssignment = RootDetailedStaffAssignment;
export type DetailedStaffingRole = RootDetailedStaffingRole;
export type DetailedStaffingShift = RootDetailedStaffingShift;

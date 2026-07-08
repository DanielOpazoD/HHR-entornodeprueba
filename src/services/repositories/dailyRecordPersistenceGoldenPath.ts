import type { DailyRecord } from '@/types/domain/dailyRecord';
import { resolveDailyRecordReadConsistency } from '@/services/repositories/dailyRecordConsistencyPolicy';
import {
  shouldKeepLocalRecordOverRemote,
  resolvePreferredDailyRecord,
} from '@/services/repositories/dailyRecordSyncCompatibility';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import type { PatientData } from '@/types/domain/patient';
import {
  applyDailyRecordClinicalConsistencyCheck,
  recordClinicalConsistencyTelemetry,
  recordRemoteCanonicalReconciliationTelemetry,
  type DailyRecordClinicalConsistencyPhase,
} from '@/services/repositories/dailyRecordClinicalConsistencyCheck';

export type DailyRecordRemoteAvailability =
  | 'resolved'
  | 'missing'
  | 'unavailable'
  | 'not_requested';

interface ResolveDailyRecordPersistenceGoldenPathInput {
  localRecord: DailyRecord | null;
  remoteRecord: DailyRecord | null;
  remoteAvailability: DailyRecordRemoteAvailability;
  localRepairApplied?: boolean;
  remoteRepairApplied?: boolean;
  clinicalConsistencyPhase?: DailyRecordClinicalConsistencyPhase;
}

export interface DailyRecordPersistenceGoldenPathResult {
  selectedRecord: DailyRecord | null;
  selectedStore: 'local' | 'remote' | 'none';
  shouldHydrateLocal: boolean;
  consistencyState: ReturnType<typeof resolveDailyRecordReadConsistency>['consistencyState'];
  sourceOfTruth: ReturnType<typeof resolveDailyRecordReadConsistency>['sourceOfTruth'];
  retryability: ReturnType<typeof resolveDailyRecordReadConsistency>['retryability'];
  recoveryAction: ReturnType<typeof resolveDailyRecordReadConsistency>['recoveryAction'];
  conflictSummary: ReturnType<typeof resolveDailyRecordReadConsistency>['conflictSummary'];
  observabilityTags: ReturnType<typeof resolveDailyRecordReadConsistency>['observabilityTags'];
  userSafeMessage: ReturnType<typeof resolveDailyRecordReadConsistency>['userSafeMessage'];
  repairApplied: boolean;
}

const PROTECTED_CLINICAL_TEXT_FIELDS = [
  'handoffNote',
  'handoffNoteDayShift',
  'handoffNoteNightShift',
  'medicalHandoffNote',
] as const satisfies ReadonlyArray<keyof PatientData>;

const CLINICAL_TEXT_SHRINKAGE_MIN_LENGTH = 12;
const CLINICAL_TEXT_SHRINKAGE_RATIO_THRESHOLD = 0.75;

const isSuspiciousClinicalTextShrinkage = (localValue: unknown, remoteValue: unknown): boolean => {
  if (typeof localValue !== 'string' || typeof remoteValue !== 'string') return false;
  if (remoteValue.length === 0 || remoteValue.length >= localValue.length) return false;
  if (localValue.length < CLINICAL_TEXT_SHRINKAGE_MIN_LENGTH) return false;
  return remoteValue.length / localValue.length < CLINICAL_TEXT_SHRINKAGE_RATIO_THRESHOLD;
};

const hasPatientClinicalTextShrinkage = (
  localPatient: PatientData | undefined,
  remotePatient: PatientData | undefined
): boolean => {
  if (!localPatient || !remotePatient) return false;

  const hasShrunkenField = PROTECTED_CLINICAL_TEXT_FIELDS.some(field =>
    isSuspiciousClinicalTextShrinkage(localPatient[field], remotePatient[field])
  );

  if (hasShrunkenField) return true;

  return hasPatientClinicalTextShrinkage(localPatient.clinicalCrib, remotePatient.clinicalCrib);
};

export const hasRemoteClinicalTextShrinkage = (
  localRecord: DailyRecord | null,
  remoteRecord: DailyRecord | null
): boolean => {
  if (!localRecord || !remoteRecord) return false;

  return Object.keys(localRecord.beds || {}).some(bedId =>
    hasPatientClinicalTextShrinkage(localRecord.beds[bedId], remoteRecord.beds?.[bedId])
  );
};

export const resolveDailyRecordPersistenceGoldenPath = ({
  localRecord,
  remoteRecord,
  remoteAvailability,
  localRepairApplied = false,
  remoteRepairApplied = false,
  clinicalConsistencyPhase = 'read_publish',
}: ResolveDailyRecordPersistenceGoldenPathInput): DailyRecordPersistenceGoldenPathResult => {
  const shouldProtectLocalClinicalText = hasRemoteClinicalTextShrinkage(localRecord, remoteRecord);
  const candidateRecord =
    remoteAvailability === 'not_requested'
      ? localRecord
      : localRecord && remoteRecord && shouldProtectLocalClinicalText
        ? resolveDailyRecordConflict(remoteRecord, localRecord)
        : localRecord && remoteRecord && shouldKeepLocalRecordOverRemote(localRecord, remoteRecord)
          ? resolveDailyRecordConflict(remoteRecord, localRecord)
          : resolvePreferredDailyRecord(localRecord, remoteRecord);
  const clinicalConsistency = candidateRecord
    ? applyDailyRecordClinicalConsistencyCheck(candidateRecord, {
        date: candidateRecord.date,
        phase: clinicalConsistencyPhase,
      })
    : null;
  if (clinicalConsistency) {
    recordClinicalConsistencyTelemetry(clinicalConsistency);
  }
  const selectedRecord = clinicalConsistency?.record ?? candidateRecord;
  recordRemoteCanonicalReconciliationTelemetry({
    date: selectedRecord?.date || localRecord?.date || remoteRecord?.date || '',
    phase: clinicalConsistencyPhase,
    localRecord,
    remoteRecord,
    selectedRecord,
  });
  const selectedStore = !selectedRecord
    ? 'none'
    : shouldProtectLocalClinicalText
      ? 'local'
      : remoteRecord &&
          (!localRecord || !shouldKeepLocalRecordOverRemote(localRecord, remoteRecord))
        ? 'remote'
        : 'local';
  const repairApplied =
    selectedStore === 'remote'
      ? remoteRepairApplied || clinicalConsistency?.status === 'repaired'
      : selectedStore === 'local'
        ? localRepairApplied || clinicalConsistency?.status === 'repaired'
        : false;
  const consistency = resolveDailyRecordReadConsistency({
    localRecord,
    remoteRecord,
    selectedRecord,
    remoteAvailability,
    repairApplied,
  });

  return {
    selectedRecord,
    selectedStore,
    shouldHydrateLocal: consistency.shouldHydrateLocal,
    consistencyState: consistency.consistencyState,
    sourceOfTruth: consistency.sourceOfTruth,
    retryability: consistency.retryability,
    recoveryAction: consistency.recoveryAction,
    conflictSummary: consistency.conflictSummary,
    observabilityTags: consistency.observabilityTags,
    userSafeMessage: consistency.userSafeMessage,
    repairApplied: consistency.repairApplied,
  };
};

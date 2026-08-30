import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import type { ClinicalCribCreateRequest } from '@/types/domain/intentionalBedClear';
import { hasSameValuesAtPaths } from '@/services/repositories/conflictResolutionUtils';
import { prepareFirestorePartialData } from '@/services/storage/firestore/firestoreRecordWritePatchPolicy';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';

interface ManualClinicalCribCreationIntent {
  bedId: string;
  authorityPatch: Record<string, unknown>;
  request: ClinicalCribCreateRequest;
}

interface GuardedDailyRecordPatchPolicy {
  remoteAuthorityPatch: DailyRecordPatch;
  resolveAlreadyAppliedRemoteRecord?: (error: unknown) => Promise<DailyRecord | null>;
  requireConfirmedRecord: boolean;
  requireAtomicCas: boolean;
  remoteAuthorityFirst: boolean;
  clinicalCribCreate?: ClinicalCribCreateRequest;
}

const normalizeIdentityValue = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const hasSamePatientAnchor = (left: PatientData | undefined, right: PatientData | undefined) =>
  Boolean(
    left &&
    right &&
    normalizeIdentityValue(left.clinicalEpisodeId) ===
      normalizeIdentityValue(right.clinicalEpisodeId) &&
    normalizeIdentityValue(left.rut) === normalizeIdentityValue(right.rut) &&
    normalizeIdentityValue(left.patientName) === normalizeIdentityValue(right.patientName) &&
    normalizeIdentityValue(left.firstSeenDate) === normalizeIdentityValue(right.firstSeenDate) &&
    normalizeIdentityValue(left.admissionDate) === normalizeIdentityValue(right.admissionDate) &&
    normalizeIdentityValue(left.admissionTime) === normalizeIdentityValue(right.admissionTime)
  );

const hasSameAuthorityPatch = (
  expectedPatch: Record<string, unknown>,
  remoteRecord: DailyRecord
): boolean => hasSameValuesAtPaths(remoteRecord, expectedPatch);

const getManualClinicalCribCreationIntent = (
  patch: DailyRecordPatch,
  baseRecord: DailyRecord,
  explicitCreate: PartialUpdateDailyRecordOptions['clinicalCribCreate']
): ManualClinicalCribCreationIntent | null => {
  if (!explicitCreate) return null;
  const path = `beds.${explicitCreate.bedId}.clinicalCrib`;
  const value = patch[path];
  if (
    baseRecord.beds[explicitCreate.bedId]?.clinicalCrib ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new ConcurrencyError(
      'La cuna cambió antes de confirmar su creación. Recargue el censo antes de intentarlo nuevamente.'
    );
  }
  return {
    bedId: explicitCreate.bedId,
    request: explicitCreate,
    authorityPatch: prepareFirestorePartialData({
      partialData: patch,
      specialistScopedPatch: false,
      intentionalBedClear: undefined,
      clinicalCribCreate: true,
    }),
  };
};

const isManualClinicalCribCreationAlreadyApplied = (
  intent: ManualClinicalCribCreationIntent,
  baseRecord: DailyRecord,
  remoteRecord: DailyRecord | null
): remoteRecord is DailyRecord => {
  const baseBed = baseRecord.beds[intent.bedId];
  const remoteBed = remoteRecord?.beds[intent.bedId];
  return Boolean(
    remoteRecord &&
    hasSamePatientAnchor(baseBed, remoteBed) &&
    remoteBed?.clinicalCrib &&
    hasSameAuthorityPatch(intent.authorityPatch, remoteRecord)
  );
};

const isIntentionalClearAlreadyApplied = (
  options: PartialUpdateDailyRecordOptions,
  patch: DailyRecordPatch,
  record: DailyRecord | null
): record is DailyRecord => {
  const intent = options.intentionalBedClear;
  if (!intent || !record) return false;
  const remoteBed = record.beds[intent.bedId];
  if (intent.target === 'clinicalCrib') return !remoteBed?.clinicalCrib;
  return Boolean(remoteBed && !remoteBed.clinicalCrib && hasSameValuesAtPaths(record, patch));
};

export const buildGuardedDailyRecordPatchPolicy = ({
  patch,
  mergedPatches,
  baseRecord,
  options,
  readRemoteRecord,
}: {
  patch: DailyRecordPatch;
  mergedPatches: DailyRecordPatch;
  baseRecord: DailyRecord;
  options: PartialUpdateDailyRecordOptions;
  readRemoteRecord: () => Promise<DailyRecord | null>;
}): GuardedDailyRecordPatchPolicy => {
  const manualClinicalCribCreation = getManualClinicalCribCreationIntent(
    patch,
    baseRecord,
    options.clinicalCribCreate
  );
  const guardedCommand = Boolean(options.intentionalBedClear || manualClinicalCribCreation);
  const resolveAlreadyAppliedRemoteRecord = guardedCommand
    ? async (error: unknown): Promise<DailyRecord | null> => {
        const isAmbiguousRemoteOutcome = classifySyncError(error).category === 'network';
        if (!(error instanceof ConcurrencyError) && !isAmbiguousRemoteOutcome) return null;

        const remoteRecord = await readRemoteRecord();
        if (options.intentionalBedClear) {
          return isIntentionalClearAlreadyApplied(options, patch, remoteRecord)
            ? remoteRecord
            : null;
        }
        return manualClinicalCribCreation &&
          isManualClinicalCribCreationAlreadyApplied(
            manualClinicalCribCreation,
            baseRecord,
            remoteRecord
          )
          ? remoteRecord
          : null;
      }
    : undefined;

  return {
    // Destructive or exact create commands must not inherit unrelated persistence-repair fields.
    remoteAuthorityPatch: manualClinicalCribCreation
      ? (manualClinicalCribCreation.authorityPatch as DailyRecordPatch)
      : options.intentionalBedClear
        ? patch
        : mergedPatches,
    resolveAlreadyAppliedRemoteRecord,
    requireConfirmedRecord: options.requireConfirmedRecord || guardedCommand,
    requireAtomicCas: Boolean(manualClinicalCribCreation),
    clinicalCribCreate: manualClinicalCribCreation?.request,
    remoteAuthorityFirst: Boolean(
      options.rayenClinicalWriteGuard ||
      options.requireRemoteAuthorityFirst ||
      options.intentionalBedClear ||
      manualClinicalCribCreation
    ),
  };
};

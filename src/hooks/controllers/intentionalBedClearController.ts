import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';
import { hasSameValuesAtPaths } from '@/services/repositories/conflictResolutionUtils';
import type {
  ConfirmedBedOccupantIdentity,
  IntentionalBedClearRequest,
} from '@/types/domain/intentionalBedClear';
import type { PatientData } from '@/types/domain/patient';

const normalizeIdentityValue = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

export const buildConfirmedBedOccupantIdentity = (
  patient: PatientData
): ConfirmedBedOccupantIdentity => ({
  clinicalEpisodeId: patient.clinicalEpisodeId,
  rut: patient.rut,
  patientName: patient.patientName,
  firstSeenDate: patient.firstSeenDate,
  admissionDate: patient.admissionDate,
  admissionTime: patient.admissionTime,
});

export const buildConfirmedAssociatedCribIdentity = (
  patient: PatientData
): ConfirmedBedOccupantIdentity => {
  const identity = buildConfirmedBedOccupantIdentity(patient);
  if (
    normalizeIdentityValue(identity.clinicalEpisodeId) ||
    normalizeIdentityValue(identity.rut) ||
    normalizeIdentityValue(identity.patientName)
  ) {
    return identity;
  }
  return { presenceOnly: true };
};

const hasSameOptionalAdmissionTime = (
  confirmed: ConfirmedBedOccupantIdentity,
  candidate: PatientData
): boolean => {
  const confirmedTime = normalizeIdentityValue(confirmed.admissionTime);
  const candidateTime = normalizeIdentityValue(candidate.admissionTime);
  return !confirmedTime && !candidateTime ? true : confirmedTime === candidateTime;
};

const isSameConfirmedOccupant = (
  intent: IntentionalBedClearRequest,
  candidateRecord: DailyRecord,
  candidate: PatientData | undefined
): boolean => {
  if (!candidate) return false;
  const confirmed = intent.confirmedOccupant;
  const isExactConfirmedVersion =
    toRecordTimestamp(intent.confirmedLastUpdated) ===
    toRecordTimestamp(candidateRecord.lastUpdated);
  if (confirmed.presenceOnly) {
    return Boolean(
      isExactConfirmedVersion &&
      !normalizeIdentityValue(candidate.clinicalEpisodeId) &&
      !normalizeIdentityValue(candidate.rut) &&
      !normalizeIdentityValue(candidate.patientName)
    );
  }
  const confirmedEpisodeId = normalizeIdentityValue(confirmed.clinicalEpisodeId);
  const candidateEpisodeId = normalizeIdentityValue(candidate.clinicalEpisodeId);
  if (confirmedEpisodeId || candidateEpisodeId) {
    return Boolean(
      confirmedEpisodeId && candidateEpisodeId && confirmedEpisodeId === candidateEpisodeId
    );
  }

  const confirmedRut = normalizeIdentityValue(confirmed.rut);
  const candidateRut = normalizeIdentityValue(candidate.rut);
  const confirmedAnchor = normalizeIdentityValue(
    confirmed.firstSeenDate || confirmed.admissionDate
  );
  const candidateAnchor = normalizeIdentityValue(
    candidate.firstSeenDate || candidate.admissionDate
  );
  if (confirmedRut || candidateRut) {
    if (!confirmedRut || !candidateRut || confirmedRut !== candidateRut) return false;
    if (!confirmedAnchor || !candidateAnchor) return isExactConfirmedVersion;
    return (
      confirmedAnchor === candidateAnchor && hasSameOptionalAdmissionTime(confirmed, candidate)
    );
  }

  const confirmedName = normalizeIdentityValue(confirmed.patientName);
  const candidateName = normalizeIdentityValue(candidate.patientName);
  if (!confirmedName || confirmedName !== candidateName) return false;
  if (confirmedAnchor || candidateAnchor) {
    return Boolean(
      confirmedAnchor &&
      confirmedAnchor === candidateAnchor &&
      hasSameOptionalAdmissionTime(confirmed, candidate)
    );
  }

  return isExactConfirmedVersion;
};

const hasSameConfirmedAssociatedCrib = (
  intent: IntentionalBedClearRequest,
  candidateRecord: DailyRecord
): boolean => {
  if (intent.target === 'clinicalCrib') return true;

  const candidateCrib = candidateRecord.beds[intent.bedId]?.clinicalCrib;
  const confirmedCrib = intent.confirmedAssociatedCrib;
  if (confirmedCrib === undefined || confirmedCrib === null) {
    return !candidateCrib;
  }

  return isSameConfirmedOccupant(
    { ...intent, confirmedOccupant: confirmedCrib },
    candidateRecord,
    candidateCrib
  );
};

export const canRebaseIntentionalBedClear = (
  intent: IntentionalBedClearRequest,
  candidate: DailyRecord | null | undefined
): candidate is DailyRecord =>
  Boolean(
    candidate &&
    isSameConfirmedOccupant(
      intent,
      candidate,
      intent.target === 'clinicalCrib'
        ? candidate.beds[intent.bedId]?.clinicalCrib
        : candidate.beds[intent.bedId]
    ) &&
    hasSameConfirmedAssociatedCrib(intent, candidate)
  );

/** The remote command may already have committed even if its response was lost locally. */
export const isIntentionalBedClearAlreadyApplied = (
  intent: IntentionalBedClearRequest,
  candidate: DailyRecord | null | undefined,
  expectedPatch: DailyRecordPatch
): candidate is DailyRecord => {
  if (!candidate) return false;
  const candidateBed = candidate.beds[intent.bedId];
  if (intent.target === 'clinicalCrib') return !candidateBed?.clinicalCrib;
  return Boolean(
    candidateBed && !candidateBed.clinicalCrib && hasSameValuesAtPaths(candidate, expectedPatch)
  );
};

export const rebaseIntentionalBedClear = (
  intent: IntentionalBedClearRequest,
  candidate: DailyRecord
): IntentionalBedClearRequest => ({
  ...intent,
  confirmedLastUpdated: candidate.lastUpdated,
});

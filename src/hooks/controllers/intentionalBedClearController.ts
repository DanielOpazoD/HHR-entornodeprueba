import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';
import type {
  ConfirmedBedOccupantIdentity,
  IntentionalBedClearRequest,
} from '@/types/domain/intentionalBedClear';
import type { PatientData } from '@/types/domain/patient';

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

const normalizeIdentityValue = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

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
  const confirmedEpisodeId = normalizeIdentityValue(confirmed.clinicalEpisodeId);
  const candidateEpisodeId = normalizeIdentityValue(candidate.clinicalEpisodeId);
  const isExactConfirmedVersion =
    toRecordTimestamp(intent.confirmedLastUpdated) ===
    toRecordTimestamp(candidateRecord.lastUpdated);
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
    )
  );

export const rebaseIntentionalBedClear = (
  intent: IntentionalBedClearRequest,
  candidate: DailyRecord
): IntentionalBedClearRequest => ({
  ...intent,
  confirmedLastUpdated: candidate.lastUpdated,
});

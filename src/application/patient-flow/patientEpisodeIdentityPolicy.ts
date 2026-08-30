import type { PatientEpisodeContract } from '@/application/patient-flow/clinicalEpisodeContracts';

const normalizeText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

const normalizeScalar = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const resolveEpisodeAnchor = (patient: PatientEpisodeContract): string =>
  normalizeScalar(patient.firstSeenDate || patient.admissionDate);

const hasIdentity = (patient: PatientEpisodeContract): boolean =>
  Boolean(
    normalizeScalar(patient.clinicalEpisodeId) ||
    normalizeText(patient.rut) ||
    normalizeText(patient.patientName)
  );

const hasSameAdmissionTime = (
  left: PatientEpisodeContract,
  right: PatientEpisodeContract
): boolean => {
  const leftTime = normalizeScalar(left.admissionTime);
  const rightTime = normalizeScalar(right.admissionTime);
  return !leftTime && !rightTime ? true : Boolean(leftTime && leftTime === rightTime);
};

/**
 * Fail-closed identity check for rebasing data that belongs to one occupied bed slot. A persisted
 * episode id is authoritative. Legacy rows may fall back to the patient plus admission anchor,
 * but a name or RUT alone is never enough to carry clinical data across revisions.
 */
export const hasSamePatientEpisodeIdentity = (
  left: PatientEpisodeContract | null | undefined,
  right: PatientEpisodeContract | null | undefined
): boolean => {
  if (!left || !right) return !left && !right;

  const leftHasIdentity = hasIdentity(left);
  const rightHasIdentity = hasIdentity(right);
  if (!leftHasIdentity || !rightHasIdentity) {
    if (leftHasIdentity || rightHasIdentity) return false;
    const leftAnchor = resolveEpisodeAnchor(left);
    const rightAnchor = resolveEpisodeAnchor(right);
    return Boolean(leftAnchor && leftAnchor === rightAnchor && hasSameAdmissionTime(left, right));
  }

  const leftEpisode = normalizeScalar(left.clinicalEpisodeId);
  const rightEpisode = normalizeScalar(right.clinicalEpisodeId);
  if (leftEpisode && rightEpisode) return leftEpisode === rightEpisode;

  const leftAnchor = resolveEpisodeAnchor(left);
  const rightAnchor = resolveEpisodeAnchor(right);
  if (!leftAnchor || leftAnchor !== rightAnchor || !hasSameAdmissionTime(left, right)) return false;

  const leftRut = normalizeText(left.rut);
  const rightRut = normalizeText(right.rut);
  if (leftRut || rightRut) return Boolean(leftRut && leftRut === rightRut);

  const leftName = normalizeText(left.patientName);
  const rightName = normalizeText(right.patientName);
  return Boolean(leftName && leftName === rightName);
};

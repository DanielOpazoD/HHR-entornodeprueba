import type { DailyRecord } from '@/types/domain/dailyRecord';

export const CLINICAL_CENSUS_EDITABLE_FIELDS = [
  'pathology',
  'diagnosisComments',
  'snomedCode',
  'cie10Code',
  'cie10Description',
  'specialty',
  'secondarySpecialty',
  'status',
  'ginecobstetriciaType',
  'deliveryRoute',
  'deliveryDate',
  'deliveryCesareanLabor',
  'isUPC',
  'upcChecklist',
  'surgicalComplication',
] as const;

export const EXPLICIT_LOCAL_CENSUS_PATCH_FIELDS: ReadonlySet<string> = new Set(
  CLINICAL_CENSUS_EDITABLE_FIELDS
);

export const PENDING_LOCAL_CENSUS_PATCH_FIELDS: ReadonlySet<string> = new Set(
  CLINICAL_CENSUS_EDITABLE_FIELDS
);

const normalizeEpisodeScalar = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const isCanonicalEpisodeId = (value: string): boolean => value.startsWith('ep_');

export const isSameEpisodeForExplicitCensusPatch = (
  remotePatient: DailyRecord['beds'][string] | undefined,
  localPatient: DailyRecord['beds'][string] | undefined
): boolean => {
  if (!remotePatient || !localPatient) {
    return false;
  }

  const remoteEpisodeId = normalizeEpisodeScalar(remotePatient.clinicalEpisodeId);
  const localEpisodeId = normalizeEpisodeScalar(localPatient.clinicalEpisodeId);
  if (remoteEpisodeId && localEpisodeId) {
    if (remoteEpisodeId === localEpisodeId) {
      return true;
    }
    if (isCanonicalEpisodeId(remoteEpisodeId) && isCanonicalEpisodeId(localEpisodeId)) {
      return false;
    }
  }
  // During admission/realtime hydration, Firebase may already have the generated
  // episode id while the local optimistic row still only has the legacy tuple or
  // a deterministic legacy_ep_* id. Fall through to the tuple comparison so
  // explicit field edits do not flicker away.

  const remoteRut = normalizeEpisodeScalar(remotePatient.rut);
  const localRut = normalizeEpisodeScalar(localPatient.rut);
  if (remoteRut || localRut) {
    if (!remoteRut || !localRut || remoteRut !== localRut) {
      return false;
    }
    const remoteAnchor = normalizeEpisodeScalar(
      remotePatient.firstSeenDate || remotePatient.admissionDate
    );
    const localAnchor = normalizeEpisodeScalar(
      localPatient.firstSeenDate || localPatient.admissionDate
    );
    if (!remoteAnchor || !localAnchor || remoteAnchor !== localAnchor) {
      return false;
    }
    const remoteTime = normalizeEpisodeScalar(remotePatient.admissionTime);
    const localTime = normalizeEpisodeScalar(localPatient.admissionTime);
    return !remoteTime && !localTime ? true : remoteTime === localTime;
  }

  const remoteName = normalizeEpisodeScalar(remotePatient.patientName);
  const localName = normalizeEpisodeScalar(localPatient.patientName);
  const remoteAnchor = normalizeEpisodeScalar(
    remotePatient.firstSeenDate || remotePatient.admissionDate
  );
  const localAnchor = normalizeEpisodeScalar(
    localPatient.firstSeenDate || localPatient.admissionDate
  );
  return Boolean(
    remoteName &&
    localName &&
    remoteName === localName &&
    remoteAnchor &&
    remoteAnchor === localAnchor
  );
};

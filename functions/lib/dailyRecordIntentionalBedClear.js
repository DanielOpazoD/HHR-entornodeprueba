// An intentional bed or crib clear: the occupant the user confirmed and the canonical empty bed.
const { HttpsError } = require('firebase-functions/v2/https');
const { toMillis } = require('./dailyRecordWriteVersionGuards');
const { isPlainObject, normalizeShortString } = require('./dailyRecordWriteRequest');
const { STRUCTURAL_DAILY_RECORD_PATCH_ROLES } = require('./dailyRecordWritePolicy');

const normalizeEpisodeIdentityScalar = value =>
  String(value || '')
    .trim()
    .toLowerCase();

const sameConfirmedBedEpisode = (confirmed, remote) => {
  if (!isPlainObject(confirmed) || !isPlainObject(remote)) return false;
  if (confirmed.presenceOnly === true) {
    return Boolean(
      !normalizeEpisodeIdentityScalar(remote.clinicalEpisodeId) &&
      !normalizeEpisodeIdentityScalar(remote.rut) &&
      !normalizeEpisodeIdentityScalar(remote.patientName)
    );
  }
  const confirmedEpisodeId = normalizeEpisodeIdentityScalar(confirmed.clinicalEpisodeId);
  const remoteEpisodeId = normalizeEpisodeIdentityScalar(remote.clinicalEpisodeId);
  if (confirmedEpisodeId || remoteEpisodeId) {
    return Boolean(confirmedEpisodeId && remoteEpisodeId && confirmedEpisodeId === remoteEpisodeId);
  }

  const confirmedRut = normalizeEpisodeIdentityScalar(confirmed.rut);
  const remoteRut = normalizeEpisodeIdentityScalar(remote.rut);
  const confirmedAnchor = normalizeEpisodeIdentityScalar(
    confirmed.firstSeenDate || confirmed.admissionDate
  );
  const remoteAnchor = normalizeEpisodeIdentityScalar(remote.firstSeenDate || remote.admissionDate);
  if (confirmedRut || remoteRut) {
    if (!confirmedRut || !remoteRut || confirmedRut !== remoteRut) return false;
    if (!confirmedAnchor || !remoteAnchor) return true;
    if (confirmedAnchor !== remoteAnchor) return false;
    const confirmedTime = normalizeEpisodeIdentityScalar(confirmed.admissionTime);
    const remoteTime = normalizeEpisodeIdentityScalar(remote.admissionTime);
    return !confirmedTime && !remoteTime ? true : confirmedTime === remoteTime;
  }

  const confirmedName = normalizeEpisodeIdentityScalar(confirmed.patientName);
  const remoteName = normalizeEpisodeIdentityScalar(remote.patientName);
  if (!confirmedName || confirmedName !== remoteName) return false;
  if (!confirmedAnchor && !remoteAnchor) return true;
  if (!confirmedAnchor || confirmedAnchor !== remoteAnchor) return false;
  const confirmedTime = normalizeEpisodeIdentityScalar(confirmed.admissionTime);
  const remoteTime = normalizeEpisodeIdentityScalar(remote.admissionTime);
  return !confirmedTime && !remoteTime ? true : confirmedTime === remoteTime;
};

const EMPTY_BED_STRING_FIELDS = new Set([
  'blockedReason',
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'rut',
  'age',
  'birthDate',
  'admissionOriginDetails',
  'pathology',
  'specialty',
  'status',
  'admissionDate',
  'admissionTime',
  'handoffNote',
  'handoffNoteDayShift',
  'handoffNoteNightShift',
  'medicalHandoffNote',
]);
const EMPTY_BED_FALSE_FIELDS = new Set([
  'isBlocked',
  'hasCompanionCrib',
  'isRapanui',
  'surgicalComplication',
  'isUPC',
]);
const EMPTY_BED_TRUE_FIELDS = new Set(['hasWristband']);
const EMPTY_BED_NULL_FIELDS = new Set([
  'clinicalCrib',
  'insurance',
  'admissionOrigin',
  'origin',
  'cie10Code',
  'cie10Description',
  'treatingPhysicianId',
  'treatingPhysicianName',
  'ginecobstetriciaType',
  'secondarySpecialty',
  'medicalHandoffAudit',
  'firstSeenDate',
  'deliveryRoute',
  'deliveryDate',
  'deliveryCesareanLabor',
]);
const EMPTY_BED_ARRAY_FIELDS = new Set(['devices', 'medicalHandoffEntries', 'clinicalEvents']);
const EMPTY_BED_OPTIONAL_EMPTY_STRING_FIELDS = new Set(['clinicalEpisodeId']);
const EMPTY_BED_ALLOWED_FIELDS = new Set([
  'bedId',
  'bedMode',
  'location',
  'identityStatus',
  'documentType',
  'biologicalSex',
  ...EMPTY_BED_STRING_FIELDS,
  ...EMPTY_BED_FALSE_FIELDS,
  ...EMPTY_BED_TRUE_FIELDS,
  ...EMPTY_BED_NULL_FIELDS,
  ...EMPTY_BED_ARRAY_FIELDS,
  ...EMPTY_BED_OPTIONAL_EMPTY_STRING_FIELDS,
]);

const buildCanonicalEmptyBed = ({ bedId, requestedBed, remoteBed }) => {
  if (!isPlainObject(remoteBed)) {
    throw new HttpsError(
      'failed-precondition',
      'Intentional bed clear requires an existing remote bed.'
    );
  }
  const invalidField = Object.keys(requestedBed).find(
    field => !EMPTY_BED_ALLOWED_FIELDS.has(field)
  );
  const invalidEmptyString = [...EMPTY_BED_STRING_FIELDS].find(field => requestedBed[field] !== '');
  const invalidFalse = [...EMPTY_BED_FALSE_FIELDS].find(field => requestedBed[field] !== false);
  const invalidTrue = [...EMPTY_BED_TRUE_FIELDS].find(field => requestedBed[field] !== true);
  const invalidNull = [...EMPTY_BED_NULL_FIELDS].find(
    field => requestedBed[field] !== undefined && requestedBed[field] !== null
  );
  const invalidArray = [...EMPTY_BED_ARRAY_FIELDS].find(
    field => !Array.isArray(requestedBed[field]) || requestedBed[field].length !== 0
  );
  const invalidOptionalEmptyString = [...EMPTY_BED_OPTIONAL_EMPTY_STRING_FIELDS].find(
    field => requestedBed[field] !== undefined && requestedBed[field] !== ''
  );
  const remoteLocation = typeof remoteBed.location === 'string' ? remoteBed.location : null;
  const remoteBedMode =
    remoteBed.bedMode === 'Cama' || remoteBed.bedMode === 'Cuna' ? remoteBed.bedMode : null;
  if (
    invalidField ||
    invalidEmptyString ||
    invalidFalse ||
    invalidTrue ||
    invalidNull ||
    invalidArray ||
    invalidOptionalEmptyString ||
    requestedBed.bedId !== bedId ||
    !remoteBedMode ||
    requestedBed.bedMode !== remoteBedMode ||
    remoteLocation === null ||
    requestedBed.location !== remoteLocation ||
    requestedBed.identityStatus !== 'official' ||
    requestedBed.documentType !== 'RUT' ||
    requestedBed.biologicalSex !== 'Indeterminado'
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Intentional bed clear must use the canonical empty-bed shape.'
    );
  }

  return {
    bedId,
    isBlocked: false,
    blockedReason: '',
    bedMode: remoteBedMode,
    hasCompanionCrib: false,
    clinicalCrib: null,
    patientName: '',
    firstName: '',
    lastName: '',
    secondLastName: '',
    identityStatus: 'official',
    rut: '',
    clinicalEpisodeId: '',
    documentType: 'RUT',
    age: '',
    birthDate: '',
    biologicalSex: 'Indeterminado',
    insurance: null,
    admissionOrigin: null,
    admissionOriginDetails: '',
    origin: null,
    isRapanui: false,
    pathology: '',
    cie10Code: null,
    cie10Description: null,
    treatingPhysicianId: null,
    treatingPhysicianName: null,
    specialty: '',
    ginecobstetriciaType: null,
    secondarySpecialty: null,
    status: '',
    admissionDate: '',
    admissionTime: '',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    location: remoteLocation,
    handoffNote: '',
    handoffNoteDayShift: '',
    handoffNoteNightShift: '',
    medicalHandoffNote: '',
    medicalHandoffAudit: null,
    medicalHandoffEntries: [],
    clinicalEvents: [],
    firstSeenDate: null,
    deliveryRoute: null,
    deliveryDate: null,
    deliveryCesareanLabor: null,
  };
};

const assertIntentionalBedClearRequest = ({
  patch,
  role,
  expectedLastUpdated,
  intentionalBedClear,
  remoteData,
}) => {
  if (!intentionalBedClear) return null;
  if (!STRUCTURAL_DAILY_RECORD_PATCH_ROLES.has(role)) {
    throw new HttpsError(
      'permission-denied',
      'Only an administrator or hospital nurse can clear an occupied bed.'
    );
  }
  if (!normalizeShortString(expectedLastUpdated)) {
    throw new HttpsError(
      'failed-precondition',
      'Intentional bed clear requires an exact census version.'
    );
  }
  if (toMillis(intentionalBedClear.confirmedLastUpdated) !== toMillis(expectedLastUpdated)) {
    throw new HttpsError(
      'aborted',
      'Intentional bed clear no longer matches the census version confirmed by the user.'
    );
  }
  const remoteBed = remoteData?.beds?.[intentionalBedClear.bedId];
  const remoteOccupant =
    intentionalBedClear.target === 'clinicalCrib' ? remoteBed?.clinicalCrib : remoteBed;
  if (
    intentionalBedClear.confirmedOccupant &&
    !sameConfirmedBedEpisode(intentionalBedClear.confirmedOccupant, remoteOccupant)
  ) {
    throw new HttpsError(
      'aborted',
      'Intentional bed clear no longer targets the occupant confirmed by the user.'
    );
  }
  if (intentionalBedClear.target === 'bed') {
    const remoteAssociatedCrib = remoteBed?.clinicalCrib;
    const confirmedAssociatedCrib = intentionalBedClear.confirmedAssociatedCrib;
    if (confirmedAssociatedCrib === undefined && isPlainObject(remoteAssociatedCrib)) {
      throw new HttpsError(
        'failed-precondition',
        'Intentional bed clear requires confirming the associated clinical crib.'
      );
    }
    if (
      confirmedAssociatedCrib?.presenceOnly === true &&
      toMillis(remoteData?.lastUpdated) !== toMillis(intentionalBedClear.confirmedLastUpdated)
    ) {
      throw new HttpsError(
        'aborted',
        'Presence-only clinical crib confirmation requires the exact census version.'
      );
    }
    if (
      (confirmedAssociatedCrib === null && isPlainObject(remoteAssociatedCrib)) ||
      (isPlainObject(confirmedAssociatedCrib) &&
        !sameConfirmedBedEpisode(confirmedAssociatedCrib, remoteAssociatedCrib))
    ) {
      throw new HttpsError(
        'aborted',
        'The associated clinical crib changed after the bed clear was confirmed.'
      );
    }
  }
  const bedPath = `beds.${intentionalBedClear.bedId}`;
  const expectedPath =
    intentionalBedClear.target === 'clinicalCrib' ? `${bedPath}.clinicalCrib` : bedPath;
  const paths = Object.keys(patch);
  const requestedTarget = patch[expectedPath];
  if (
    paths.length !== 1 ||
    paths[0] !== expectedPath ||
    (intentionalBedClear.target === 'clinicalCrib'
      ? requestedTarget !== null && requestedTarget !== undefined
      : !isPlainObject(requestedTarget))
  ) {
    throw new HttpsError(
      'invalid-argument',
      intentionalBedClear.target === 'clinicalCrib'
        ? 'Intentional crib clear must remove exactly one matching clinical crib.'
        : 'Intentional bed clear must replace exactly one matching bed with an empty patient.'
    );
  }
  if (intentionalBedClear.target === 'clinicalCrib') {
    if (!isPlainObject(remoteOccupant)) {
      throw new HttpsError(
        'failed-precondition',
        'Intentional crib clear requires an existing remote clinical crib.'
      );
    }
    return { [expectedPath]: null };
  }
  const canonicalBed = buildCanonicalEmptyBed({
    bedId: intentionalBedClear.bedId,
    requestedBed: requestedTarget,
    remoteBed,
  });
  return { [expectedPath]: canonicalBed };
};

module.exports = { assertIntentionalBedClearRequest };

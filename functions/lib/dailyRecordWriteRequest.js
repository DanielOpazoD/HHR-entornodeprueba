// Validates and normalizes the input of the daily-record authority callables.
const { HttpsError } = require('firebase-functions/v2/https');
const { parseSpecialtyIntent } = require('./specialtyDecisionContract');

const FORBIDDEN_PATCH_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const assertStringField = (value, fieldName) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `Missing required field: ${fieldName}`);
  }

  return value.trim();
};

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeMode = value => (value === 'shadow' ? 'shadow' : 'enforced');

const normalizeOrigin = (value, fallback = 'direct_save') =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;

const normalizeShortString = (value, maxLength = 120) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;

const parseConfirmedBedOccupantIdentity = (
  value,
  fieldName,
  { allowPresenceOnly = false } = {}
) => {
  if (!isPlainObject(value)) {
    throw new HttpsError(
      'invalid-argument',
      `Intentional bed clear requires ${fieldName} to be an occupant identity.`
    );
  }
  const presenceOnly = value.presenceOnly === true;
  if (presenceOnly && !allowPresenceOnly) {
    throw new HttpsError(
      'invalid-argument',
      `Intentional bed clear does not allow presence-only confirmation for ${fieldName}.`
    );
  }
  const confirmedOccupant = {
    ...(presenceOnly ? { presenceOnly: true } : {}),
    clinicalEpisodeId: normalizeShortString(value.clinicalEpisodeId),
    rut: normalizeShortString(value.rut),
    patientName: normalizeShortString(value.patientName),
    firstSeenDate: normalizeShortString(value.firstSeenDate),
    admissionDate: normalizeShortString(value.admissionDate),
    admissionTime: normalizeShortString(value.admissionTime),
  };
  if (
    !confirmedOccupant.clinicalEpisodeId &&
    !confirmedOccupant.rut &&
    !confirmedOccupant.patientName &&
    !presenceOnly
  ) {
    throw new HttpsError(
      'invalid-argument',
      `Intentional bed clear requires ${fieldName} to be non-empty.`
    );
  }
  return confirmedOccupant;
};

const parseIntentionalBedClear = value => {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new HttpsError('invalid-argument', 'Intentional bed clear metadata must be an object.');
  }
  const bedId = assertStringField(value.bedId, 'intentionalBedClear.bedId');
  const target = value.target === 'clinicalCrib' ? 'clinicalCrib' : 'bed';
  if (value.target !== undefined && value.target !== 'bed' && value.target !== 'clinicalCrib') {
    throw new HttpsError('invalid-argument', 'Intentional bed clear contains an invalid target.');
  }
  const confirmedLastUpdated = assertStringField(
    value.confirmedLastUpdated,
    'intentionalBedClear.confirmedLastUpdated'
  );
  const confirmedOccupant =
    value.confirmedOccupant === undefined || value.confirmedOccupant === null
      ? null
      : parseConfirmedBedOccupantIdentity(
          value.confirmedOccupant,
          'intentionalBedClear.confirmedOccupant'
        );
  let confirmedAssociatedCrib;
  if (target === 'bed') {
    confirmedAssociatedCrib =
      value.confirmedAssociatedCrib === undefined || value.confirmedAssociatedCrib === null
        ? value.confirmedAssociatedCrib
        : parseConfirmedBedOccupantIdentity(
            value.confirmedAssociatedCrib,
            'intentionalBedClear.confirmedAssociatedCrib',
            { allowPresenceOnly: true }
          );
  }
  if (bedId.includes('.') || FORBIDDEN_PATCH_PATH_SEGMENTS.has(bedId)) {
    throw new HttpsError('invalid-argument', 'Intentional bed clear contains an invalid bed id.');
  }
  return {
    bedId,
    target,
    confirmedLastUpdated,
    confirmedOccupant,
    ...(target === 'bed' ? { confirmedAssociatedCrib } : {}),
  };
};

const parsePayload = data => {
  const date = assertStringField(data?.date, 'date');
  const record = data?.record;
  if (!isPlainObject(record)) {
    throw new HttpsError('invalid-argument', 'Daily record payload must be an object.');
  }

  if (record.date !== date) {
    throw new HttpsError(
      'invalid-argument',
      'Daily record payload date does not match request date.'
    );
  }

  return {
    date,
    record,
    mode: normalizeMode(data?.mode),
    origin: normalizeOrigin(data?.origin),
    dryRun: data?.dryRun === true,
    syncContract: isPlainObject(data?.syncContract) ? data.syncContract : undefined,
    expectedLastUpdated:
      typeof data?.expectedLastUpdated === 'string' ? data.expectedLastUpdated : undefined,
  };
};

const parsePatchPayload = data => {
  if (data && Object.hasOwn(data, 'rayenClinicalWriteGuard'))
    throw new HttpsError(
      'failed-precondition',
      'Legacy Rayen clinical write guards are no longer supported.'
    );
  const date = assertStringField(data?.date, 'date');
  const patch = data?.patch;
  const syncContract = isPlainObject(data?.syncContract) ? data.syncContract : undefined;
  if (!isPlainObject(patch) || Object.keys(patch).length === 0) {
    throw new HttpsError(
      'invalid-argument',
      'Daily record patch payload must be a non-empty object.'
    );
  }

  return {
    date,
    patch,
    mode: normalizeMode(data?.mode),
    origin: normalizeOrigin(data?.origin, 'direct_partial_update'),
    dryRun: data?.dryRun === true,
    syncContract,
    specialtyIntent: parseSpecialtyIntent(data?.specialtyIntent),
    intentionalBedClear: parseIntentionalBedClear(data?.intentionalBedClear),
    historyPolicy: data?.historyPolicy === 'skip' ? 'skip' : 'snapshot',
    expectedLastUpdated:
      typeof data?.expectedLastUpdated === 'string'
        ? data.expectedLastUpdated
        : typeof syncContract?.expectedVersion === 'string'
          ? syncContract.expectedVersion
          : undefined,
  };
};

module.exports = {
  FORBIDDEN_PATCH_PATH_SEGMENTS,
  isPlainObject,
  normalizeShortString,
  parsePatchPayload,
  parsePayload,
};

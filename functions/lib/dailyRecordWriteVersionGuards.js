const functions = require('firebase-functions/v1');

const resolveCurrentRevision = record => {
  const revision = Number(record?.meta?.revision);
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
};

const resolveBaseRevision = syncContract => {
  const value = syncContract?.baseRevision;
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim())))
    return undefined;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined;
};

const assertExpectedRevision = ({ snapshot, syncContract }) => {
  const baseRevision = resolveBaseRevision(syncContract);
  if (baseRevision === undefined || !snapshot.exists) {
    return;
  }

  const currentRevision = resolveCurrentRevision(snapshot.data());
  if (currentRevision !== baseRevision) {
    throw new functions.https.HttpsError(
      'aborted',
      `revision_mismatch: Daily record base revision ${baseRevision} does not match remote revision ${currentRevision}.`
    );
  }
};

const toMillis = value => {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

const toIsoTimestamp = value => {
  if (!value) return undefined;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Number.isFinite(value.seconds)) {
    return new Date(
      value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6)
    ).toISOString();
  }
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
};

const assertExpectedVersion = ({ snapshot, expectedLastUpdated }) => {
  if (!expectedLastUpdated || !snapshot.exists) {
    return;
  }

  const remoteLastUpdated = snapshot.data()?.lastUpdated;
  if (!remoteLastUpdated) {
    return;
  }

  const remoteMillis = toMillis(remoteLastUpdated);
  const expectedMillis = toMillis(expectedLastUpdated);
  if (remoteMillis > expectedMillis) {
    throw new functions.https.HttpsError(
      'aborted',
      'Daily record changed remotely before the authorized write transaction.'
    );
  }
};

// A local projection's clock is not a remote base. Known mutation ACKs run before this guard.
const assertVerifiableWriteBase = ({ snapshot, syncContract, expectedLastUpdated }) => {
  if (!snapshot.exists || resolveBaseRevision(syncContract) !== undefined) return;
  const remoteVersion = toIsoTimestamp(snapshot.data()?.lastUpdated);
  const expectedVersion = toIsoTimestamp(expectedLastUpdated);
  if (!remoteVersion || !expectedVersion) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'base_required: An existing daily record requires a verifiable base version.'
    );
  }
  if (remoteVersion !== expectedVersion) {
    throw new functions.https.HttpsError(
      'aborted',
      'version_mismatch: Daily record changed from the supplied base version.'
    );
  }
};

const assertExactExpectedVersion = ({ snapshot, expectedLastUpdated }) => {
  if (!snapshot.exists || !expectedLastUpdated) {
    throw new functions.https.HttpsError(
      'aborted',
      'Rayen clinical guarded writes require an exact remote version.'
    );
  }
  if (toMillis(snapshot.data()?.lastUpdated) !== toMillis(expectedLastUpdated)) {
    throw new functions.https.HttpsError(
      'aborted',
      'Daily record changed before the guarded Rayen clinical write.'
    );
  }
};

module.exports = {
  resolveCurrentRevision,
  assertExpectedRevision,
  toMillis,
  toIsoTimestamp,
  assertExpectedVersion,
  assertVerifiableWriteBase,
  assertExactExpectedVersion,
};

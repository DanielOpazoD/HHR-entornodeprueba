const functions = require('firebase-functions/v1');
const { isDeepStrictEqual } = require('node:util');
const { captureKey } = require('./cudyrCaptureContract');

/** Read before any writes. A transaction serializes sibling parts under one immutable manifest. */
const prepareCaptureManifest = async (transaction, hospital, hospitalId, payload, ids) => {
  if (!payload.capture) return () => {};
  const { part, ...manifest } = payload.capture;
  const ref = hospital
    .collection('cudyrCaptureManifests')
    .doc(captureKey(hospitalId, payload.authorityDate, { ...payload.capture, part: 0 }));
  const snapshot = await transaction.get(ref);
  const existing = snapshot.exists ? snapshot.data() : null;
  if (existing && !isDeepStrictEqual(existing.manifest, manifest))
    throw new functions.https.HttpsError('already-exists', 'Conflicting CUDYR capture manifest.');
  const parts = existing?.parts || {};
  if (parts[part] && !isDeepStrictEqual(parts[part], ids))
    throw new functions.https.HttpsError('already-exists', 'Conflicting CUDYR capture part.');
  const otherIds = new Set(
    Object.entries(parts)
      .filter(([index]) => Number(index) !== part)
      .flatMap(([, values]) => values)
  );
  if (ids.some(id => otherIds.has(id)))
    throw new functions.https.HttpsError(
      'already-exists',
      'Observation already belongs to another capture part.'
    );
  return () => {
    if (parts[part]) return;
    const value = { manifest, censusDate: payload.authorityDate, parts: { ...parts, [part]: ids } };
    if (existing) transaction.update(ref, value);
    else transaction.create(ref, value);
  };
};
module.exports = { prepareCaptureManifest };

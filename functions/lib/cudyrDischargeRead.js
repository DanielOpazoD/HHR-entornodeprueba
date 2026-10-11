const { FieldPath } = require('firebase-admin/firestore');
const { dischargeKey, text, invalid } = require('./cudyrDischargeContract');

const readDischargeCorrections = async (hospital, data) => {
  if (
    data.hospitalId !== undefined ||
    !Array.isArray(data.clinicalEpisodeIds) ||
    data.clinicalEpisodeIds.length < 1 ||
    data.clinicalEpisodeIds.length > 30
  )
    invalid();
  const ids = data.clinicalEpisodeIds.map(id => text(id));
  if (new Set(ids).size !== ids.length) invalid();
  const snapshots = await Promise.all(
    ids.map(id => hospital.collection('cudyrDischargeCorrections').doc(dischargeKey(id)).get())
  );
  return {
    corrections: snapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data()),
  };
};
const readDischargeAudit = async (hospital, data) => {
  if (data.hospitalId !== undefined) invalid();
  const id = text(data.clinicalEpisodeId);
  const limit = data.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid();
  let query = hospital
    .collection('cudyrDischargeAudit')
    .where('clinicalEpisodeId', '==', id)
    .orderBy(FieldPath.documentId());
  if (data.cursor !== undefined) {
    if (typeof data.cursor !== 'string' || !/^[a-f0-9]{64}$/.test(data.cursor)) invalid();
    query = query.startAfter(data.cursor);
  }
  const snapshot = await query.limit(limit + 1).get();
  const entries = snapshot.docs.slice(0, limit).map(doc => {
    const { request: _request, correction: _correction, ...entry } = doc.data();
    return entry;
  });
  return { entries, nextCursor: snapshot.size > limit ? entries.at(-1).id : null };
};
module.exports = { readDischargeCorrections, readDischargeAudit };

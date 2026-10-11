const functions = require('firebase-functions/v1');
const { FieldPath } = require('firebase-admin/firestore');
const invalid = () => {
  throw new functions.https.HttpsError('invalid-argument', 'Invalid CUDYR placement evidence.');
};

/** Preserve source strings, including unknown/sentinel dates; projection validates their meaning. */
const parseSourcePlacements = (value, clinicalEpisodeId) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) invalid();
  return value.map(item => {
    if (
      !item ||
      item.clinicalEpisodeId !== clinicalEpisodeId ||
      typeof item.currentAssignment !== 'boolean' ||
      typeof item.isDeleted !== 'boolean' ||
      !['hospitalizacion', 'cuna', 'cma', 'desconocida'].includes(item.modality)
    )
      invalid();
    const result = {
      clinicalEpisodeId,
      currentAssignment: item.currentAssignment,
      isDeleted: item.isDeleted,
      modality: item.modality,
    };
    for (const field of [
      'sourceMappingId',
      'sourceBedId',
      'sourceBedLabel',
      'sourceDepartmentId',
      'sourceDepartmentLabel',
      'sourceVersion',
      'sourceStartAt',
      'sourceEndAt',
      'bedId',
    ]) {
      if (typeof item[field] !== 'string' || item[field].length > 300) invalid();
      result[field] = item[field];
    }
    return result;
  });
};

/** Patient-episode bounded history lets a later observed movement explain an earlier report day. */
const readEpisodeCaptures = async (captures, data) => {
  const ids = data.clinicalEpisodeIds;
  const limit = data.limit ?? 100;
  if (
    data.hospitalId !== undefined ||
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 30 ||
    new Set(ids).size !== ids.length ||
    ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 120) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    invalid();
  let query = captures
    .where('capture.clinicalEpisodeId', 'in', ids)
    .orderBy(FieldPath.documentId());
  if (data.cursor) {
    if (typeof data.cursor.id !== 'string' || !/^[a-f0-9]{64}$/.test(data.cursor.id)) invalid();
    query = query.startAfter(data.cursor.id);
  }
  const snapshot = await query.limit(limit + 1).get();
  const page = snapshot.docs.slice(0, limit).map(doc => doc.data());
  const last = page.at(-1);
  return {
    captures: page,
    nextCursor: snapshot.size > limit && last ? { date: last.censusDate, id: last.id } : null,
  };
};
module.exports = { parseSourcePlacements, readEpisodeCaptures };

const functions = require('firebase-functions/v1');
const { parseSupplementImport, digest, monthValue, invalid } = require('./cudyrSupplementContract');
const { FieldPath } = require('firebase-admin/firestore');

/** Documentary archive only; this module has no references to censuses or clinical evaluations. */
const saveCudyrSupplement = async ({ hospital, data, actor, runTransaction }) => {
  const input = parseSupplementImport(data);
  const versionRef = hospital.collection('cudyrMonthlySupplements').doc(input.versionId);
  const fileRef = hospital.collection('cudyrSupplementFiles').doc(input.fileHash);
  const receiptRef = hospital
    .collection('cudyrSupplementImports')
    .doc(digest([actor.uid, input.operationId]));
  return runTransaction(async transaction => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data().requestHash !== input.requestHash)
        throw new functions.https.HttpsError(
          'already-exists',
          'Import operation has different content.'
        );
      return receipt.data().result;
    }
    const version = await transaction.get(versionRef);
    const file = await transaction.get(fileRef);
    const importedAt = new Date().toISOString();
    if (!version.exists)
      transaction.create(versionRef, {
        schemaVersion: 1,
        id: input.versionId,
        contentId: input.contentId,
        month: input.report.month,
        report: input.report,
        importedAt,
        importedBy: actor,
        verification: 'user_imported',
        file: { name: input.fileName, sha256: input.fileHash, byteLength: input.byteLength },
      });
    if (!file.exists)
      transaction.create(fileRef, {
        schemaVersion: 1,
        base64: input.base64,
        sha256: input.fileHash,
        byteLength: input.byteLength,
      });
    const result = {
      success: true,
      persisted: true,
      id: input.versionId,
      contentId: input.contentId,
      status: version.exists ? 'already-recorded' : 'recorded',
    };
    transaction.create(receiptRef, {
      schemaVersion: 1,
      requestHash: input.requestHash,
      importedAt,
      importedBy: actor,
      fileName: input.fileName,
      fileHash: input.fileHash,
      result,
    });
    return result;
  });
};

const readCudyrSupplements = async (hospital, data) => {
  if (data.hospitalId !== undefined) invalid();
  const month = monthValue(data.month);
  const limit = data.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) invalid();
  let query = hospital
    .collection('cudyrMonthlySupplements')
    .where('month', '==', month)
    .orderBy(FieldPath.documentId());
  if (data.cursor !== undefined) {
    if (typeof data.cursor !== 'string' || !/^[a-f0-9]{64}$/.test(data.cursor)) invalid();
    query = query.startAfter(data.cursor);
  }
  const snapshot = await query.limit(limit + 1).get();
  const reports = snapshot.docs.slice(0, limit).map(doc => doc.data());
  return { reports, nextCursor: snapshot.size > limit ? reports.at(-1).id : null };
};
module.exports = { saveCudyrSupplement, readCudyrSupplements };

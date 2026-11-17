const { monthValue } = require('./cudyrSupplementContract');
const {
  databaseName,
  digest,
  documentFields,
  matchesRestoreBinding,
  sourceDocuments,
  versionsForDocuments,
} = require('./cudyrOfficialReportStore');

// Operational restoration only. There is deliberately no callable or client writer.
/** Compares every dependency field in memory. It never rewrites the official artifact. */
const attestOfficialRestore = async ({ sourceHospital, restoredHospital, month }) => {
  const source = sourceHospital.firestore;
  const restored = restoredHospital.firestore;
  if (
    source.projectId !== 'hhr-pruebas' ||
    restored.projectId !== source.projectId ||
    source.databaseId !== '(default)' ||
    !/^migration-restore-\d{8}-[a-f0-9]{8}$/.test(restored.databaseId) ||
    sourceHospital.path !== 'hospitals/hanga_roa' ||
    restoredHospital.path !== sourceHospital.path
  )
    throw new Error('restore_destination_not_allowed');
  monthValue(month);
  const collection = 'cudyrOfficialReports';
  const proof = await source.runTransaction(
    async tx => {
      const artifact = await tx.get(sourceHospital.collection(collection).doc(month));
      const snapshot = artifact.data();
      if (
        !snapshot ||
        snapshot.policyVersion !== 2 ||
        !Array.isArray(snapshot.episodes) ||
        snapshot.episodes.length > 500 ||
        snapshot.episodes.some(id => typeof id !== 'string' || id.length > 120)
      )
        throw new Error('restore_source_not_official');
      const docs = await sourceDocuments(sourceHospital, month, snapshot.episodes, tx, true);
      const versions = versionsForDocuments(sourceHospital, docs);
      if (snapshot.sourceVersion !== versions.current && snapshot.sourceVersion !== versions.legacy)
        throw new Error('restore_source_not_official');
      return {
        snapshot,
        artifactHash: digest(documentFields(artifact)),
        contentHash: digest(
          docs
            .map(doc => [doc.ref.path, doc.exists, documentFields(doc)])
            .sort((a, b) => a[0].localeCompare(b[0]))
        ),
      };
    },
    { readOnly: true }
  );
  return restored.runTransaction(
    async tx => {
      const ref = restoredHospital.collection(collection).doc(month);
      const artifact = await tx.get(ref);
      const snapshot = artifact.data();
      if (!snapshot || digest(documentFields(artifact)) !== proof.artifactHash)
        throw new Error('restore_artifact_mismatch');
      const docs = await sourceDocuments(restoredHospital, month, snapshot.episodes, tx, true);
      const contentHash = digest(
        docs
          .map(doc => [doc.ref.path, doc.exists, documentFields(doc)])
          .sort((a, b) => a[0].localeCompare(b[0]))
      );
      if (contentHash !== proof.contentHash) throw new Error('restore_sources_mismatch');
      const current = versionsForDocuments(restoredHospital, docs).current;
      const bindingRef = ref.collection('restorations').doc(current);
      const existing = await tx.get(bindingRef);
      if (existing.exists) {
        if (
          !matchesRestoreBinding(
            existing.data(),
            restoredHospital,
            month,
            snapshot,
            current,
            artifact
          )
        )
          throw new Error('restore_binding_conflict');
      } else {
        tx.create(bindingRef, {
          schemaVersion: 1,
          database: databaseName(restoredHospital),
          hospital: restoredHospital.path,
          month,
          originalSourceVersion: snapshot.sourceVersion,
          restoredSourceVersion: current,
          reportVersion: snapshot.version,
          artifactHash: digest(documentFields(artifact)),
          sourceContentHash: contentHash,
          verifiedAt: new Date().toISOString(),
        });
      }
      return { verified: true, created: !existing.exists, month, reportVersion: snapshot.version };
    },
    { maxAttempts: 1 }
  );
};
module.exports = { attestOfficialRestore };

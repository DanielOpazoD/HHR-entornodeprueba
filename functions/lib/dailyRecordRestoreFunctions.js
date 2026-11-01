const functions = require('firebase-functions/v1');
const { randomUUID } = require('node:crypto');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { requireAuthenticatedEmail } = require('./auth/authPolicies');
const {
  readClinicalDerivedLayout,
  buildClinicalDerivedLayout,
} = require('./clinicalDerivedContract');
const { resolveCurrentRevision } = require('./dailyRecordWriteVersionGuards');
const { summarizeRestoreState } = require('./dailyRecordRestoreSummary');
const {
  TTL_MS,
  fail,
  iso,
  parseRestoreSource,
  createDailyRecordPitrReader,
  readDatabaseMetadata,
  readRestoreBackup,
  validateRestoreState,
} = require('./dailyRecordRestoreSource');

// Refuse large atomic replacements before staging a write. Never split a clinical restore into
// independently committed batches. Includes backups, payload and headroom for index/protobuf bytes.
const assertRestoreSize = writes => {
  if (
    writes.length > 200 ||
    writes.some(({ data }) => Buffer.byteLength(JSON.stringify(data)) > 900_000) ||
    writes.reduce((bytes, { data }) => bytes + Buffer.byteLength(JSON.stringify(data)), 0) >
      4_000_000
  )
    fail(
      'resource-exhausted',
      'El respaldo supera el tamaño seguro de una restauración atómica. Consulte el runbook.'
    );
};

const createDailyRecordRestoreFunctions = ({
  firestore,
  Timestamp,
  resolveRoleForEmail,
  readHistorical = createDailyRecordPitrReader({
    firestore,
    Timestamp,
    readDatabase: () => readDatabaseMetadata(firestore),
  }),
  clock = Date.now,
}) => {
  const callable = handler =>
    functions
      .region('southamerica-east1')
      .runWith({ memory: '1GB', timeoutSeconds: 540 })
      .https.onCall(async (data, context) => {
        const email = requireAuthenticatedEmail(context);
        if ((await resolveRoleForEmail(email, context)) !== 'admin')
          fail('permission-denied', 'Solo un administrador puede restaurar un censo.');
        const source = parseRestoreSource(data, clock());
        const hospital = firestore.collection('hospitals').doc(HOSPITAL_ID);
        const ref = hospital.collection('dailyRecords').doc(source.date);
        try {
          return await handler({ data, context, email, source, hospital, ref });
        } catch (error) {
          if (error instanceof functions.https.HttpsError) throw error;
          // Never return raw SDK exceptions or clinical payloads.
          fail(
            'unavailable',
            'No se pudo completar la operación. Vuelva a consultar el estado antes de continuar.'
          );
        }
      });
  const selectedState = async (ref, source) =>
    validateRestoreState(
      source.backupId
        ? await readRestoreBackup(firestore, ref, source.backupId, clock())
        : await readHistorical(ref, source.readTime),
      source.date
    );
  const currentState = async (transaction, ref, date) => {
    const day = await transaction.get(ref);
    if (!day.exists) fail('not-found', 'El censo actual no existe. No se puede reemplazar.');
    const episodes = await transaction.get(ref.collection('clinicalDerived'));
    return validateRestoreState(
      { record: day.data(), docs: episodes.docs.map(doc => ({ id: doc.id, data: doc.data() })) },
      date,
      { requireCoherentEpisodes: false }
    );
  };
  return {
    previewDailyRecordRestore: callable(async ({ source, ref }) => {
      const selected = await selectedState(ref, source);
      const current = await firestore.runTransaction(tx => currentState(tx, ref, source.date), {
        readOnly: true,
      });
      return {
        ...source,
        current: summarizeRestoreState(current),
        selected: summarizeRestoreState(selected),
      };
    }),
    restoreDailyRecord: callable(async ({ data, context, email, source, hospital, ref }) => {
      if (data.confirmationDate !== source.date)
        fail('invalid-argument', 'Escriba la fecha exacta del censo para confirmar.');
      if (typeof data.expectedLastUpdated !== 'string' || !iso(data.expectedLastUpdated))
        fail('invalid-argument', 'Falta la versión actual que se mostró en la comparación.');
      const selected = await selectedState(ref, source);
      const backupId = `restore_${randomUUID()}`;
      const snapshots = ref.collection('conflictSnapshots');
      const auditRef = hospital.collection('auditLogs').doc();
      return firestore.runTransaction(async transaction => {
        const current = await currentState(transaction, ref, source.date);
        if (iso(current.record.lastUpdated) !== data.expectedLastUpdated)
          fail('aborted', 'El censo cambió desde la comparación. Consulte y revise nuevamente.');
        const timestamp = Timestamp.fromMillis(
          Math.max(clock(), Date.parse(iso(current.record.lastUpdated)) + 1)
        );
        const expireAt = Timestamp.fromMillis(timestamp.toMillis() + TTL_MS);
        const revision = resolveCurrentRevision(current.record) + 1;
        const next = {
          ...selected.record,
          lastUpdated: timestamp,
          meta: {
            ...current.record.meta,
            revision,
            updatedAt: timestamp,
            lastMutationId: backupId,
            lastMutationDigest: null,
            lastWriterClientId: null,
            lastWriterTabId: null,
            lastChangedPaths: ['*'],
          },
        };
        const layout = readClinicalDerivedLayout(selected.record);
        const generation = randomUUID();
        if (layout.status === 'marked')
          next.clinicalDerivedLayout = buildClinicalDerivedLayout(generation);
        const episodeBackupIds = current.docs.map((_, index) => `${backupId}_ep_${index}`);
        const writes = [
          {
            ref: snapshots.doc(backupId),
            data: {
              snapshotType: 'daily_restore_day',
              origin: 'remote_premerge',
              conflictId: backupId,
              snapshotTimestamp: timestamp,
              expireAt,
              sourceLastUpdated: current.record.lastUpdated,
              sourceRevision: resolveCurrentRevision(current.record),
              record: current.record,
              episodeBackupIds,
            },
          },
          ...current.docs.map(({ id, data: document }, index) => ({
            ref: snapshots.doc(episodeBackupIds[index]),
            data: {
              snapshotType: 'daily_restore_episode',
              backupId,
              episodeId: id,
              document,
              snapshotTimestamp: timestamp,
              expireAt,
            },
          })),
          ...selected.docs.map(({ id, data: document }) => ({
            ref: ref.collection('clinicalDerived').doc(id),
            data:
              layout.status === 'marked' &&
              document.layoutGeneration === layout.layout.generation &&
              document.date === source.date
                ? { ...document, layoutGeneration: generation, dayRevision: revision }
                : document,
          })),
          { ref, data: next },
          {
            ref: auditRef,
            data: {
              id: auditRef.id,
              timestamp: timestamp.toDate().toISOString(),
              userId: email,
              userDisplayName: email,
              userUid: context.auth.uid,
              action: 'CONFLICT_VERSION_RESTORED',
              entityType: 'dailyRecord',
              entityId: source.date,
              recordDate: source.date,
              summary: 'Censo completo restaurado por administrador',
              details: {
                event: 'daily_record_restored',
                source,
                backupId,
                revision,
                current: summarizeRestoreState(current),
                selected: summarizeRestoreState(selected),
              },
            },
          },
        ];
        assertRestoreSize(writes);
        // All reads and validation have completed. A backup/audit failure aborts the entire commit.
        writes.forEach(write => transaction.set(write.ref, write.data));
        return {
          success: true,
          date: source.date,
          lastUpdated: timestamp.toDate().toISOString(),
          revision,
          backupId,
          backupExpiresAt: expireAt.toDate().toISOString(),
        };
      });
    }),
  };
};
module.exports = { createDailyRecordRestoreFunctions, assertRestoreSize };

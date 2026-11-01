const { https } = require('firebase-functions/v1');
const {
  readClinicalDerivedLayout,
  findStaleClinicalDerivedEpisodeIds,
  collectClinicalDerivedEpisodes,
} = require('./clinicalDerivedContract');

const TTL_MS = 48 * 60 * 60 * 1000;
const fail = (code, message) => {
  throw new https.HttpsError(code, message);
};
const iso = value => {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const parseRestoreSource = (data, now) => {
  const date = data?.date;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).getUTCDate() !== Number(date.substring(8))
  )
    fail('invalid-argument', 'La fecha del censo debe ser una fecha válida AAAA-MM-DD.');
  if (data.backupId !== undefined) {
    if (
      data.readTime !== undefined ||
      typeof data.backupId !== 'string' ||
      !/^restore_[A-Za-z0-9_-]{1,120}$/.test(data.backupId)
    )
      fail('invalid-argument', 'Seleccione un momento o una copia previa válida.');
    return { date, backupId: data.backupId };
  }
  const readTime = data?.readTime;
  if (
    typeof readTime !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(readTime) ||
    !iso(readTime)
  )
    fail('invalid-argument', 'El momento debe ser un minuto completo en UTC.');
  if (iso(readTime) !== readTime.replace(/(?:\.000)?Z$/, '.000Z'))
    fail('invalid-argument', 'El momento no corresponde a una fecha válida.');
  const millis = Date.parse(readTime);
  if (millis > now || millis < now - 7 * 24 * 60 * 60 * 1000)
    fail('out-of-range', 'El momento está en el futuro o fuera de los siete días de recuperación.');
  return { date, readTime: iso(readTime) };
};

// The only PITR-dependent port. Never substitutes a failed read with an empty day.
const createDailyRecordPitrReader =
  ({ firestore, Timestamp, readDatabase }) =>
  async (ref, readTime) => {
    const database = await readDatabase();
    const earliest = iso(database.earliestVersionTime);
    if (
      database.pointInTimeRecoveryEnablement !== 'POINT_IN_TIME_RECOVERY_ENABLED' ||
      !earliest ||
      Date.parse(readTime) < Date.parse(earliest)
    )
      fail('out-of-range', 'Ese momento no está disponible en la ventana real de recuperación.');
    return firestore.runTransaction(
      async transaction => {
        const day = await transaction.get(ref);
        if (!day.exists) fail('not-found', 'El censo no existía en ese momento.');
        const episodes = await transaction.get(ref.collection('clinicalDerived'));
        return {
          record: day.data(),
          docs: episodes.docs.map(doc => ({ id: doc.id, data: doc.data() })),
        };
      },
      { readOnly: true, readTime: Timestamp.fromDate(new Date(readTime)) }
    );
  };

const readDatabaseMetadata = async firestore => {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/datastore'],
  });
  const client = google.firestore({ version: 'v1', auth });
  const response = await client.projects.databases.get({
    name: `projects/${firestore.projectId}/databases/${firestore.databaseId}`,
  });
  return response.data;
};

const readRestoreBackup = async (firestore, ref, backupId, now) =>
  firestore.runTransaction(
    async transaction => {
      const backup = await transaction.get(ref.collection('conflictSnapshots').doc(backupId));
      const data = backup.data();
      if (
        !backup.exists ||
        data?.snapshotType !== 'daily_restore_day' ||
        !iso(data.expireAt) ||
        Date.parse(iso(data.expireAt)) <= now
      )
        fail('not-found', 'La copia previa no está disponible o ya venció.');
      const docs = [];
      for (const id of data.episodeBackupIds) {
        const piece = await transaction.get(ref.collection('conflictSnapshots').doc(id));
        const value = piece.data();
        if (
          !piece.exists ||
          value?.snapshotType !== 'daily_restore_episode' ||
          value.backupId !== backupId ||
          !value.document
        )
          fail('failed-precondition', 'La copia previa está incompleta. No se restauró.');
        docs.push({ id: value.episodeId, data: value.document });
      }
      return { record: data.record, docs };
    },
    { readOnly: true }
  );

const validateRestoreState = (state, date, { requireCoherentEpisodes = true } = {}) => {
  if (
    !state?.record ||
    state.record.date !== date ||
    !state.record.beds ||
    !Array.isArray(state.record.discharges) ||
    !Array.isArray(state.record.transfers) ||
    !Array.isArray(state.record.cma) ||
    !iso(state.record.lastUpdated) ||
    readClinicalDerivedLayout(state.record).status === 'unsupported'
  )
    fail('failed-precondition', 'El censo no tiene una estructura o versión restaurable.');
  if (!requireCoherentEpisodes) return state;
  const layout = readClinicalDerivedLayout(state.record);
  if (
    findStaleClinicalDerivedEpisodeIds(
      state.record,
      state.docs.map(doc => doc.data)
    ).length ||
    collectClinicalDerivedEpisodes(state.record).duplicateEpisodeIds.length ||
    state.docs.some(
      ({ id, data }) =>
        layout.status === 'marked' &&
        data.layoutGeneration === layout.layout.generation &&
        (data.date !== date || data.clinicalEpisodeId !== id || data.schemaVersion !== 1)
    )
  )
    fail(
      'failed-precondition',
      'Los documentos por episodio no corresponden a una versión coherente del día.'
    );
  return state;
};
module.exports = {
  TTL_MS,
  fail,
  iso,
  parseRestoreSource,
  createDailyRecordPitrReader,
  readDatabaseMetadata,
  readRestoreBackup,
  validateRestoreState,
};

const { createHash, timingSafeEqual } = require('node:crypto');
const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { resolveClinicalDayForDateTime } = require('./generated/cudyrSourceParser.cjs');
const { createPatchHandler } = require('./dailyRecordPatchCallable');
const { hospitalDateTimeParts } = require('./hospitalCalendarDay');

const DEMO_PROJECT = 'demo-hhr-handoff';
const DAY = 'handoffNoteDayShift';
const NIGHT = 'handoffNoteNightShift';
const MAX_BATCH = 50;
const digest = value => createHash('sha256').update(value).digest('hex');
const validLocalKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const loopbackEmulator = host => /^127\.0\.0\.1:\d+$/.test(host ?? '');
const positiveId = value => typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
const fail = (code, message, details) => {
  throw new functions.https.HttpsError(code, message, details);
};

function clinicalSlot(now) {
  const { date: calendarDate, time, hour } = hospitalDateTimeParts(now);
  const date = resolveClinicalDayForDateTime(calendarDate, time);
  return { date, shift: date === calendarDate && hour < 20 ? 'day' : 'night' };
}

const normalizeDocumentCode = value =>
  String(value ?? '')
    .replace(/[.\s-]/g, '')
    .toUpperCase();

function findHandoff(snapshot, record, episode, code, slot, census) {
  if (!snapshot.exists) fail('not-found', 'Falta este día en el ' + census + '.', slot);
  const matches = [];
  for (const [bed, patient] of Object.entries(record.beds ?? {})) {
    for (const [path, item] of [
      [`beds.${bed}`, patient],
      [`beds.${bed}.clinicalCrib`, patient?.clinicalCrib],
    ]) {
      if (String(item?.clinicalEpisodeId ?? '') === episode) matches.push({ path, item });
    }
  }
  const match = matches[0];
  if (!match) return fail('not-found', 'Este episodio aún no está en el ' + census + '.', slot);
  const { path, item } = match;
  const type = item.documentType || 'RUT';
  // The confirmed census episode determines the kind, including numeric passports.
  const validDocument = type === 'Pasaporte' || (type === 'RUT' && /^\d{6,9}[\dK]$/.test(code));
  if (
    matches.length !== 1 ||
    !validDocument ||
    normalizeDocumentCode(item.rut) !== code ||
    item.isBlocked === true
  ) {
    fail(
      'failed-precondition',
      'El ' + census + ' encontró el episodio y falta confirmar la identidad del paciente.'
    );
  }
  return {
    path,
    day: item[DAY] ?? item.handoffNote ?? '',
    night: item[NIGHT] ?? item.handoffNote ?? '',
    dayValue: item[DAY],
    nightValue: item[NIGHT],
  };
}

const versionOf = (entry, shift) =>
  digest(JSON.stringify(shift === 'day' ? [entry.day, entry.night] : [entry.night]));
const viewOf = (entry, date, shift) => ({
  date,
  shift,
  text: entry[shift],
  version: versionOf(entry, shift),
});

function documentForVisit(visit) {
  const { episode, patientRun } = visit ?? {};
  // The existing wire field carries the original identifier for both RUN and passport.
  const code = normalizeDocumentCode(patientRun);
  if (!positiveId(episode) || !/^[\p{L}0-9]{2,64}$/u.test(code)) {
    fail('invalid-argument', 'Se necesita el RUN o pasaporte propio y un episodio verificado.');
  }
  return code;
}

function viewWithComparison(entry, date, shift) {
  const comparisonShift = shift === 'day' ? 'night' : 'day';
  return {
    ...viewOf(entry, date, shift),
    comparison: { shift: comparisonShift, text: entry[comparisonShift] },
  };
}

function batchViews(snapshot, visits, slot, census) {
  const record = snapshot.data();
  return visits.map(visit => {
    try {
      const code = documentForVisit(visit);
      const entry = findHandoff(snapshot, record, visit.episode, code, slot, census);
      return viewWithComparison(entry, slot.date, slot.shift);
    } catch (error) {
      if (!(error instanceof functions.https.HttpsError)) throw error;
      return {
        error: error.message,
        code: error.toJSON().status,
        ...(error.details ? { slot: error.details } : {}),
      };
    }
  });
}

function waitForNote(ref, initial, select, version, shift) {
  if (versionOf(initial, shift) !== version) return Promise.resolve(initial);
  return new Promise((resolve, reject) => {
    let last = initial;
    let unsubscribe;
    const end = (error, value) => {
      clearTimeout(timer);
      unsubscribe?.();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => end(null, last), 15_000);
    unsubscribe = ref.onSnapshot(
      snapshot => {
        try {
          last = select(snapshot);
          if (versionOf(last, shift) !== version) end(null, last);
        } catch (error) {
          end(error);
        }
      },
      error => end(error)
    );
  });
}

// The loopback pilot installation is the trust boundary. It verifies the native
// session before forwarding its identity, without forwarding Rayen credentials.
function localActor(source, expectedKey) {
  if (
    !validLocalKey(expectedKey) ||
    !validLocalKey(source?.installationKey) ||
    !timingSafeEqual(Buffer.from(source.installationKey, 'hex'), Buffer.from(expectedKey, 'hex'))
  ) {
    fail('unauthenticated', 'Abre la entrega desde la extensión del piloto local.');
  }
  const { facilityId, practitionerId, roleId } = source;
  if (![facilityId, practitionerId, roleId].every(positiveId)) {
    fail('permission-denied', 'Eloísa no confirmó el profesional y el establecimiento.');
  }
  const uid = `eloisa-${facilityId}-${practitionerId}-${roleId}`;
  return { auth: { uid, token: { email: uid + '@example.test' } } };
}

/**
 * @param {{
 *   firestore: any,
 *   Timestamp: any,
 *   FieldValue: any,
 *   installationKey?: string,
 *   clinicalNow?: () => Date,
 *   authorize?: (data: any) => any,
 *   resolveRoleForEmail?: (email: any, context?: any) => any,
 *   assertWriteAccess?: (actor: any, transaction: any) => Promise<void>,
 *   origin?: string,
 *   census?: string,
 * }} deps
 */
function createHandler({
  firestore,
  Timestamp,
  FieldValue,
  installationKey,
  clinicalNow = () => new Date(),
  authorize = data => localActor(data.source, installationKey ?? process.env.HHR_HANDOFF_LOCAL_KEY),
  resolveRoleForEmail = () => 'nurse_hospital',
  assertWriteAccess,
  origin = 'eloisa_nursing_handoff',
  census = 'censo local de pruebas',
}) {
  const records = firestore.collection('hospitals').doc(HOSPITAL_ID).collection('dailyRecords');
  const write = createPatchHandler({
    firestore,
    Timestamp,
    FieldValue,
    resolveRoleForEmail,
    async assertPatchBase(snapshot, data, transaction, actor) {
      await assertWriteAccess?.(actor, transaction);
      const slot = clinicalSlot(clinicalNow());
      if (slot.date !== data.date || slot.shift !== data.shift) {
        fail('failed-precondition', 'Cambió el turno. Abre otra entrega.');
      }
      if (!snapshot.updateTime.isEqual(data.snapshotVersion)) {
        fail('aborted', 'Cambió el censo mientras se guardaba. Vuelve a intentar.');
      }
    },
  });

  return async data => {
    const action = data?.action;
    if (
      action !== 'read' &&
      action !== 'save' &&
      action !== 'read-batch' &&
      action !== 'save-batch'
    ) {
      fail('invalid-argument', 'La operación de entrega de turno no es válida.');
    }
    const actor = await authorize(data);
    const slot = clinicalSlot(clinicalNow());
    if (action === 'read-batch') {
      const { patients } = data;
      if (!Array.isArray(patients) || patients.length === 0 || patients.length > MAX_BATCH) {
        fail('invalid-argument', 'La consulta requiere entre 1 y 50 episodios.');
      }
      const snapshot = await records.doc(slot.date).get();
      if (!snapshot.exists) fail('not-found', 'Falta este día en el ' + census + '.', slot);
      const active = clinicalSlot(clinicalNow());
      if (active.date !== slot.date || active.shift !== slot.shift) {
        fail('failed-precondition', 'Cambió el turno o la fecha censal. Abre otra entrega.');
      }
      return { slot, results: batchViews(snapshot, patients, slot, census) };
    }
    // Keep each open editor pinned, including after a shift or census-day rollover.
    const date = data.date ?? slot.date;
    const shift = data.shift ?? slot.shift;
    if (date !== slot.date || shift !== slot.shift) {
      fail('failed-precondition', 'Cambió el turno o la fecha censal. Abre otra entrega.');
    }
    const ref = records.doc(date);
    if (action === 'read') {
      const code = documentForVisit(data);
      const select = snapshot =>
        findHandoff(snapshot, snapshot.data(), data.episode, code, slot, census);
      const current = select(await ref.get());
      const entry = data.since
        ? await waitForNote(ref, current, select, data.since, shift)
        : current;
      const active = clinicalSlot(clinicalNow());
      if (active.date !== date || active.shift !== shift)
        fail('failed-precondition', 'Cambió el turno o la fecha censal. Abre otra entrega.');
      if (data.since) await authorize(data);
      return data.comparison === true
        ? viewWithComparison(entry, date, shift)
        : viewOf(entry, date, shift);
    }

    if (data.date !== date || data.shift !== shift) {
      fail('invalid-argument', 'La edición debe indicar su fecha y turno.');
    }
    const batch = action === 'save-batch';
    const visits = batch ? data.patients : [data];
    if (
      !Array.isArray(visits) ||
      !visits.length ||
      visits.length > 10 ||
      new Set(visits.map(visit => visit?.episode)).size !== visits.length
    ) {
      fail('invalid-argument', 'Cada bloque admite de 1 a 10 episodios distintos.');
    }
    const snapshot = await ref.get();
    const record = snapshot.data();
    const patch = {};
    const selectVisit = (snap, value, visit) =>
      findHandoff(snap, value, visit.episode, documentForVisit(visit), slot, census);
    const matchesText = (entry, text) =>
      entry.nightValue === text && (shift === 'night' || entry.dayValue === text);
    const rejected = error => {
      if (!batch || !(error instanceof functions.https.HttpsError)) throw error;
      return { error: error.message, code: error.toJSON().status };
    };
    const results = visits.map(visit => {
      try {
        if (
          typeof visit?.text !== 'string' ||
          visit.text.length > 16000 ||
          !/^[a-f0-9]{64}$/.test(visit.version ?? '')
        ) {
          fail('invalid-argument', 'La edición debe indicar la versión leída y el texto.');
        }
        const entry = selectVisit(snapshot, record, visit);
        if (!matchesText(entry, visit.text)) {
          if (visit.version !== versionOf(entry, shift)) {
            fail(
              'aborted',
              'La entrega cambió en HHR. Revisa la nota actual antes de guardar tu edición.'
            );
          }
          patch[entry.path + '.' + NIGHT] = visit.text;
          if (shift === 'day') patch[entry.path + '.' + DAY] = visit.text;
        }
        return null;
      } catch (error) {
        return rejected(error);
      }
    });
    let confirmed = snapshot;
    const paths = Object.keys(patch);
    if (paths.length) {
      const response = await write(
        {
          date,
          shift,
          patch,
          snapshotVersion: snapshot.updateTime,
          expectedLastUpdated: record.lastUpdated?.toDate?.().toISOString() ?? record.lastUpdated,
          syncContract: {
            clientId: actor.auth.uid,
            changedPaths: paths,
            ...(Number.isInteger(record.meta?.revision)
              ? { baseRevision: record.meta.revision }
              : {}),
          },
          origin,
        },
        actor
      );
      if (!response.success) fail('failed-precondition', 'HHR rechazó el guardado.');
      confirmed = await ref.get();
    }
    const savedRecord = confirmed.data();
    const receipts = results.map((result, index) => {
      if (result) return result;
      try {
        const visit = visits[index];
        const saved = selectVisit(confirmed, savedRecord, visit);
        if (!matchesText(saved, visit.text)) {
          fail('aborted', 'El guardado no coincide con la versión actual de HHR.');
        }
        return { ...viewOf(saved, date, shift), confirmed: true };
      } catch (error) {
        return rejected(error);
      }
    });
    return batch
      ? {
          results: receipts.map((receipt, index) => ({
            ...receipt,
            episode: visits[index]?.episode ?? null,
          })),
        }
      : receipts[0];
  };
}

function createNursingHandoffDemoFunctions(deps) {
  const enabled =
    process.env.FUNCTIONS_EMULATOR === 'true' &&
    process.env.GCLOUD_PROJECT === DEMO_PROJECT &&
    loopbackEmulator(process.env.FIRESTORE_EMULATOR_HOST) &&
    loopbackEmulator(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  return enabled
    ? {
        nursingHandoffExtension: functions
          .region('southamerica-east1')
          .https.onCall(createHandler(deps)),
      }
    : {};
}

module.exports = { createNursingHandoffDemoFunctions, clinicalSlot, createHandler };

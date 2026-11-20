const { createHash, timingSafeEqual } = require('node:crypto');
const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { resolveClinicalDayForDateTime } = require('./generated/cudyrSourceParser.cjs');
const { createPatchHandler } = require('./dailyRecordPatchCallable');

const DEMO_PROJECT = 'demo-hhr-handoff';
const DAY = 'handoffNoteDayShift';
const NIGHT = 'handoffNoteNightShift';
const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Easter',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const digest = value => createHash('sha256').update(value).digest('hex');
const validLocalKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const loopbackEmulator = host => /^127\.0\.0\.1:\d+$/.test(host ?? '');
const positiveId = value => typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
const fail = (code, message, details) => {
  throw new functions.https.HttpsError(code, message, details);
};

function clinicalSlot(now) {
  const parts = Object.fromEntries(
    clock.formatToParts(now).map(({ type, value }) => [type, value])
  );
  const calendarDate = `${parts.year}-${parts.month}-${parts.day}`;
  const date = resolveClinicalDayForDateTime(calendarDate, `${parts.hour}:${parts.minute}`);
  return { date, shift: date === calendarDate && Number(parts.hour) < 20 ? 'day' : 'night' };
}

const normalizeRun = value =>
  String(value ?? '')
    .replace(/[.\s-]/g, '')
    .toUpperCase();

function findHandoff(snapshot, episode, run, slot) {
  if (!snapshot.exists) fail('not-found', 'Falta este día en el censo local de pruebas.', slot);
  const record = snapshot.data();
  const matches = [];
  for (const [bed, patient] of Object.entries(record.beds ?? {})) {
    for (const [path, item] of [
      [`beds.${bed}`, patient],
      [`beds.${bed}.clinicalCrib`, patient?.clinicalCrib],
    ]) {
      if (String(item?.clinicalEpisodeId ?? '') === episode) matches.push({ path, item });
    }
  }
  if (!matches.length)
    fail('not-found', 'Este episodio aún no está en el censo local de pruebas.', slot);
  if (
    matches.length !== 1 ||
    normalizeRun(matches[0].item.rut) !== run ||
    matches[0].item.documentType === 'Pasaporte' ||
    matches[0].item.isBlocked === true
  ) {
    fail(
      'failed-precondition',
      'HHR Pruebas encontró el episodio, pero no pudo confirmar la identidad del paciente.'
    );
  }
  const { path, item } = matches[0];
  return {
    path,
    day: item[DAY] ?? item.handoffNote ?? '',
    night: item[NIGHT] ?? item.handoffNote ?? '',
    dayValue: item[DAY],
    nightValue: item[NIGHT],
    lastUpdated: record.lastUpdated?.toDate?.().toISOString() ?? record.lastUpdated,
    revision: record.meta?.revision,
    snapshotVersion: snapshot.updateTime,
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

function createHandler({
  firestore,
  Timestamp,
  FieldValue,
  installationKey,
  clinicalNow = () => new Date(),
  authorize = data => localActor(data.source, installationKey ?? process.env.HHR_HANDOFF_LOCAL_KEY),
  resolveRoleForEmail = () => 'nurse_hospital',
  origin = 'eloisa_nursing_handoff',
}) {
  const records = firestore.collection('hospitals').doc(HOSPITAL_ID).collection('dailyRecords');
  const write = createPatchHandler({
    firestore,
    Timestamp,
    FieldValue,
    resolveRoleForEmail,
    assertPatchBase(snapshot, data) {
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
    if (action !== 'read' && action !== 'save') {
      fail('invalid-argument', 'La operación de entrega de turno no es válida.');
    }
    const actor = await authorize(data);

    const { episode, patientRun } = data;
    const run = normalizeRun(patientRun);
    if (!/^[1-9]\d{0,15}$/.test(episode ?? '') || !/^\d{6,9}[\dK]$/.test(run)) {
      fail('invalid-argument', 'Se necesita el RUN propio del paciente y un episodio verificado.');
    }
    const slot = clinicalSlot(clinicalNow());
    // Keep each open editor pinned, including after a shift or census-day rollover.
    const date = data.date ?? slot.date;
    const shift = data.shift ?? slot.shift;
    if (date !== slot.date || shift !== slot.shift) {
      fail('failed-precondition', 'Cambió el turno o la fecha censal. Abre otra entrega.');
    }
    const ref = records.doc(date);
    const select = snapshot => findHandoff(snapshot, episode, run, slot);
    const current = select(await ref.get());

    if (action === 'read') {
      const entry = data.since
        ? await waitForNote(ref, current, select, data.since, shift)
        : current;
      const active = clinicalSlot(clinicalNow());
      if (active.date !== date || active.shift !== shift)
        fail('failed-precondition', 'Cambió el turno o la fecha censal. Abre otra entrega.');
      if (data.since) await authorize(data);
      return viewOf(entry, date, shift);
    }

    if (
      data.date !== date ||
      data.shift !== shift ||
      typeof data.text !== 'string' ||
      data.text.length > 16_000 ||
      !/^[a-f0-9]{64}$/.test(data.version ?? '')
    ) {
      fail('invalid-argument', 'La edición debe indicar la fecha, el turno y la versión leída.');
    }
    const { text } = data;
    const alreadySaved =
      current.nightValue === text && (shift === 'night' || current.dayValue === text);
    if (alreadySaved) return { ...viewOf(current, date, shift), confirmed: true };
    if (data.version !== versionOf(current, shift)) {
      fail(
        'aborted',
        'La entrega cambió en HHR. Revisa la nota actual antes de guardar tu edición.'
      );
    }
    const patch = { [`${current.path}.${NIGHT}`]: text };
    if (shift === 'day') patch[`${current.path}.${DAY}`] = text;
    const response = await write(
      {
        date,
        shift,
        patch,
        snapshotVersion: current.snapshotVersion,
        expectedLastUpdated: current.lastUpdated,
        syncContract: {
          clientId: actor.auth.uid,
          changedPaths: Object.keys(patch),
          ...(Number.isInteger(current.revision) ? { baseRevision: current.revision } : {}),
        },
        origin,
      },
      actor
    );
    if (!response.success) fail('failed-precondition', 'HHR rechazó el guardado.');
    const saved = select(await ref.get());
    if (saved.nightValue !== text || (shift === 'day' && saved.dayValue !== text)) {
      fail('aborted', 'El guardado no coincide con la versión actual de HHR.');
    }
    return { ...viewOf(saved, date, shift), confirmed: true };
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

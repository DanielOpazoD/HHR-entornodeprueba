const { randomBytes, createHash } = require('node:crypto');
const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { resolveClinicalDayForDateTime } = require('./generated/cudyrSourceParser.cjs');
const { createPatchHandler } = require('./dailyRecordPatchCallable');
const { assertAuthorizedDailyRecordWriter } = require('./dailyRecordWritePolicy');

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
const secret = () => randomBytes(24).toString('base64url');
const validSecret = value => typeof value === 'string' && /^[\w-]{32}$/.test(value);
const fail = (code, message) => {
  throw new functions.https.HttpsError(code, message);
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

function findHandoff(snapshot, episode, run) {
  if (!snapshot.exists)
    fail('failed-precondition', 'El censo de esta fecha aún no está disponible en HHR.');
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
  if (
    matches.length !== 1 ||
    normalizeRun(matches[0].item.rut) !== run ||
    matches[0].item.documentType === 'Pasaporte' ||
    matches[0].item.isBlocked === true
  ) {
    fail(
      'failed-precondition',
      'HHR no encontró un único paciente con este RUN y episodio en el censo.'
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

function createHandler({
  auth,
  firestore,
  Timestamp,
  FieldValue,
  resolveRoleForEmail,
  clinicalNow = () => new Date(),
}) {
  const authz = async context => {
    const { role } = await assertAuthorizedDailyRecordWriter({ context, resolveRoleForEmail });
    if (role !== 'nurse_hospital' && role !== 'admin') {
      fail('permission-denied', 'Este permiso corresponde a enfermería de HHR.');
    }
  };
  const grants = firestore.collection('nursingHandoffDemoGrants');
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

  return async (data, context) => {
    const action = data?.action;
    if (action === 'issue') {
      await authz(context);
      const code = secret();
      const { uid, token } = context.auth;
      await grants.doc(digest(code)).create({
        kind: 'code',
        uid,
        token,
        expiry: Date.now() + 5 * 60_000,
      });
      return { code };
    }

    if (action === 'connect') {
      if (!validSecret(data.code)) fail('invalid-argument', 'Revisa el código de HHR.');
      const codeRef = grants.doc(digest(data.code));
      const grant = secret();
      await firestore.runTransaction(async tx => {
        const code = (await tx.get(codeRef)).data();
        if (code?.kind !== 'code' || code.expiry <= Date.now()) {
          fail('unauthenticated', 'El código venció o ya se usó.');
        }
        const expiry = Math.min((code.token.exp || 0) * 1000, Date.now() + 60 * 60_000);
        if (expiry <= Date.now())
          fail('unauthenticated', 'Genera un código desde una sesión vigente de HHR.');
        tx.create(grants.doc(digest(grant)), { ...code, kind: 'grant', expiry });
        tx.delete(codeRef);
      });
      return { grant };
    }

    if (!['read', 'save', 'disconnect'].includes(action) || !validSecret(data?.grant)) {
      fail('unauthenticated', 'Vincula HHR para acceder a la entrega de turno.');
    }
    const grantRef = grants.doc(digest(data.grant));
    const grant = (await grantRef.get()).data();
    if (grant?.kind !== 'grant' || grant.expiry <= Date.now()) {
      fail('unauthenticated', 'La vinculación con HHR venció.');
    }
    if (action === 'disconnect') {
      await grantRef.delete();
      return { disconnected: true };
    }
    const { uid, token } = grant;
    const actor = { auth: { uid, token } };
    const assertCurrentGrant = async () => {
      const user = await auth.getUser(uid).catch(error => {
        if (error.code === 'auth/user-not-found')
          fail('unauthenticated', 'La cuenta de HHR ya no existe.');
        throw error;
      });
      if (
        grant.expiry <= Date.now() ||
        user.disabled ||
        user.email !== token.email ||
        Date.parse(user.tokensValidAfterTime) > token.auth_time * 1000
      ) {
        fail('unauthenticated', 'La sesión de HHR ya no está vigente.');
      }
      await authz(actor);
    };
    await assertCurrentGrant();

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
    const select = snapshot => findHandoff(snapshot, episode, run);
    const current = select(await ref.get());

    if (action === 'read') {
      const entry = data.since
        ? await waitForNote(ref, current, select, data.since, shift)
        : current;
      const active = clinicalSlot(clinicalNow());
      if (active.date !== date || active.shift !== shift)
        fail('failed-precondition', 'Cambió el turno o la fecha censal. Abre otra entrega.');
      if (grant.expiry <= Date.now() || !(await grantRef.get()).exists) {
        fail('unauthenticated', 'La vinculación con HHR venció.');
      }
      if (data.since) await assertCurrentGrant();
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
        ...(Number.isInteger(current.revision)
          ? { syncContract: { baseRevision: current.revision } }
          : {}),
        origin: 'eloisa_nursing_handoff',
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
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) &&
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  return enabled
    ? {
        nursingHandoffExtension: functions
          .region('southamerica-east1')
          .https.onCall(createHandler(deps)),
      }
    : {};
}

module.exports = { createNursingHandoffDemoFunctions, clinicalSlot, createHandler };

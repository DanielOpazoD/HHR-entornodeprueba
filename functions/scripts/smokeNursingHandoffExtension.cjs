const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');

const projectId = 'demo-hhr-handoff';
process.env.GCLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { clinicalSlot, createHandler } = require('../lib/nursingHandoffExtension');
const { createAuthHelpers } = require('../lib/authFunctions');

const endpoint = `http://127.0.0.1:5001/${projectId}/southamerica-east1/nursingHandoffExtension`;
const call = async (data, token) => {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: 'Bearer ' + token }),
    },
    body: JSON.stringify({ data }),
  });
  const body = await res.json();
  return res.ok ? body.result : { status: body.error?.status, message: body.error?.message };
};

async function main() {
  const app = initializeApp({ projectId });
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const email = 'nurse-' + randomUUID() + '@example.test';
  const password = randomUUID();
  const { uid } = await auth.createUser({ email, password });
  const accessRef = firestore.doc('hhr_account_access/' + uid);
  const date = clinicalSlot(new Date()).date;
  const policy = firestore.doc('hospitals/hanga_roa/settings/rayenImportPolicy');
  const day = firestore.doc('hospitals/hanga_roa/dailyRecords/' + date);
  const episode = '901001';
  const patientRun = '11111111-1';
  const patient = {
    clinicalEpisodeId: episode,
    rut: patientRun,
    patientName: 'Paciente sintético',
    documentType: 'RUT',
  };
  const noteDay = 'beds.R1.handoffNoteDayShift';
  const noteNight = 'beds.R1.handoffNoteNightShift';
  const seed = async target => {
    const stamp = target.id;
    await target.create({
      date: stamp,
      dateTimestamp: Date.parse(stamp + 'T00:00:00Z'),
      lastUpdated: Timestamp.now(),
      beds: { R1: patient },
      discharges: [],
      transfers: [],
      cma: [],
    });
  };
  let grant;
  let ownsFixture = false;
  let ownsPolicy = false;
  try {
    await auth.setCustomUserClaims(uid, { hhrAccountVersion: 1 });
    await accessRef.set({ status: 'active', version: 1, role: 'nurse_hospital' });
    const authResponse = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-hhr-handoff',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    assert.ok(authResponse.ok);
    const { idToken } = await authResponse.json();
    assert.equal((await call({ action: 'issue' })).status, 'UNAUTHENTICATED');
    const issued = await call({ action: 'issue' }, idToken);
    assert.ok(issued.code, issued.message);
    const paired = await call({ action: 'connect', code: issued.code });
    grant = paired.grant;
    assert.ok(grant, paired.message);
    assert.equal((await call({ action: 'connect', code: issued.code })).status, 'UNAUTHENTICATED');

    await policy.create({ schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced' });
    ownsPolicy = true;
    await seed(day);
    ownsFixture = true;
    const read = extra => call({ action: 'read', grant, episode, patientRun, ...extra });
    const initial = await read();
    assert.equal(initial.text, '', initial.message);
    assert.equal((await read({ patientRun: '22222222-2' })).status, 'FAILED_PRECONDITION');
    assert.equal((await read({ episode: '901002' })).status, 'FAILED_PRECONDITION');
    const fields = { date, shift: initial.shift };
    const write = (text, version = initial.version) =>
      call({
        action: 'save',
        grant,
        episode,
        patientRun,
        ...fields,
        version,
        text,
      });
    const watch = read({ ...fields, since: initial.version });
    const saved = await write('Nota sintética desde la extensión');
    assert.equal(saved.confirmed, true, JSON.stringify(saved));
    assert.equal((await watch).text, saved.text);
    assert.equal((await day.get()).get(noteNight), saved.text);
    assert.equal((await day.get()).get(noteDay), initial.shift === 'day' ? saved.text : undefined);
    assert.equal((await write(saved.text)).confirmed, true);
    const remote = 'Edición sintética desde HHR';
    await day.update({ [noteNight]: remote, lastUpdated: Timestamp.now() });
    assert.equal((await write('Otra nota', saved.version)).status, 'ABORTED');
    assert.equal((await day.get()).get(noteNight), remote);

    // Exercise both shifts against the real Firestore and patch authority while holding the census date fixed.
    let instant = new Date(date + 'T16:00:00Z');
    const token = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url'));
    const handle = createHandler({
      auth,
      firestore,
      FieldValue,
      Timestamp,
      resolveRoleForEmail: createAuthHelpers({ auth, firestore }).resolveRoleForEmail,
      clinicalNow: () => instant,
    });
    const run = (action, extra = {}) => handle({ action, grant, episode, patientRun, ...extra });
    const dayView = await run('read');
    assert.equal(dayView.shift, 'day');
    await run('save', { ...dayView, text: 'Día confirmado' });
    assert.equal((await day.get()).get(noteNight), 'Día confirmado');
    instant = new Date(Date.parse(date + 'T00:00:00Z') + 27 * 3_600_000);
    await assert.rejects(run('save', { ...dayView, text: 'Día vencido' }), {
      code: 'failed-precondition',
    });
    const nightView = await run('read');
    assert.equal(nightView.date, date);
    assert.equal(nightView.shift, 'night');
    assert.equal(nightView.text, 'Día confirmado');
    await run('save', { ...nightView, text: 'Noche confirmada' });
    const result = (await day.get()).data().beds.R1;
    assert.equal(result.handoffNoteDayShift, 'Día confirmado');
    assert.equal(result.handoffNoteNightShift, 'Noche confirmada');
    if (process.env.HHR_HANDOFF_EXTENSION_CHECKOUT) {
      const browserCode = (await call({ action: 'issue' }, idToken)).code;
      assert.ok(browserCode);
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['scripts/smoke-nursing-handoff-pilot.mjs'],
        {
          cwd: process.env.HHR_HANDOFF_EXTENSION_CHECKOUT,
          env: { ...process.env, HHR_HANDOFF_SMOKE_CODE: browserCode },
          timeout: 90_000,
        }
      ).catch(error => {
        throw new Error('Falló Chromium: ' + error.stderr);
      });
      assert.equal((await day.get()).get(noteNight), 'Cambio sincronizado entre editores');
      console.log(stdout.trim());
    }
    await auth.updateUser(token.sub, { disabled: true });
    assert.equal((await read()).status, 'UNAUTHENTICATED');
    console.log(
      'OK: HTTP emulado, permisos, notificación de cambios, confirmación, conflictos y turnos.'
    );
  } finally {
    if (grant) await call({ action: 'disconnect', grant });
    await accessRef.delete();
    await auth.deleteUser(uid);
    if (ownsPolicy) await policy.delete();
    if (ownsFixture) await firestore.recursiveDelete(day);
    await deleteApp(app);
  }
}

assert.equal(clinicalSlot(new Date('2026-11-19T04:59:00Z')).date, '2026-11-18');
assert.deepEqual(clinicalSlot(new Date('2026-11-19T10:00:00Z')), {
  date: '2026-11-18',
  shift: 'night',
});
assert.deepEqual(clinicalSlot(new Date('2026-11-19T13:00:00Z')), {
  date: '2026-11-19',
  shift: 'day',
});
assert.deepEqual(clinicalSlot(new Date('2026-11-21T13:30:00Z')), {
  date: '2026-11-20',
  shift: 'night',
});
assert.deepEqual(clinicalSlot(new Date('2026-11-21T14:00:00Z')), {
  date: '2026-11-21',
  shift: 'day',
});
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

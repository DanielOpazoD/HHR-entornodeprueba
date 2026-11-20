const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes, randomUUID } = require('node:crypto');
const { resolve } = require('node:path');

const projectId = 'demo-hhr-handoff';
process.env.GCLOUD_PROJECT = projectId;
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { clinicalSlot, createHandler } = require('../lib/nursingHandoffExtension');
const { ACCESS, INDEX, digest } = require('../lib/accounts/accountPolicy');
const { createHostedHandler } = require('../lib/nursingHandoffHosted');
const { createAuthHelpers } = require('../lib/auth/authHelpersFactory');

const port = Number(process.env.HHR_HANDOFF_FUNCTIONS_PORT ?? 5001);
const endpoint = `http://127.0.0.1:${port}/${projectId}/southamerica-east1/nursingHandoffExtension`;
const call = async data => {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await res.json();
  return res.ok
    ? body.result
    : { status: body.error?.status, message: body.error?.message, details: body.error?.details };
};

function waitForBrowserSave(day, notePath) {
  return new Promise((resolve, reject) => {
    const unsubscribe = day.onSnapshot(snapshot => {
      const actor = snapshot.get('meta.lastWriterClientId');
      if (
        snapshot.get(notePath) === 'Verificación local sin código' &&
        /^eloisa-\d+-\d+-\d+$/.test(actor ?? '')
      ) {
        console.log('OK: nota ficticia confirmada con autor de Eloísa registrado.');
      }
    }, reject);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        unsubscribe();
        resolve();
      });
    }
  });
}

async function openSharedCensus(app, firestore) {
  const auth = getAuth(app);
  const rut = '22222222-2';
  const uid = 'hhrn_' + randomUUID();
  const email = uid + '@accounts.hhr.invalid';
  const password = randomBytes(18).toString('base64url');
  await auth.createUser({ uid, email, password, emailVerified: true });
  await auth.setCustomUserClaims(uid, { hhrAccountVersion: 1, role: 'admin' });
  await firestore.collection(ACCESS).doc(uid).set({ status: 'active', role: 'admin', version: 1 });
  await firestore.collection(INDEX).doc(digest(rut)).set({ uid });
  const root = resolve(__dirname, '../..');
  const port = '3016';
  console.log('HHR local: http://127.0.0.1:' + port);
  console.log('Inicio de sesión exclusivo del emulador:', rut, password);
  const web = spawn(
    process.execPath,
    [
      resolve(root, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      port,
      '--strictPort',
    ],
    { cwd: root, stdio: 'inherit' }
  );
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => web.kill());
  return new Promise((resolve, reject) => {
    web.once('error', reject);
    web.once('exit', code =>
      code ? reject(new Error('HHR local terminó con estado ' + code)) : resolve()
    );
  });
}

async function main() {
  for (const host of [
    process.env.FIRESTORE_EMULATOR_HOST,
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
  ]) {
    assert.match(
      host ?? '',
      /^127\.0\.0\.1:\d+$/,
      'Ejecuta la prueba junto a los emuladores locales.'
    );
  }
  const app = initializeApp({ projectId });
  const firestore = getFirestore(app);
  const installationKey = process.env.HHR_HANDOFF_LOCAL_KEY;
  assert.ok(/^[a-f0-9]{64}$/.test(installationKey ?? ''), 'Falta el entorno local del piloto.');
  const source = { installationKey, facilityId: '1', practitionerId: '2', roleId: '3' };
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
  const verifyNovemberRollover = async () => {
    const thursday = day.parent.doc('2026-11-19');
    const friday = day.parent.doc('2026-11-20');
    let instant = new Date('2026-11-20T06:19:00Z'); // 01:19 in Rapa Nui.
    const handler = createHandler({
      firestore,
      FieldValue,
      Timestamp,
      installationKey,
      clinicalNow: () => instant,
    });
    const read = args => handler({ action: 'read', source, episode, patientRun, ...args });
    const night = { date: thursday.id, shift: 'night' };
    await assert.rejects(read(), { code: 'not-found', details: night });
    await seed(thursday);
    try {
      const opened = await read(night);
      assert.deepEqual({ date: opened.date, shift: opened.shift }, night);
      instant = new Date('2026-11-20T12:59:00Z'); // 07:59.
      assert.equal((await read(night)).version, opened.version);
      const text = 'Guardado nocturno del jueves 19';
      const saved = await handler({
        action: 'save',
        source,
        episode,
        patientRun,
        ...night,
        version: opened.version,
        text,
      });
      assert.equal(saved.confirmed, true);
      const record = await thursday.get();
      assert.equal(record.get(noteNight), text);
      assert.equal(record.get(noteDay), undefined);
      instant = new Date('2026-11-20T13:00:00Z'); // 08:00.
      await assert.rejects(read(night), { code: 'failed-precondition' });
      await assert.rejects(read(), {
        code: 'not-found',
        details: { date: friday.id, shift: 'day' },
      });
      assert.equal((await friday.get()).exists, false);
      console.log('OK: 01:19 y 07:59 consultan Noche del 19. A las 08:00 cambia al Día del 20.');
    } finally {
      await firestore.recursiveDelete(thursday);
    }
  };
  let ownsFixture = false;
  let ownsPolicy = false;
  try {
    await policy.create({ schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced' });
    ownsPolicy = true;
    if (process.env.HHR_HANDOFF_SHARED_CENSUS === '1') {
      await openSharedCensus(app, firestore);
      return;
    }
    if (process.env.HHR_HANDOFF_LOCAL_INTERACTIVE !== '1') await verifyNovemberRollover();
    await seed(day);
    ownsFixture = true;
    if (process.env.HHR_HANDOFF_LOCAL_INTERACTIVE === '1') {
      console.log(
        'Paciente ficticio listo. Abre su entrega desde la Ficha de Hospitalizados en Chrome.'
      );
      await waitForBrowserSave(day, noteNight);
      return;
    }
    const read = extra => call({ action: 'read', source, episode, patientRun, ...extra });
    assert.equal((await read({ source: undefined })).status, 'UNAUTHENTICATED');
    const otherKey = randomBytes(32).toString('hex');
    assert.equal(
      (await read({ source: { ...source, installationKey: otherKey } })).status,
      'UNAUTHENTICATED'
    );
    assert.equal(
      (await read({ source: { ...source, practitionerId: '' } })).status,
      'PERMISSION_DENIED'
    );
    const initial = await read();
    assert.equal(initial.text, '', initial.message);
    assert.equal((await read({ patientRun: '22222222-2' })).status, 'FAILED_PRECONDITION');
    assert.deepEqual(await read({ episode: '901002' }), {
      status: 'NOT_FOUND',
      message: 'Este episodio aún no está en el censo local de pruebas.',
      details: { date, shift: initial.shift },
    });
    await day.update({
      'beds.R2': { ...patient, clinicalEpisodeId: '901002', rut: '22222222-2' },
    });
    assert.equal((await read({ episode: '901002', patientRun: '22222222-2' })).text, '');
    assert.equal((await read({ episode: '901002' })).status, 'FAILED_PRECONDITION');
    const fields = { date, shift: initial.shift };
    const write = (text, version = initial.version) =>
      call({
        action: 'save',
        source,
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
    const writes = (await day.get()).get('meta.fieldWrites');
    assert.equal(writes.writes[writes.fields[noteNight].revision].clientId, 'eloisa-1-2-3');
    assert.equal((await day.get()).get(noteDay), initial.shift === 'day' ? saved.text : undefined);
    assert.equal((await write(saved.text)).confirmed, true);
    const remote = 'Edición sintética desde HHR';
    await day.update({ [noteNight]: remote, lastUpdated: Timestamp.now() });
    assert.equal((await write('Otra nota', saved.version)).status, 'ABORTED');
    assert.equal((await day.get()).get(noteNight), remote);

    // Exercise both shifts against the real Firestore and patch authority while holding the census date fixed.
    let instant = new Date(date + 'T16:00:00Z');
    const handle = createHandler({
      firestore,
      FieldValue,
      Timestamp,
      installationKey,
      clinicalNow: () => instant,
    });
    const run = (action, extra = {}) => handle({ action, source, episode, patientRun, ...extra });
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
    {
      const auth = getAuth(app);
      const uid = 'hhrn_' + randomUUID();
      const email = uid + '@accounts.hhr.invalid';
      const access = firestore.collection(ACCESS).doc(uid);
      const deviceId = randomUUID();
      const device = firestore.collection('hhr_nursing_handoff_grants').doc(deviceId);
      const hosted = createHostedHandler({
        firestore,
        auth,
        Timestamp,
        FieldValue,
        resolveRoleForEmail: createAuthHelpers({ auth, firestore }).resolveRoleForEmail,
      });
      const proof = randomBytes(32).toString('hex');
      const connect = { action: 'connect', deviceId, challenge: digest(proof) };
      await auth.createUser({ uid, email });
      try {
        await assert.rejects(hosted(connect, {}), { code: 'unauthenticated' });
        const context = {
          auth: {
            uid,
            token: {
              email,
              auth_time: Math.floor(Date.now() / 1000),
              hhrAccountVersion: 1,
              firebase: { sign_in_provider: 'password' },
            },
          },
        };
        await access.set({ status: 'active', role: 'viewer', version: 1 });
        await assert.rejects(hosted(connect, context), { code: 'permission-denied' });
        await access.update({ role: 'nurse_hospital' });
        const connection = await hosted(connect, context);
        assert.deepEqual(Object.keys(connection), ['expiresAt']);
        assert.equal((await device.get()).data().proofHash, digest(proof));
        const request = { deviceId, episode, patientRun, proof };
        const hostedRead = () => hosted({ ...request, action: 'read' }, {});
        await assert.rejects(hosted({ ...request, action: 'read', proof: '0'.repeat(64) }, {}), {
          code: 'unauthenticated',
        });
        const { date, shift, version } = await hostedRead();
        const answer = await hosted(
          {
            ...request,
            action: 'save',
            date,
            shift,
            version,
            text: 'Entrega de la cuenta HHR',
            source: { practitionerId: '999' },
          },
          {}
        );
        assert.equal(answer.confirmed, true);
        assert.equal((await day.get()).get('meta.lastWriterClientId'), uid);
        await access.update({ status: 'suspended' });
        await assert.rejects(hostedRead(), { code: 'permission-denied' });
        await access.update({ status: 'active' });
        const renewedProof = randomBytes(32).toString('hex');
        await hosted({ ...connect, challenge: digest(renewedProof) }, context);
        await assert.rejects(hostedRead(), { code: 'unauthenticated' });
        await hosted({ deviceId, action: 'disconnect', proof: renewedProof }, {});
        assert.equal((await device.get()).exists, false);
        console.log('OK: autorización HHR, rol vigente, rotación, revocación y autor real.');
      } finally {
        await access.delete();
        await device.delete();
        await auth.deleteUser(uid);
      }
    }
    if (process.env.HHR_HANDOFF_EXTENSION_CHECKOUT) {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['scripts/smoke-nursing-handoff-pilot.mjs'],
        {
          cwd: process.env.HHR_HANDOFF_EXTENSION_CHECKOUT,
          env: process.env,
          timeout: 90_000,
        }
      ).catch(error => {
        throw new Error('Falló Chromium: ' + error.stderr);
      });
      assert.equal((await day.get()).get(noteNight), 'Cambio sincronizado entre editores');
      console.log(stdout.trim());
    }
    console.log(
      'OK: HTTP emulado, permisos, notificación de cambios, confirmación, conflictos y turnos.'
    );
  } finally {
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

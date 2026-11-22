// @vitest-environment node
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  type DocumentReference,
  FieldValue,
  getFirestore,
  Timestamp,
} from 'firebase-admin/firestore';
import { expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { clinicalSlot } = require('../../../functions/lib/nursingHandoffExtension.js');
const { ACCESS, INDEX, digest } = require('../../../functions/lib/accounts/accountPolicy.js');
const {
  createRayenAssertionVerifier,
  createRayenHandoffHandler,
} = require('../../../functions/lib/nursingHandoffRayen.js');
const enabled = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST
);

it.skipIf(!enabled)('guarda la entrega firmada en Firestore con el autor de HHR', async () => {
  for (const address of [
    process.env.FIRESTORE_EMULATOR_HOST,
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
  ]) {
    expect(address).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
  }
  const app = initializeApp({ projectId: 'demo-hhr-nursing-accounts' }, randomUUID());
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = 'https://issuer.example.test';
  const run = '22222222-2';
  const uid = 'hhrn_' + randomUUID();
  const hospital = firestore.collection('hospitals').doc('hanga_roa');
  const instant = Date.now();
  const { date, shift } = clinicalSlot(new Date(instant));
  const day = hospital.collection('dailyRecords').doc(date);
  const policy = hospital.collection('settings').doc('rayenImportPolicy');
  const account = firestore.collection(ACCESS).doc(uid);
  const index = firestore.collection(INDEX).doc(digest(run));
  const episode = '901001';
  const patientRun = '11111111-1';
  const handler = createRayenHandoffHandler({
    firestore,
    auth,
    Timestamp,
    FieldValue,
    now: () => instant,
    verifyAssertion: createRayenAssertionVerifier({ issuer, facilityId: '1', keys: publicKey }),
  });
  const created: DocumentReference[] = [];
  let authUserCreated = false;
  async function create(ref: DocumentReference, data: Record<string, unknown>) {
    await ref.create(data);
    created.push(ref);
  }
  vi.stubEnv('METADATA_SERVER_DETECTION', 'none');
  try {
    await auth.createUser({ uid, email: uid + '@accounts.hhr.invalid' });
    authUserCreated = true;
    await create(policy, { schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced' });
    await create(day, {
      date,
      dateTimestamp: Date.parse(date + 'T00:00:00Z'),
      lastUpdated: Timestamp.now(),
      beds: {
        R1: {
          clinicalEpisodeId: episode,
          rut: patientRun,
          patientName: 'Paciente sintético',
          documentType: 'RUT',
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
    });
    await create(index, { uid });
    await create(account, {
      status: 'active',
      role: 'nurse_hospital',
      hospitalId: 'hanga_roa',
      version: 1,
    });
    const iat = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = [
      encode({ alg: 'RS256', typ: 'hhr-nursing-handoff+jwt', kid: 'synthetic-key' }),
      encode({
        iss: issuer,
        aud: 'urn:hhr-pruebas:nursing-handoff',
        iat,
        exp: iat + 120,
        sub: 'synthetic-rayen-nurse',
        run,
        facilityId: '1',
      }),
    ].join('.');
    const assertion =
      unsigned + '.' + sign('sha256', Buffer.from(unsigned), privateKey).toString('base64url');
    await expect(handler({ action: 'status', run })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(handler({ action: 'status', assertion })).resolves.toEqual({ authorized: true });
    const request = { assertion, episode, patientRun };
    const view = await handler({ ...request, action: 'read' });
    expect(view).toMatchObject({ date, shift });
    const saved = await handler({
      ...request,
      ...view,
      action: 'save',
      text: 'Entrega firmada desde Eloísa',
      source: { uid: 'another-professional' },
    });
    expect(saved).toMatchObject({ confirmed: true });
    const persisted = await day.get();
    expect(persisted.get('beds.R1.handoffNoteNightShift')).toBe('Entrega firmada desde Eloísa');
    if (shift === 'day') {
      expect(persisted.get('beds.R1.handoffNoteDayShift')).toBe('Entrega firmada desde Eloísa');
    }
    expect(persisted.get('meta.lastWriterClientId')).toBe(uid);
    const runTransaction = firestore.runTransaction.bind(firestore);
    const spy = vi.spyOn(firestore, 'runTransaction').mockImplementationOnce(async update => {
      await account.update({ status: 'suspended' });
      return runTransaction(update);
    });
    try {
      await expect(
        handler({ ...request, ...saved, action: 'save', text: 'Edición suspendida' })
      ).rejects.toMatchObject({ code: 'permission-denied' });
    } finally {
      spy.mockRestore();
    }
    expect((await day.get()).get('beds.R1.handoffNoteNightShift')).toBe(
      'Entrega firmada desde Eloísa'
    );
    await expect(handler({ ...request, action: 'read' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  } finally {
    try {
      await Promise.all([
        ...created.map(ref => ref.delete()),
        ...(authUserCreated ? [auth.deleteUser(uid)] : []),
      ]);
    } finally {
      vi.unstubAllEnvs();
      await deleteApp(app);
    }
  }
});

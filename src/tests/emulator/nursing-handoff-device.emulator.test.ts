// @vitest-environment node
import { randomUUID, randomBytes } from 'node:crypto';
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
const { ACCESS, PRIVATE, digest } = require('../../../functions/lib/accounts/accountPolicy.js');
const { createDeviceHandoffHandlers } = require('../../../functions/lib/nursingHandoffDevice.js');
const enabled = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST
);

it.skipIf(!enabled)(
  'guarda con HHR cerrado y conserva el autor de la llave individual',
  async () => {
    for (const address of [
      process.env.FIRESTORE_EMULATOR_HOST,
      process.env.FIREBASE_AUTH_EMULATOR_HOST,
    ]) {
      expect(address).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
    }
    const app = initializeApp({ projectId: 'demo-hhr-nursing-accounts' }, randomUUID());
    const auth = getAuth(app);
    const firestore = getFirestore(app);
    const run = '22222222-2';
    const uid = 'hhrn_' + randomUUID();
    const hospital = firestore.collection('hospitals').doc('hanga_roa');
    const instant = Date.now();
    const { date, shift } = clinicalSlot(new Date(instant));
    const day = hospital.collection('dailyRecords').doc(date);
    const policy = hospital.collection('settings').doc('rayenImportPolicy');
    const account = firestore.collection(ACCESS).doc(uid);
    const identity = firestore.collection(PRIVATE).doc(uid);
    const episode = '901001';
    const patientRun = '11111111-1';
    const { register, operate: handler } = createDeviceHandoffHandlers({
      firestore,
      auth,
      Timestamp,
      FieldValue,
      now: () => instant,
    });
    const created: DocumentReference[] = [];
    let authUserCreated = false;
    async function create(ref: DocumentReference, data: Record<string, unknown>) {
      await ref.create(data);
      created.push(ref);
    }
    vi.stubEnv('METADATA_SERVER_DETECTION', 'none');
    const deviceId = randomUUID();
    const device = firestore.collection('hhr_nursing_handoff_devices').doc(deviceId);
    const proof = randomBytes(32).toString('hex');
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
      await create(identity, { rut: run });
      await create(account, {
        status: 'active',
        role: 'nurse_hospital',
        hospitalId: 'hanga_roa',
        version: 1,
      });
      const context = {
        auth: {
          uid,
          token: {
            hhrAccountVersion: 1,
            auth_time: Math.floor(instant / 1000),
            firebase: { sign_in_provider: 'password' },
          },
        },
      };
      await expect(register({ deviceId, challenge: digest(proof) }, context)).resolves.toEqual({
        registered: true,
      });
      created.push(device);
      const request = { deviceId, proof, professionalRun: run, episode, patientRun };
      await expect(handler({ ...request, action: 'status' })).resolves.toEqual({
        authorized: true,
      });
      await expect(
        handler({ ...request, action: 'status', professionalRun: patientRun })
      ).rejects.toMatchObject({
        code: 'unauthenticated',
      });
      const view = await handler({ ...request, action: 'read' });
      expect(view).toMatchObject({ date, shift });
      const saved = await handler({
        ...request,
        ...view,
        action: 'save',
        text: 'Entrega desde el equipo registrado',
        source: { uid: 'another-professional' },
      });
      expect(saved).toMatchObject({ confirmed: true });
      const persisted = await day.get();
      expect(persisted.get('beds.R1.handoffNoteNightShift')).toBe(
        'Entrega desde el equipo registrado'
      );
      if (shift === 'day') {
        expect(persisted.get('beds.R1.handoffNoteDayShift')).toBe(
          'Entrega desde el equipo registrado'
        );
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
        'Entrega desde el equipo registrado'
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
  }
);

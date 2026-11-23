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

it.skipIf(!enabled).each(['nurse_hospital', 'admin'])(
  'guarda con HHR cerrado y conserva el autor de la cuenta individual %s',
  async role => {
    for (const address of [
      process.env.FIRESTORE_EMULATOR_HOST,
      process.env.FIREBASE_AUTH_EMULATOR_HOST,
    ]) {
      expect(address).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
    }
    const app = initializeApp({ projectId: 'demo-hhr-nursing-handoff' }, randomUUID());
    const auth = getAuth(app);
    const firestore = getFirestore(app);
    const run = '22222222-2';
    const uid = 'hhrn_' + randomUUID();
    const adminUid = randomUUID();
    const adminRun = '33333333-3';
    const adminEmail = 'daniel.opazo@hospitalhangaroa.cl';
    const hospital = firestore.collection('hospitals').doc('hanga_roa');
    const instant = Date.now() + 60_000;
    const { date, shift } = clinicalSlot(new Date(instant));
    const day = hospital.collection('dailyRecords').doc(date);
    const policy = hospital.collection('settings').doc('rayenImportPolicy');
    const account = firestore.collection(ACCESS).doc(uid);
    const identity = firestore.collection(PRIVATE).doc(uid);
    const episode = '901001';
    const patientRun = '11111111-1';
    const passport = 'XZ1739001';
    const passportEpisode = '901002';
    const { register, operate: handler } = createDeviceHandoffHandlers({
      firestore,
      auth,
      Timestamp,
      FieldValue,
      now: () => instant,
    });
    const created: DocumentReference[] = [];
    const authUsers: string[] = [];
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
      authUsers.push(uid);
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
          R2: {
            clinicalEpisodeId: passportEpisode,
            rut: passport,
            patientName: 'Paciente sintético con pasaporte',
            documentType: 'Pasaporte',
            handoffNoteDayShift: 'Día sintético',
            handoffNoteNightShift: 'Noche sintética',
          },
          R3: {
            clinicalEpisodeId: '901003',
            rut: '173900100',
            patientName: 'Paciente sintético con pasaporte numérico',
            documentType: 'Pasaporte',
          },
          R4: {
            clinicalEpisodeId: '901004',
            rut: 'XYZABC',
            patientName: 'Paciente sintético con pasaporte alfabético',
            documentType: 'Pasaporte',
          },
          H2C2: {
            clinicalEpisodeId: '902002',
            rut: '88888888-8',
            patientName: 'Segundo paciente sintético',
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
        role,
        hospitalId: 'hanga_roa',
        version: 1,
      });
      const context = {
        auth: {
          uid,
          token: {
            hhrAccountVersion: 1,
            auth_time: Math.floor(Date.now() / 1000) + 1,
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
      const patients = [
        { episode, patientRun },
        { episode: passportEpisode, patientRun: passport },
        { episode: passportEpisode, patientRun },
        { episode: '999999', patientRun },
      ];
      const batch = await handler({ ...request, action: 'read-batch', patients });
      expect(batch.slot).toEqual({ date, shift });
      expect(batch.results).toEqual([
        expect.objectContaining({
          date,
          shift,
          text: '',
          comparison: { shift: shift === 'day' ? 'night' : 'day', text: '' },
        }),
        expect.objectContaining({
          date,
          shift,
          text: shift === 'day' ? 'Día sintético' : 'Noche sintética',
          comparison:
            shift === 'day'
              ? { shift: 'night', text: 'Noche sintética' }
              : { shift: 'day', text: 'Día sintético' },
        }),
        expect.objectContaining({ code: 'FAILED_PRECONDITION' }),
        expect.objectContaining({ code: 'NOT_FOUND' }),
      ]);
      expect(batch.results[2]).not.toHaveProperty('text');
      await expect(
        handler({
          ...request,
          action: 'read-batch',
          patients,
          proof: '0'.repeat(64),
        })
      ).rejects.toMatchObject({ code: 'unauthenticated' });
      await expect(
        handler({
          ...request,
          action: 'read-batch',
          patients: Array.from({ length: 51 }, () => patients[0]),
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
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
      const passportRequest = { ...request, episode: passportEpisode, patientRun: 'xz 1739001' };
      const passportView = await handler({ ...passportRequest, action: 'read' });
      await expect(
        handler({
          ...passportRequest,
          ...passportView,
          action: 'save',
          text: 'Entrega con pasaporte',
        })
      ).resolves.toMatchObject({ confirmed: true, text: 'Entrega con pasaporte' });
      const afterPassport = await day.get();
      expect(afterPassport.get('beds.R2.handoffNoteNightShift')).toBe('Entrega con pasaporte');
      expect(afterPassport.get('beds.R1.handoffNoteNightShift')).toBe(
        'Entrega desde el equipo registrado'
      );
      expect(afterPassport.get('meta.lastWriterClientId')).toBe(uid);
      for (const attempt of [
        { ...passportRequest, patientRun },
        { ...passportRequest, patientRun: 'XZ1739002' },
        { ...passportRequest, episode },
      ]) {
        await expect(handler({ ...attempt, action: 'read' })).rejects.toMatchObject({
          code: 'failed-precondition',
        });
      }

      for (const [episode, patientRun] of [
        ['901003', '173900100'],
        ['901004', 'xyzabc'],
      ]) {
        await expect(
          handler({ ...request, episode, patientRun, action: 'read' })
        ).resolves.toMatchObject({ date, shift });
      }
      await expect(
        handler({ ...request, episode: '901003', patientRun: 'XZ173900100', action: 'read' })
      ).rejects.toMatchObject({
        code: 'failed-precondition',
      });
      await day.update({
        'beds.H1C1': {
          clinicalEpisodeId: passportEpisode,
          rut: passport,
          documentType: 'Pasaporte',
        },
      });
      await expect(handler({ ...passportRequest, action: 'read' })).rejects.toMatchObject({
        code: 'failed-precondition',
      });
      await day.update({ 'beds.H1C1': FieldValue.delete() });
      await auth.createUser({ uid: adminUid, email: adminEmail, emailVerified: true });
      authUsers.push(adminUid);
      await auth.updateUser(adminUid, {
        providerToLink: { providerId: 'google.com', uid: randomUUID(), email: adminEmail },
      });
      const roles = firestore.doc('config/roles');
      await create(roles, { [adminEmail]: 'admin' });
      await create(firestore.collection(PRIVATE).doc('nursingHandoffAdministrator'), {
        runHash: digest(adminRun),
      });
      const adminDevice = randomUUID();
      const adminProof = randomBytes(32).toString('hex');
      await expect(
        register(
          { deviceId: adminDevice, challenge: digest(adminProof) },
          {
            auth: {
              uid: adminUid,
              token: {
                email: adminEmail,
                email_verified: true,
                auth_time: Math.floor(Date.now() / 1000) + 1,
                firebase: { sign_in_provider: 'google.com' },
              },
            },
          }
        )
      ).resolves.toEqual({ registered: true });
      created.push(firestore.collection('hhr_nursing_handoff_devices').doc(adminDevice));
      const adminRequest = {
        ...request,
        deviceId: adminDevice,
        proof: adminProof,
        professionalRun: adminRun,
        episode: '902002',
        patientRun: '88888888-8',
      };
      const adminView = await handler({ ...adminRequest, action: 'read' });
      const adminSaved = await handler({
        ...adminRequest,
        ...adminView,
        action: 'save',
        text: 'Entrega de administrador',
      });
      expect(adminSaved).toMatchObject({ confirmed: true });
      expect((await day.get()).get('meta.lastWriterClientId')).toBe(adminUid);

      const runTransaction = firestore.runTransaction.bind(firestore);
      const roleChanged = vi
        .spyOn(firestore, 'runTransaction')
        .mockImplementationOnce(async update => {
          await roles.set({ [adminEmail]: 'viewer' });
          return runTransaction(update);
        });
      try {
        await expect(
          handler({
            ...adminRequest,
            ...adminSaved,
            action: 'save',
            text: 'Edición con rol revocado',
          })
        ).rejects.toMatchObject({ code: 'permission-denied' });
      } finally {
        roleChanged.mockRestore();
      }
      const activeField = shift === 'day' ? 'handoffNoteDayShift' : 'handoffNoteNightShift';
      expect((await day.get()).get('beds.H2C2.' + activeField)).toBe('Entrega de administrador');
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
          ...authUsers.map(uid => auth.deleteUser(uid)),
        ]);
      } finally {
        vi.unstubAllEnvs();
        await deleteApp(app);
      }
    }
  }
);

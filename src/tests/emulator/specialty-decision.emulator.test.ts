import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { createDailyRecordWriteAuthorityFunctions, makeRecord, makeContext } from
  '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const runEmulatorTests = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;
const describeEmulator = runEmulatorTests ? describe : describe.skip;

describeEmulator('specialty decision with real Firestore transactions', () => {
  let environment: RulesTestEnvironment;
  const date = '2026-09-23';
  const recordPath = `hospitals/hanga_roa/dailyRecords/${date}`;

  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-specialty-decision-test',
      firestore: { rules, host: emulatorConfig.host, port: emulatorConfig.port },
    });
  });

  afterAll(async () => { await environment?.cleanup(); });

  it('commits exactly one decision and audit; rejects a competing stale acceptance', async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const remote = { ...makeRecord(), date, meta: { revision: 2 },
        beds: { R1: { ...makeRecord().beds.R1, specialty: '' } } };
      await db.doc(recordPath).set(remote);
      await db.doc('hospitals/hanga_roa/settings/specialtyAssignment').set({
        schemaVersion: 1, revision: 1, autoEnabled: false,
        memoryEnabled: false, aiMode: 'off', rules: [], memory: [],
      });
      const api = createDailyRecordWriteAuthorityFunctions({
        firestore: db, Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
      });
      const auth = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } };
      process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
      try {
        const payload = (value: string, mutationId: string) => ({
          date, patch: { 'beds.R1.specialty': value },
          syncContract: { mutationId, baseRevision: 2, changedPaths: ['beds.R1.specialty'] },
          specialtyIntent: { kind: 'manual', bedId: 'R1', target: 'bed',
            episodeId: 'ep-uno', value, expectedDecisionId: null },
        });
        const results = await Promise.allSettled([
          api.patchDailyRecordWithClinicalAuthority.run(payload('Cirugía', 'first-decision'), auth),
          api.patchDailyRecordWithClinicalAuthority.run(payload('Pediatría', 'second-decision'), auth),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const snapshot = await db.doc(recordPath).get();
        const assigned = snapshot.data()?.beds.R1.specialty;
        expect(['Cirugía', 'Pediatría']).toContain(assigned);
        expect(snapshot.data()?.beds.R1.specialtyAssignment.source).toBe('manual');
        const audits = await db.doc(recordPath).collection('specialtyDecisions').get();
        expect(audits.size).toBe(1);
        expect(audits.docs[0].data().value).toBe(assigned);
      } finally {
        delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
      }
    });
  });

  it('rejects a specialty decision bundled with another clinical field without writing either', async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc(recordPath).set({ ...makeRecord(), date, meta: { revision: 2 },
        beds: { R1: { ...makeRecord().beds.R1, specialty: '' } } });
      await db.doc('hospitals/hanga_roa/settings/specialtyAssignment').set({
        schemaVersion: 1, revision: 1, autoEnabled: false,
        memoryEnabled: false, aiMode: 'off', rules: [], memory: [],
      });
      const api = createDailyRecordWriteAuthorityFunctions({ firestore: db, Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital') });
      const patch = { 'beds.R1.specialty': 'Cirugía',
        'beds.R1.diagnosisComments': 'Dato sintético' };
      process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
      try {
        await expect(api.patchDailyRecordWithClinicalAuthority.run({ date, patch,
          syncContract: { mutationId: 'mixed-specialty', baseRevision: 2,
            changedPaths: Object.keys(patch) },
          specialtyIntent: { kind: 'manual', bedId: 'R1', target: 'bed',
            episodeId: 'ep-uno', value: 'Cirugía', expectedDecisionId: null },
        }, { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } }))
          .rejects.toThrow(/only change/);
        const stored = (await db.doc(recordPath).get()).data();
        expect(stored?.meta.revision).toBe(2);
        expect(stored?.beds.R1.specialty).toBe('');
        expect((await db.doc(recordPath).collection('specialtyDecisions').get()).size).toBe(0);
      } finally {
        delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
      }
    });
  });

  it('rejects forged pre-catalog provenance and never overwrites a reused audit ID', async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const policyPath = 'hospitals/hanga_roa/settings/specialtyAssignment';
      await db.doc(policyPath).set({ schemaVersion: 1, revision: 1,
        autoEnabled: false, memoryEnabled: false, aiMode: 'off', rules: [], memory: [] });
      const base = { ...makeRecord(), date, meta: { revision: 2 },
        beds: { R1: { ...makeRecord().beds.R1, specialty: 'Cirugía',
          specialtyAssignment: { schemaVersion: 3, episodeId: 'ep-uno',
            decisionId: 'forged-decision', recordDate: date, source: 'manual',
            actorUid: 'synthetic-user', decidedAt: new Date().toISOString() } } } };
      await db.doc(recordPath).set(base);
      const api = createDailyRecordWriteAuthorityFunctions({ firestore: db, Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital') });
      const auth = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } };
      process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
      try {
        await expect(api.patchDailyRecordWithClinicalAuthority.run({ date,
          patch: { 'beds.R1.age': '21' },
          syncContract: { mutationId: 'unrelated-edit', baseRevision: 2,
            changedPaths: ['beds.R1.age'] } }, auth)).rejects.toThrow(/unverified specialty provenance/i);

        await db.doc(recordPath).set({ ...base,
          beds: { R1: { ...base.beds.R1, specialty: '', specialtyAssignment: null } } });
        const payload = (value: string, mutationId: string, baseRevision: number,
          expectedDecisionId: string | null) => ({ date,
          patch: { 'beds.R1.specialty': value },
          syncContract: { mutationId, baseRevision, changedPaths: ['beds.R1.specialty'] },
          specialtyIntent: { kind: 'manual', bedId: 'R1', target: 'bed',
            episodeId: 'ep-uno', value, expectedDecisionId },
        });
        await api.patchDailyRecordWithClinicalAuthority.run(
          payload('Cirugía', 'first-decision', 2, null), auth);
        await api.patchDailyRecordWithClinicalAuthority.run(
          payload('Pediatría', 'second-decision', 3, 'first-decision'), auth);
        await expect(api.patchDailyRecordWithClinicalAuthority.run(
          payload('Traumatología', 'first-decision', 4, 'second-decision'), auth))
          .rejects.toThrow(/already used/i);
        const audits = await db.doc(recordPath).collection('specialtyDecisions').get();
        expect(audits.size).toBe(2);
        expect(audits.docs.find(doc => doc.id === 'first-decision')?.data().value).toBe('Cirugía');
      } finally {
        delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
      }
    });
  });

  it('moves a verified specialty with its episode through a partial Firestore update', async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const first = makeRecord().beds.R1;
      const metadata = { schemaVersion: 3, episodeId: 'ep-uno',
        decisionId: 'signed-before-move', recordDate: date, source: 'manual',
        actorUid: 'synthetic-user', decidedAt: '2026-09-23T08:00:00.000Z' };
      await db.doc(recordPath).set({ ...makeRecord(), date, meta: { revision: 2 }, beds: {
        R1: { ...first, specialty: 'Cirugía', specialtyAssignment: metadata },
        R2: { ...first, bedId: 'R2', patientName: 'Paciente Dos',
          rut: '22.222.222-2', clinicalEpisodeId: 'ep-dos', specialty: '' },
      } });
      await db.doc(`${recordPath}/specialtyDecisions/signed-before-move`).set({
        recordDate: date, decisionId: 'signed-before-move', episodeId: 'ep-uno',
        value: 'Cirugía', metadata,
      });
      await db.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
        schemaVersion: 2, clinicalBatchMode: 'enforced',
      });
      await db.doc('hospitals/hanga_roa/settings/specialtyAssignment').set({
        schemaVersion: 1, revision: 1, autoEnabled: false,
        memoryEnabled: false, aiMode: 'off', rules: [], memory: [],
      });
      const api = createDailyRecordWriteAuthorityFunctions({ firestore: db, Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin') });
      const patch = {
        'beds.R1.patientName': 'Paciente Dos', 'beds.R1.rut': '22.222.222-2',
        'beds.R1.clinicalEpisodeId': 'ep-dos', 'beds.R1.specialty': '',
        'beds.R1.specialtyAssignment': null,
        'beds.R2.patientName': 'Paciente Uno', 'beds.R2.rut': '11.111.111-1',
        'beds.R2.clinicalEpisodeId': 'ep-uno', 'beds.R2.specialty': 'Cirugía',
      };
      process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
      try {
        await api.patchDailyRecordWithClinicalAuthority.run({ date, patch,
          syncContract: { mutationId: 'swap-mutation', baseRevision: 2,
            changedPaths: Object.keys(patch) } },
        { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } });
        const stored = (await db.doc(recordPath).get()).data();
        expect(stored?.beds.R2.specialtyAssignment).toEqual(metadata);
        expect(stored?.beds.R2.specialty).toBe('Cirugía');
        expect(stored?.beds.R1.specialtyAssignment).toBeNull();
        expect((await db.doc(`${recordPath}/specialtyDecisions/signed-before-move`).get())
          .data()?.value).toBe('Cirugía');
      } finally {
        delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
      }
    });
  });
});

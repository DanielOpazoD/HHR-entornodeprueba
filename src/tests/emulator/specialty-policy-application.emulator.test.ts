import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeRecord,
  makeContext,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
const require = createRequire(import.meta.url);
const {
  createSpecialtyPolicyFunctions,
} = require('../../../functions/lib/specialtyPolicyFunctions.js');
const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST
    ? describe
    : describe.skip;
const date = '2026-10-16';
const hospital = 'hospitals/hanga_roa';
const policyPath = `${hospital}/specialtyPolicies/active`;
const recordPath = `${hospital}/dailyRecords/${date}`;
const rule = {
  id: 'pneumonia',
  kind: 'assign',
  cie10Code: 'J18.9',
  specialty: 'Med Interna',
  scope: 'all',
  revision: 1,
};
const input = {
  confirmed: true,
  expectedRevision: 1,
  autoEnabled: true,
  memoryEnabled: false,
  aiMode: 'off',
  rules: [rule],
  memory: [],
  applyDate: date,
};
const auth = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-admin' } };
const pendingRecord = (day = date) => ({
  ...makeRecord(),
  date: day,
  meta: { revision: 2 },
  beds: { R1: { ...makeRecord().beds.R1, cie10Code: 'J18.9', specialty: '' } },
});

describeEmulator('specialty policy publication and current census transaction', () => {
  let environment: RulesTestEnvironment;
  beforeAll(async () => {
    const config = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-specialty-policy-apply',
      firestore: {
        rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
        host: config.host,
        port: config.port,
      },
    });
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${date}T12:00:00Z`));
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
  });
  afterAll(async () => {
    await environment?.cleanup();
  });

  it('publishes once, audits the immediate assignment and retains rules for a later census', async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc(`${hospital}/settings/rayenImportPolicy`).set({ schemaVersion: 2 });
      await db
        .doc(policyPath)
        .set({
          schemaVersion: 1,
          revision: 1,
          autoEnabled: false,
          memoryEnabled: false,
          aiMode: 'off',
          rules: [],
          memory: [],
        });
      await db.doc(recordPath).set(pendingRecord());
      const api = createSpecialtyPolicyFunctions({
        firestore: db,
        Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });
      expect(await api.configureSpecialtyPolicy.run(input, auth)).toMatchObject({
        appliedDecisions: 1,
      });
      expect((await db.doc(recordPath).get()).data()?.beds.R1).toMatchObject({
        specialty: 'Med Interna',
        specialtyAssignment: { source: 'rule' },
      });
      expect((await db.doc(recordPath).collection('specialtyDecisions').get()).size).toBe(1);
      expect(
        await api.configureSpecialtyPolicy.run({ ...input, expectedRevision: 2 }, auth)
      ).toMatchObject({ appliedDecisions: 0 });
      expect((await db.doc(recordPath).collection('specialtyDecisions').get()).size).toBe(1);
      const future = '2026-10-17';
      vi.setSystemTime(new Date(`${future}T12:00:00Z`));
      await db.doc(`${hospital}/dailyRecords/${future}`).set(pendingRecord(future));
      const writes = createDailyRecordWriteAuthorityFunctions({
        firestore: db,
        Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });
      await writes.patchDailyRecordWithClinicalAuthority.run(
        {
          date: future,
          patch: { 'beds.R1.diagnosisComments': 'Seguimiento sintético' },
          syncContract: {
            mutationId: 'future-census-sync',
            baseRevision: 2,
            changedPaths: ['beds.R1.diagnosisComments'],
          },
        },
        auth
      );
      expect(
        (await db.doc(`${hospital}/dailyRecords/${future}`).get()).data()?.beds.R1.specialty
      ).toBe('Med Interna');
      expect((await db.doc(policyPath).get()).data()?.revision).toBe(3);
    });
  });
  it('assigns an occupied clinical crib without treating an empty main slot as a blocked bed', async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const source = pendingRecord();
      const emptyMain = { ...source.beds.R1, patientName: '', isBlocked: false };
      const crib = {
        ...source.beds.R1,
        patientName: 'Cuna sintética',
        clinicalEpisodeId: 'ep-cuna-independiente',
        bedMode: 'Cuna',
      };
      await db.doc(`${hospital}/settings/rayenImportPolicy`).set({ schemaVersion: 2 });
      await db.doc(policyPath).set({
        schemaVersion: 1,
        revision: 1,
        autoEnabled: false,
        memoryEnabled: false,
        aiMode: 'off',
        rules: [],
        memory: [],
      });
      await db.doc(recordPath).set({
        ...source,
        beds: { R1: { ...emptyMain, clinicalCrib: crib } },
      });
      const api = createSpecialtyPolicyFunctions({
        firestore: db,
        Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });
      expect(await api.configureSpecialtyPolicy.run(input, auth)).toMatchObject({
        appliedDecisions: 1,
      });
      const saved = (await db.doc(recordPath).get()).data()?.beds.R1;
      expect(saved.specialty).toBe('');
      expect(saved.isBlocked).toBe(emptyMain.isBlocked);
      expect(saved.clinicalCrib).toMatchObject({
        specialty: 'Pediatría',
        specialtyAssignment: { source: 'rule', episodeId: 'ep-cuna-independiente' },
      });
      expect((await db.doc(recordPath).collection('specialtyDecisions').get()).size).toBe(1);
    });
  });

  it('preserves a concurrent confirmed choice, committing only one assignment audit', async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc(`${hospital}/settings/rayenImportPolicy`).set({ schemaVersion: 2 });
      await db
        .doc(policyPath)
        .set({
          schemaVersion: 1,
          revision: 1,
          autoEnabled: false,
          memoryEnabled: false,
          aiMode: 'off',
          rules: [],
          memory: [],
        });
      await db.doc(recordPath).set(pendingRecord());
      const api = createSpecialtyPolicyFunctions({
        firestore: db,
        Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });
      const writes = createDailyRecordWriteAuthorityFunctions({
        firestore: db,
        Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });
      const [publication, manual] = await Promise.allSettled([
        api.configureSpecialtyPolicy.run(input, auth),
        writes.patchDailyRecordWithClinicalAuthority.run(
          {
            date,
            patch: { 'beds.R1.specialty': 'Cirugía' },
            syncContract: {
              mutationId: 'concurrent-manual-choice',
              baseRevision: 2,
              changedPaths: ['beds.R1.specialty'],
            },
            specialtyIntent: {
              kind: 'manual',
              bedId: 'R1',
              target: 'bed',
              episodeId: 'ep-uno',
              value: 'Cirugía',
              expectedDecisionId: null,
            },
          },
          auth
        ),
      ]);
      expect(publication.status).toBe('fulfilled');
      const saved = (await db.doc(recordPath).get()).data()?.beds.R1;
      expect(saved.specialty).toBe(manual.status === 'fulfilled' ? 'Cirugía' : 'Med Interna');
      expect((await db.doc(recordPath).collection('specialtyDecisions').get()).size).toBe(1);
    });
  });
});

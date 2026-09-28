import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeRecord,
  makeContext,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const require = createRequire(import.meta.url);
const {
  createRayenClinicalEnrichmentFunctions,
} = require('../../../functions/lib/rayenClinicalEnrichmentFunctions.js');
const enabled =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;
const describeEmulator = enabled ? describe : describe.skip;

describeEmulator('newborn specialty through persisted census and clinical synchronization', () => {
  let app: App;
  let db: Firestore;
  const date = '2026-05-13'; // Historical day: diagnosis catalog rules must remain inactive.
  const hospitalPath = 'hospitals/hanga_roa';
  const recordPath = `${hospitalPath}/dailyRecords/${date}`;

  beforeAll(() => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      throw new Error('This integration suite requires a local Firestore emulator.');
    }
    app = initializeApp({ projectId: 'demo-hhr-newborn-specialty-sync' }, 'newborn-specialty-sync');
    db = getFirestore(app);
  });

  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });

  it.each([
    ['bed', 'Otro'],
    ['bed', ''],
    ['clinicalCrib', 'Otro'],
    ['clinicalCrib', ''],
  ] as const)(
    'preserves a manual %s decision (%s) across sync and clinical retry',
    async (target, value) => {
      await db.recursiveDelete(db.doc(hospitalPath));
      const previousFlag = process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
      process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
      try {
        const child = {
          ...makeRecord().beds.R1,
          specialty: '',
          bedMode: 'Cuna',
          clinicalEpisodeId: 'synthetic-rn',
        };
        const runPolicy = {
          schemaVersion: 2,
          mode: 'preview',
          revision: 1,
          clinicalBatchMode: 'enforced',
        };
        await db.doc(`${hospitalPath}/settings/rayenImportPolicy`).set(runPolicy);
        const recordRef = db.doc(recordPath);
        await recordRef.set({
          ...makeRecord(),
          meta: { revision: 2 },
          beds: {
            R1:
              target === 'bed'
                ? child
                : {
                    ...makeRecord().beds.R1,
                    specialty: 'Ginecobstetricia',
                    clinicalCrib: child,
                  },
            R2: { ...child, bedId: 'R2', clinicalEpisodeId: 'unrelated-rn' },
            R3: {
              ...makeRecord().beds.R1,
              bedId: 'R3',
              clinicalEpisodeId: 'synthetic-adult',
              specialty: '',
            },
          },
          rayenSyncHistory: [
            {
              id: 'synthetic-run',
              sourceDate: date,
              status: 'applied',
              policy: runPolicy,
            },
          ],
        });
        const dependencies = {
          firestore: db,
          Timestamp,
          resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
        };
        const writes = createDailyRecordWriteAuthorityFunctions(dependencies);
        const clinical = createRayenClinicalEnrichmentFunctions(dependencies);
        const auth = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } };
        const patientPath = target === 'bed' ? 'beds.R1' : 'beds.R1.clinicalCrib';
        const patient = (record: FirebaseFirestore.DocumentData) =>
          target === 'bed' ? record.beds.R1 : record.beds.R1.clinicalCrib;
        const read = async () => (await recordRef.get()).data()!;
        const unrelatedCrib = (await read()).beds.R2;

        // The production callable assigns the default and creates its audit in one transaction.
        await writes.patchDailyRecordWithClinicalAuthority.run(
          {
            date,
            patch: { [`${patientPath}.pathology`]: 'Synthetic update' },
            syncContract: {
              mutationId: 'default-write',
              baseRevision: 2,
              changedPaths: [`${patientPath}.pathology`],
            },
          },
          auth
        );
        const defaulted = await read();
        expect(patient(defaulted).specialty).toBe('Pediatría');
        expect(patient(defaulted).specialtyAssignment.source).toBe('rule');
        expect(defaulted.beds.R2).toEqual(unrelatedCrib);
        expect((await recordRef.collection('specialtyDecisions').get()).size).toBe(1);

        // Manual decisions require a published policy, even with diagnosis rules disabled.
        await db.doc(`${hospitalPath}/specialtyPolicies/active`).set({
          schemaVersion: 1,
          revision: 1,
          autoEnabled: false,
          memoryEnabled: false,
          aiMode: 'off',
          rules: [],
          memory: [],
        });
        await writes.patchDailyRecordWithClinicalAuthority.run(
          {
            date,
            patch: { [`${patientPath}.specialty`]: value },
            syncContract: {
              mutationId: 'manual-write',
              baseRevision: defaulted.meta.revision,
              changedPaths: [`${patientPath}.specialty`],
            },
            specialtyIntent: {
              kind: 'manual',
              bedId: 'R1',
              target,
              episodeId: 'synthetic-rn',
              value,
              expectedDecisionId: patient(defaulted).specialtyAssignment.decisionId,
            },
          },
          auth
        );
        const manual = await read();
        const decision = patient(manual).specialtyAssignment;

        // A subsequent structural census save must retain the explicit choice (including blank).
        patient(manual).pathology = 'Next synthetic census';
        await writes.saveDailyRecordWithClinicalAuthority.run(
          {
            date,
            record: manual,
            expectedLastUpdated: manual.lastUpdated,
            syncContract: {
              mutationId: 'next-census',
              baseRevision: manual.meta.revision,
              changedPaths: [`${patientPath}.pathology`],
            },
          },
          auth
        );
        const synchronized = await read();
        expect(patient(synchronized).specialty).toBe(value);
        expect(patient(synchronized).specialtyAssignment).toEqual(decision);
        expect(synchronized.beds.R2).toEqual(unrelatedCrib);

        const payload = {
          date,
          authorityDate: date,
          runId: 'synthetic-run',
          mutationId: 'clinical-write',
          expectedLastUpdated:
            synchronized.lastUpdated instanceof Timestamp
              ? synchronized.lastUpdated.toDate().toISOString()
              : synchronized.lastUpdated,
          baseRevision: synchronized.meta.revision,
          mode: 'enforced',
          fieldContractVersion: 2,
          patches: [
            {
              bedId: 'R1',
              clinicalCrib: target === 'clinicalCrib',
              clinicalEpisodeId: 'synthetic-rn',
              fields: { vitalSigns: { temperature: 36.7 } },
            },
            {
              bedId: 'R3',
              clinicalEpisodeId: 'synthetic-adult',
              fields: {
                vitalSigns: { systolic: 120 },
                evaluationScores: { braden: { total: 17 } },
              },
            },
          ],
        };
        await clinical.applyRayenClinicalEnrichmentBatch.run(payload, auth);
        const persisted = await read();
        expect(patient(persisted).vitalSigns).toEqual({ temperature: 36.7 });
        expect(patient(persisted).specialty).toBe(value);
        expect(patient(persisted).specialtyAssignment).toEqual(decision);
        expect(persisted.beds.R3.evaluationScores.braden.total).toBe(17);
        expect(persisted.beds.R3.specialty).toBe('');
        expect(persisted.beds.R2).toEqual(unrelatedCrib);
        const historyCount = (await recordRef.collection('history').get()).size;

        // A lost acknowledgement replays the original request, including its old revision.
        const retry = await clinical.applyRayenClinicalEnrichmentBatch.run(payload, auth);
        expect(retry.authorityStatus).toBe('idempotent');
        expect(await read()).toEqual(persisted);
        expect((await recordRef.collection('history').get()).size).toBe(historyCount);
        const audits = await recordRef.collection('specialtyDecisions').get();
        expect(audits.size).toBe(2);
        expect(audits.docs.map(doc => doc.data().source).sort()).toEqual(['manual', 'rule']);
        expect(
          (await db.collection(`${hospitalPath}/dailyRecords`).get()).docs.map(doc => doc.id)
        ).toEqual([date]);
      } finally {
        if (previousFlag === undefined) delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
        else process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = previousFlag;
      }
    }
  );
});

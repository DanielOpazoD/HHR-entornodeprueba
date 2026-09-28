import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeRecord,
  makeContext,
  makeCanonicalEmptyBed,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const require = createRequire(import.meta.url);
const {
  createRayenClinicalEnrichmentFunctions,
} = require('../../../functions/lib/rayenClinicalEnrichmentFunctions.js');
const enabled =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;
const describeEmulator = enabled ? describe : describe.skip;

describeEmulator('specialty and clinical writers across concurrency and bed movement', () => {
  let app: App;
  let db: Firestore;
  const date = '2026-05-13';
  const hospitalPath = 'hospitals/hanga_roa';
  const recordPath = `${hospitalPath}/dailyRecords/${date}`;

  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
      throw new Error('This integration suite requires a local Firestore emulator.');
    }
    app = initializeApp(
      { projectId: 'demo-hhr-specialty-clinical-race' },
      'specialty-clinical-race'
    );
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
    'preserves manual %s choice (%s) and rejects stale targets after a move',
    async (target, value) => {
      await db.recursiveDelete(db.doc(hospitalPath));
      const priorFlag = process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
      process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
      try {
        const child = {
          ...makeRecord().beds.R1,
          specialty: '',
          bedMode: 'Cuna',
          clinicalEpisodeId: 'synthetic-rn',
        };
        const policy = {
          schemaVersion: 2,
          mode: 'preview',
          revision: 1,
          clinicalBatchMode: 'enforced',
        };
        const recordRef = db.doc(recordPath);
        await db.doc(`${hospitalPath}/settings/rayenImportPolicy`).set(policy);
        await db.doc(`${hospitalPath}/specialtyPolicies/active`).set({
          schemaVersion: 1,
          revision: 1,
          autoEnabled: false,
          memoryEnabled: false,
          aiMode: 'off',
          rules: [],
          memory: [],
        });
        await recordRef.set({
          ...makeRecord(),
          meta: { revision: 2 },
          beds: {
            R1:
              target === 'bed'
                ? child
                : { ...makeRecord().beds.R1, specialty: 'Ginecobstetricia', clinicalCrib: child },
            R2: makeCanonicalEmptyBed('R2'),
            R3: {
              ...makeRecord().beds.R1,
              bedId: 'R3',
              clinicalEpisodeId: 'unrelated',
              specialty: '',
            },
          },
          rayenSyncHistory: [{ id: 'synthetic-run', sourceDate: date, status: 'applied', policy }],
        });
        const dependencies = {
          firestore: db,
          Timestamp,
          resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
        };
        const writes = createDailyRecordWriteAuthorityFunctions(dependencies);
        const clinical = createRayenClinicalEnrichmentFunctions(dependencies);
        const auth = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } };
        const read = async () => (await recordRef.get()).data()!;
        const patient = (record: FirebaseFirestore.DocumentData, bedId = 'R1') =>
          target === 'bed' ? record.beds[bedId] : record.beds[bedId].clinicalCrib;
        const patientPath = target === 'bed' ? 'beds.R1' : 'beds.R1.clinicalCrib';
        const patch = (
          record: FirebaseFirestore.DocumentData,
          mutationId: string,
          fields: Record<string, unknown>
        ) => ({
          date,
          patch: fields,
          syncContract: {
            mutationId,
            baseRevision: record.meta.revision,
            changedPaths: Object.keys(fields),
          },
        });
        const baseline = (record: FirebaseFirestore.DocumentData) => ({
          baseRevision: record.meta.revision,
          expectedLastUpdated:
            record.lastUpdated instanceof Timestamp
              ? record.lastUpdated.toDate().toISOString()
              : record.lastUpdated,
        });
        await writes.patchDailyRecordWithClinicalAuthority.run(
          patch(await read(), 'default-write', {
            [`${patientPath}.pathology`]: 'Synthetic update',
          }),
          auth
        );
        const base = await read();
        const untouched = base.beds.R3;
        const manual = {
          ...patch(base, 'manual-write', { [`${patientPath}.specialty`]: value }),
          specialtyIntent: {
            kind: 'manual',
            bedId: 'R1',
            target,
            episodeId: 'synthetic-rn',
            value,
            expectedDecisionId: patient(base).specialtyAssignment.decisionId,
          },
        };
        let clinicalPayload = {
          date,
          authorityDate: date,
          runId: 'synthetic-run',
          mutationId: 'clinical-write',
          ...baseline(base),
          mode: 'enforced',
          fieldContractVersion: 2,
          patches: [
            {
              bedId: 'R1',
              clinicalCrib: target === 'clinicalCrib',
              clinicalEpisodeId: 'synthetic-rn',
              fields: { vitalSigns: { temperature: 36.7 } },
            },
          ],
        };
        // Both real callables start from the same revision. Firestore decides the winner.
        const results = await Promise.allSettled([
          writes.patchDailyRecordWithClinicalAuthority.run(manual, auth),
          clinical.applyRayenClinicalEnrichmentBatch.run(clinicalPayload, auth),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find(
          result => result.status === 'rejected'
        ) as PromiseRejectedResult;
        expect(rejected.reason.code).toBe('aborted');
        expect(rejected.reason.message).toMatch(/revision_mismatch/);

        // Retry only the rejected operation after a fresh read; retain its original semantic intent.
        const current = await read();
        if (results[0].status === 'rejected') {
          await writes.patchDailyRecordWithClinicalAuthority.run(
            {
              ...manual,
              syncContract: { ...manual.syncContract, baseRevision: current.meta.revision },
            },
            auth
          );
        } else {
          clinicalPayload = { ...clinicalPayload, ...baseline(current) };
          await clinical.applyRayenClinicalEnrichmentBatch.run(clinicalPayload, auth);
        }
        const settled = await read();
        const decision = patient(settled).specialtyAssignment;
        expect(patient(settled).specialty).toBe(value);
        expect(decision.source).toBe('manual');
        expect(patient(settled).vitalSigns).toEqual({ temperature: 36.7 });
        expect(settled.meta.revision).toBe(base.meta.revision + 2);
        expect(settled.beds.R3).toEqual(untouched);
        expect((await recordRef.collection('specialtyDecisions').get()).size).toBe(2);

        // The episode moves while a response from its former location can still arrive.
        await writes.saveDailyRecordWithClinicalAuthority.run(
          {
            date,
            record: {
              ...settled,
              beds: {
                ...settled.beds,
                R1: makeCanonicalEmptyBed('R1'),
                R2: { ...settled.beds.R1, bedId: 'R2' },
              },
            },
            ...baseline(settled),
            syncContract: {
              mutationId: 'move-write',
              baseRevision: settled.meta.revision,
              changedPaths: ['beds.R1', 'beds.R2'],
            },
          },
          auth
        );
        const moved = await read();
        expect(patient(moved, 'R2').specialtyAssignment).toEqual(decision);
        expect(patient(moved, 'R2').specialty).toBe(value);
        expect(patient(moved, 'R2').vitalSigns).toEqual({ temperature: 36.7 });
        expect(moved.beds.R1.patientName).toBe('');
        expect(moved.beds.R3).toEqual(untouched);
        const historyCount = (await recordRef.collection('history').get()).size;

        // A lost acknowledgement is a receipt lookup, even with the obsolete bed and revision.
        const replay = await clinical.applyRayenClinicalEnrichmentBatch.run(clinicalPayload, auth);
        expect(replay.authorityStatus).toBe('idempotent');
        expect(await read()).toEqual(moved);

        // Updating a revision alone must never authorize a fresh write to the old location.
        await expect(
          clinical.applyRayenClinicalEnrichmentBatch.run(
            {
              ...clinicalPayload,
              ...baseline(moved),
              mutationId: 'late-new-clinical-write',
              patches: clinicalPayload.patches.map(item => ({
                ...item,
                fields: { vitalSigns: { temperature: 37.2 } },
              })),
            },
            auth
          )
        ).rejects.toThrow(/no longer active|episode no longer matches/);
        await expect(
          writes.patchDailyRecordWithClinicalAuthority.run(
            {
              ...manual,
              syncContract: {
                ...manual.syncContract,
                mutationId: 'late-manual-write',
                baseRevision: moved.meta.revision,
              },
            },
            auth
          )
        ).rejects.toThrow(
          /Specialty episode changed|target bed has no active clinical episode identity/
        );
        expect(await read()).toEqual(moved);
        expect((await recordRef.collection('history').get()).size).toBe(historyCount);
        expect((await recordRef.collection('specialtyDecisions').get()).size).toBe(2);
      } finally {
        if (priorFlag === undefined) delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
        else process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = priorFlag;
      }
    }
  );
});

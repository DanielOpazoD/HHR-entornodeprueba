import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';

const require = createRequire(import.meta.url);
const {
  createRayenClinicalEnrichmentFunctions,
} = require('../../../functions/lib/rayenClinicalEnrichmentFunctions.js');
const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST
    ? describe
    : describe.skip;

// Real client retry and production handlers against local Firestore. Only the callable
// transport acknowledgement is injected; no synthetic server success is returned.
describeEmulator('clinical batch client recovers a lost committed response', () => {
  let app: App;
  let db: Firestore;
  const date = '2026-05-13';
  const hospitalPath = 'hospitals/hanga_roa';
  const recordPath = `${hospitalPath}/dailyRecords/${date}`;

  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
      throw new Error('This integration suite requires a local Firestore emulator.');
    }
    app = initializeApp({ projectId: 'demo-hhr-clinical-lost-response' }, 'clinical-lost-response');
    db = getFirestore(app);
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });

  it.each([false, true])(
    'replays the committed identity with concurrent writer=%s',
    async concurrentWriter => {
      await db.recursiveDelete(db.doc(hospitalPath));
      const policy = {
        schemaVersion: 2,
        mode: 'preview',
        revision: 1,
        clinicalBatchMode: 'enforced',
      };
      await db.doc(`${hospitalPath}/settings/rayenImportPolicy`).set(policy);
      const seed = {
        ...DataFactory.createMockDailyRecord(date, {
          lastUpdated: `${date}T10:00:00.000Z`,
          beds: {
            R1: DataFactory.createMockPatient('R1', {
              clinicalEpisodeId: 'synthetic-episode',
              admissionDate: date,
            }),
            R2: DataFactory.createMockPatient('R2', {
              clinicalEpisodeId: 'synthetic-unrelated',
              admissionDate: date,
            }),
          },
        }),
        meta: { revision: 2 },
        rayenSyncHistory: [{ id: 'synthetic-run', sourceDate: date, status: 'applied', policy }],
      };
      const recordRef = db.doc(recordPath);
      await recordRef.set(sanitizeForFirestore(seed) as FirebaseFirestore.DocumentData);
      const read = async () => (await recordRef.get()).data()!;
      const refreshRecord = vi.fn(async () => {
        const persisted = await read();
        return {
          ...persisted,
          lastUpdated:
            persisted.lastUpdated instanceof Timestamp
              ? persisted.lastUpdated.toDate().toISOString()
              : persisted.lastUpdated,
        } as DailyRecord;
      });
      const dependencies = {
        firestore: db,
        Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      };
      const clinical = createRayenClinicalEnrichmentFunctions(dependencies);
      const writes = createDailyRecordWriteAuthorityFunctions(dependencies);
      const auth = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } };
      let firstPayload: RayenClinicalEnrichmentBatchPayload | undefined;
      let expectedPersisted: FirebaseFirestore.DocumentData | undefined;
      let historyCount = 0;
      const invoke = vi.fn(async (payload: RayenClinicalEnrichmentBatchPayload) => {
        const response = await clinical.applyRayenClinicalEnrichmentBatch.run(payload, auth);
        if (!firstPayload) {
          firstPayload = structuredClone(payload);
          expect(response.authorityStatus).toBe('ok');
          expect(response.historySnapshots).toBe(1);
          if (concurrentWriter) {
            const committed = await read();
            await writes.patchDailyRecordWithClinicalAuthority.run(
              {
                date,
                patch: { 'beds.R1.handoffNote': 'Synthetic concurrent note' },
                syncContract: {
                  mutationId: 'synthetic-other-writer',
                  baseRevision: committed.meta.revision,
                  changedPaths: ['beds.R1.handoffNote'],
                },
              },
              auth
            );
          }
          expectedPersisted = await read();
          historyCount = (await recordRef.collection('history').get()).size;
          throw Object.assign(new Error('Synthetic response lost after commit'), {
            code: 'functions/unavailable',
          });
        }
        expect(payload).toEqual(firstPayload);
        expect(response).toMatchObject({
          authorityStatus: 'idempotent',
          resultParity: 'matched',
          patientWrites: 0,
          historySnapshots: 0,
        });
        return response;
      });
      const applyPatch = vi.fn();
      const createMutationId = vi.fn(() => 'synthetic-clinical-mutation');
      const result = await applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record: await refreshRecord(),
        runId: 'synthetic-run',
        operations: [
          {
            target: { censusDate: date, bedId: 'R1', clinicalEpisodeId: 'synthetic-episode' },
            patch: {
              'beds.R1.vitalSigns': { temperature: 36.7 },
              'beds.R1.clinicalSyncCheckpoint': { version: 1, sources: {} },
            },
          },
        ],
        applyPatch,
        refreshRecord,
        invoke,
        createMutationId,
      });

      expect(invoke).toHaveBeenCalledTimes(2);
      expect(createMutationId).toHaveBeenCalledTimes(1);
      expect(applyPatch).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        retries: 1,
        batch: { parity: 'matched', clinicalTargets: 1, checkpointTargets: 1 },
      });
      expect(refreshRecord).toHaveBeenCalledTimes(2);
      expect(await read()).toEqual(expectedPersisted);
      expect(historyCount).toBe(concurrentWriter ? 2 : 1);
      expect((await recordRef.collection('history').get()).size).toBe(historyCount);
      expect(expectedPersisted?.meta.revision).toBe(concurrentWriter ? 4 : 3);
      expect(expectedPersisted?.beds.R1.vitalSigns).toEqual({ temperature: 36.7 });
      expect(expectedPersisted?.beds.R1.clinicalSyncCheckpoint).toEqual({
        version: 1,
        sources: {},
      });
      expect(expectedPersisted?.beds.R1.handoffNote).toBe(
        concurrentWriter ? 'Synthetic concurrent note' : seed.beds.R1.handoffNote
      );
      expect(expectedPersisted?.beds.R2).toEqual(sanitizeForFirestore(seed.beds.R2));
      expect(
        (await db.collection(`${hospitalPath}/dailyRecords`).get()).docs.map(doc => doc.id)
      ).toEqual([date]);
    }
  );
});

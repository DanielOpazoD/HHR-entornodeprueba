import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { getDailyRecordWriteState } from '@/services/repositories/dailyRecordWriteCoordinator';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';

import { rebuildClinicalEnrichmentOperations } from '@/features/rayen-import/domain/rebuildClinicalEnrichmentOperations';
import { applyHistoricalCudyrBatchAuthoritatively } from '@/features/rayen-import/hooks/applyHistoricalCudyr';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DailyRecordSchema } from '@/schemas/zodSchemas';
import type { DocumentaryCudyr } from '@/domain/evaluationScales/documentaryCudyr';

// The browser bootstrap is outside this in-process transport test. Fail closed if
// an uninjected path tries to use a configured client instead of the local admin SDK.
vi.mock('@/firebaseConfig', () => ({
  firebaseReady: Promise.resolve(),
  firestoreReady: Promise.resolve(),
  auth: null,
  get db() {
    throw new Error('Browser Firestore is not available in this local emulator test.');
  },
  getFunctionsInstance: () => {
    throw new Error('Clinical transport must use the injected production handler.');
  },
}));

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
      const sequence: string[] = [];
      const refreshRecord = vi.fn(async () => {
        const persisted = await read();
        sequence.push(`read:${getDailyRecordWriteState(date).activeKind ?? 'idle'}`);
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
        sequence.push('invoke');
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
      expect(refreshRecord).toHaveBeenCalledTimes(3);
      // Initial base, fresh authority inside the turn, identical replay after response
      // loss, then readback. Ambiguous delivery must not rebase the committed identity.
      expect(sequence).toEqual([
        'read:idle',
        'read:clinical_sync',
        'invoke',
        'invoke',
        'read:clinical_sync',
      ]);
      expect(firstPayload).toMatchObject({
        date,
        authorityDate: date,
        mutationId: 'synthetic-clinical-mutation',
        expectedLastUpdated: seed.lastUpdated,
        baseRevision: 2,
      });
      expect(getDailyRecordWriteState(date)).toEqual({ pendingCount: 0, activeKind: null });
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
  it.each([
    'none',
    'same-night-score',
    'other-day-identity',
    'current-none',
    'current-other-day-identity',
  ])('fills a documentary prior-night gap without replacing concurrent work=%s', async race => {
    await db.recursiveDelete(db.doc(hospitalPath));
    const sourceDate = '2026-05-14';
    const currentScope = race.startsWith('current-');
    const authorityDate = currentScope ? date : sourceDate;
    const policy = {
      schemaVersion: 2,
      mode: 'preview' as const,
      revision: 1,
      clinicalBatchMode: 'enforced' as const,
    };
    await db.doc(`${hospitalPath}/settings/rayenImportPolicy`).set(policy);
    const person = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'synthetic-episode',
      documentType: 'RUT',
      patientName: 'Paciente Sintético',
      rut: '11.111.111-1',
    });
    const prior = DataFactory.createMockDailyRecord(date, {
      lastUpdated: `${date}T10:00:00.000Z`,
      beds: { R1: person },
    });
    const source = DataFactory.createMockDailyRecord(authorityDate, {
      lastUpdated: `${authorityDate}T10:00:00.000Z`,
      ...(currentScope ? { beds: { R1: person } } : {}),
      rayenSyncHistory: [
        {
          id: 'synthetic-run',
          sourceDate: authorityDate,
          status: 'applied',
          policy,
          startedAt: `${authorityDate}T10:00:00.000Z`,
          by: 'Operador sintético',
        },
      ],
    });
    const ref = db.doc(recordPath);
    await ref.set(
      sanitizeForFirestore({ ...prior, meta: { revision: 2 } }) as FirebaseFirestore.DocumentData
    );
    await db.doc(`${hospitalPath}/dailyRecords/${authorityDate}`).set(
      sanitizeForFirestore({
        ...source,
        ...(currentScope ? { meta: { revision: 2 } } : {}),
      }) as FirebaseFirestore.DocumentData
    );
    if (currentScope)
      await db
        .doc(`${hospitalPath}/dailyRecords/${sourceDate}`)
        .set({ date: sourceDate, beds: {} });
    const read = async () => {
      const data = (await ref.get()).data()!;
      return DailyRecordSchema.parse({
        ...data,
        lastUpdated:
          data.lastUpdated instanceof Timestamp
            ? data.lastUpdated.toDate().toISOString()
            : data.lastUpdated,
      });
    };
    const repository = buildMockDailyRecordRepository();
    repository.getAuthoritativeForDate = read;
    const score: DocumentaryCudyr = {
      category: 'C2',
      recordedDate: date,
      source: 'Eloísa · informe mensual',
      documentaryEvidence: {
        reportId: 'synthetic-archived-report',
        sourceDate,
        sourceRow: 5,
        clinicalEpisodeId: 'synthetic-episode',
        document: person.rut,
        patientName: person.patientName,
        documentType: 'RUT',
      },
    };
    const api = createRayenClinicalEnrichmentFunctions({
      firestore: db,
      Timestamp,
      resolveRoleForEmail: async () => 'admin',
    });
    const invoke = vi.fn(async (payload: RayenClinicalEnrichmentBatchPayload) => {
      if (race.endsWith('other-day-identity'))
        await db.doc(`${hospitalPath}/dailyRecords/${sourceDate}`).update({
          'beds.R2': sanitizeForFirestore({
            ...person,
            bedId: 'R2',
            clinicalEpisodeId: 'synthetic-readmission',
          }),
        });
      if (race === 'same-night-score')
        await ref.update({
          'beds.R1.evaluationScores.cudyr': {
            category: 'D1',
            recordedDate: date,
            source: 'Eloísa · Gestión de Camas',
          },
          'meta.revision': 3,
          lastUpdated: `${date}T11:00:00.000Z`,
        });
      return api.applyRayenClinicalEnrichmentBatch.run(payload, makeContext());
    });
    const input = {
      dailyRecord: repository,
      sourceRecord: source,
      censusDay: date,
      items: [{ clinicalEpisodeId: 'synthetic-episode', cudyr: score }],
      isAdmin: true,
      runId: 'synthetic-run',
      applyBatch: (options: Parameters<typeof applyClinicalEnrichmentBatch>[0]) =>
        applyClinicalEnrichmentBatch({ ...options, invoke }),
    };
    const baseRecord = await read();
    const operations = [
      {
        target: { censusDate: date, bedId: 'R1', clinicalEpisodeId: 'synthetic-episode' },
        patch: {
          'beds.R1.evaluationScores': { ...baseRecord.beds.R1.evaluationScores, cudyr: score },
        },
      },
    ];
    const execute = () =>
      currentScope
        ? applyClinicalEnrichmentBatch({
            mode: 'enforced',
            record: baseRecord,
            runId: 'synthetic-run',
            operations,
            applyPatch: async () => {
              throw new Error('No legacy writer');
            },
            refreshRecord: read,
            invoke,
            rebuildOperations: currentRecord =>
              rebuildClinicalEnrichmentOperations({ baseRecord, currentRecord, operations }),
          })
        : applyHistoricalCudyrBatchAuthoritatively(input);
    if (race.endsWith('other-day-identity')) {
      await expect(execute()).rejects.toThrow();
      expect((await read()).beds.R1.evaluationScores?.cudyr).toBeUndefined();
      return;
    }
    await execute();
    const reread = await read();
    expect(reread.beds.R1.evaluationScores?.cudyr).toEqual(
      race === 'same-night-score'
        ? { category: 'D1', recordedDate: date, source: 'Eloísa · Gestión de Camas' }
        : score
    );
    expect(reread.beds.R1.evaluationScores?.cudyr).not.toHaveProperty('recordedAt');
    expect(invoke).toHaveBeenCalledOnce();
    await execute();
    expect(invoke).toHaveBeenCalledOnce();
    expect(await read()).toEqual(reread);
    if (race === 'current-none') {
      await db.doc(`${hospitalPath}/dailyRecords/${sourceDate}`).update({
        'beds.R2': sanitizeForFirestore({
          ...person,
          bedId: 'R2',
          clinicalEpisodeId: 'later-readmission',
        }),
      });
      const braden = {
        code: 'BRADEN' as const,
        name: 'Braden',
        encounterEventId: 1,
        total: 18,
        severity: 'Bajo',
        recordedDate: date,
        recordedAt: `${date}T15:00:00-05:00`,
      };
      await applyClinicalEnrichmentBatch({
        mode: 'enforced',
        record: reread,
        runId: 'synthetic-run',
        operations: [
          {
            target: { censusDate: date, bedId: 'R1', clinicalEpisodeId: 'synthetic-episode' },
            patch: { 'beds.R1.evaluationScores': { ...reread.beds.R1.evaluationScores, braden } },
          },
        ],
        applyPatch: async () => {
          throw new Error('No legacy writer');
        },
        refreshRecord: read,
        // An older field-v2 client may echo an accepted documentary score while changing Braden.
        invoke: payload => invoke({ ...payload, fieldContractVersion: 2 }),
      });
      expect((await read()).beds.R1.evaluationScores).toEqual({ cudyr: score, braden });
      const withAdjacentScale = await read();
      await expect(
        applyClinicalEnrichmentBatch({
          mode: 'enforced',
          record: withAdjacentScale,
          runId: 'synthetic-run',
          operations: [
            {
              target: { censusDate: date, bedId: 'R1', clinicalEpisodeId: 'synthetic-episode' },
              patch: { 'beds.R1.evaluationScores': { braden } },
            },
          ],
          applyPatch: async () => {
            throw new Error('No legacy writer');
          },
          refreshRecord: read,
          invoke,
        })
      ).rejects.toThrow();
      expect((await read()).beds.R1.evaluationScores).toEqual({ cudyr: score, braden });
    }
  });
});

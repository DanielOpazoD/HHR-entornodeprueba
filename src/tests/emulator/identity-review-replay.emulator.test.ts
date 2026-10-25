import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { storedDay, syntheticPatient } from '@/tests/fixtures/identityReviewDayFixture';

const enabled =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;

let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => 'client_only',
  isServerClinicalWriteFenceActive: async () => false,
}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: async () => undefined }));

import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getTodayISO } from '@/utils/dateCoreUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';

type Json = Record<string, unknown>;

const date = getTodayISO();
const storedAt = `${date}T08:00:00.000Z`;
const docPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const PENDING = 'DIAGNOSTICO PENDIENTE SINTETICO';

const createEngine = () =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    transport: createFirestoreSyncTransport(),
    runtime: { isOnline: () => true, getOwnerKey: () => 'synthetic-owner', onOnline: () => {} },
    batchSize: 25,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30_000,
  });

describe.skipIf(!enabled)(
  'replaying an offline clinical edit of a bed under identity review',
  () => {
    let environment: RulesTestEnvironment;

    const storedBed = async (bedId: string): Promise<Json> => {
      let bed: Json = {};
      await environment.withSecurityRulesDisabled(async context => {
        const data = (await context.firestore().doc(docPath).get()).data() ?? {};
        bed = (data.beds as Record<string, Json>)[bedId];
      });
      return bed;
    };
    /** Another session writes the stored day after this device's edit. */
    const writeElsewhere = (patch: Json) =>
      environment.withSecurityRulesDisabled(async context => {
        await context
          .firestore()
          .doc(docPath)
          .update({ ...patch, lastUpdated: `${date}T08:30:00.000Z` });
      });
    /** This device edits the diagnosis of R1, under review, offline: the queue holds the edit. */
    const queuePendingDiagnosis = async () => {
      const day = (await getRecordFromFirestore(date))!;
      expect(day.beds.R1.identityReview?.fields).toEqual(['documentType']);
      day.beds.R1.pathology = PENDING;
      await createEngine().queueDailyRecordTaskWithLocalRecord(
        day,
        { syncContract: { expectedVersion: storedAt, changedPaths: ['beds.R1.pathology'] } },
        { deferProcessing: true }
      );
    };

    beforeAll(async () => {
      const { host, port } = resolveFirestoreRulesEmulatorConfig(
        process.env.FIRESTORE_EMULATOR_HOST
      );
      environment = await initializeTestEnvironment({
        projectId: 'demo-hhr-identity-review-replay',
        firestore: {
          host,
          port,
          rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
        },
      });
    });

    beforeEach(async () => {
      await hospitalDB.dailyRecords.clear();
      await hospitalDB.syncQueue.clear();
      await environment.clearFirestore();
      await environment.withSecurityRulesDisabled(async context => {
        await context
          .firestore()
          .doc(docPath)
          .set(sanitizeForFirestore(storedDay(undefined, { date, lastUpdated: storedAt })) as Json);
      });
      activeDb = environment
        .authenticatedContext('synthetic-admin', {
          email: 'synthetic-admin@example.invalid',
          role: 'admin',
        })
        .firestore();
      setFirestoreEnabled(true);
    });

    afterAll(async () => {
      await environment?.cleanup();
    });

    it('writes the pending diagnosis after another session repaired only the type', async () => {
      await queuePendingDiagnosis();
      await writeElsewhere({ 'beds.R1.documentType': 'Pasaporte' });

      await createEngine().processQueue();

      expect(await storedBed('R1')).toMatchObject({
        pathology: PENDING,
        documentType: 'Pasaporte',
      });
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      expect((await hospitalDB.dailyRecords.get(date))?.beds.R1).toMatchObject({
        pathology: PENDING,
        documentType: 'Pasaporte',
      });
    });

    it('keeps the pending diagnosis as a conflict when the bed now holds another patient', async () => {
      await queuePendingDiagnosis();
      const other = syntheticPatient('R1', 'PACIENTE OTRO', 'FAKE-PASSPORT-OTHER', {
        documentType: 'Pasaporte',
        clinicalEpisodeId: 'ep_synthetic_other',
      });
      await writeElsewhere({ 'beds.R1': sanitizeForFirestore(other) });

      await createEngine().processQueue();

      const r1 = await storedBed('R1');
      expect(r1).toMatchObject({
        patientName: 'PACIENTE OTRO',
        clinicalEpisodeId: 'ep_synthetic_other',
      });
      expect(r1.pathology).not.toBe(PENDING);
      // The edit stays on this device as a visible conflict, bound to the copy it was written on.
      const tasks = await hospitalDB.syncQueue.toArray();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        status: 'CONFLICT',
        syncContract: { changedPaths: ['beds.R1.pathology'] },
      });
      expect((tasks[0].payload as DailyRecord).beds.R1).toMatchObject({
        pathology: PENDING,
        clinicalEpisodeId: 'ep_synthetic_R1',
      });
      expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe(PENDING);
    });
  }
);

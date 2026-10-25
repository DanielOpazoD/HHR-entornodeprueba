/**
 * Synthetic-only, local emulator: a specialist note and a census edit queued offline for a patient
 * whose stored identity this client cannot read, replayed after another session gave the bed to
 * another patient. Real queue, transport, ACK and IndexedDB against a real Firestore transaction.
 */
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
import { buildSpecialistHandoffTargets } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { readMedicalHandoffDrafts } from '@/services/storage/medicalHandoffDraftStorage';
import { listQuarantinedOperations } from '@/features/rayen-import/components/localSyncPresentation';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getTodayISO } from '@/utils/dateCoreUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';

type Json = Record<string, unknown>;

/** The browser storage the note drafts live in, and an online browser. */
class MemoryStorage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
});
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

const OWNER = 'synthetic-owner';
const date = getTodayISO();
const storedAt = `${date}T08:00:00.000Z`;
const docPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const PENDING = 'DIAGNOSTICO PENDIENTE SINTETICO';
const NOTE = 'NOTA DE ENTREGA PENDIENTE SINTETICA';
const shownDate = date.split('-').reverse().join('-');

const createEngine = () =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    transport: createFirestoreSyncTransport(),
    runtime: { isOnline: () => true, getOwnerKey: () => OWNER, onOnline: () => {} },
    batchSize: 25,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30_000,
  });

describe.skipIf(!enabled)(
  'a note and a census edit pending for a bed under identity review',
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
    const writeElsewhere = (patch: Json) =>
      environment.withSecurityRulesDisabled(async context => {
        await context
          .firestore()
          .doc(docPath)
          .update({ ...patch, lastUpdated: `${date}T08:30:00.000Z` });
      });

    beforeAll(async () => {
      const { host, port } = resolveFirestoreRulesEmulatorConfig(
        process.env.FIRESTORE_EMULATOR_HOST
      );
      environment = await initializeTestEnvironment({
        projectId: 'demo-hhr-identity-review-handoff',
        firestore: {
          host,
          port,
          rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
        },
      });
    });

    beforeEach(async () => {
      localStorage.clear();
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

    it('holds both for A when B takes the bed, keeps the day current, and lets the panel discard each', async () => {
      const day = (await getRecordFromFirestore(date))!;
      expect(day.beds.R1.identityReview?.fields).toEqual(['documentType']);
      await hospitalDB.dailyRecords.put(day);
      const engine = createEngine();
      // The specialist's note for A: its own task, bound to A and its episode as this read shows them.
      const notePatch = { 'beds.R1.medicalHandoffNote': NOTE };
      await engine.queueDailyRecordTaskWithLocalRecord(
        day,
        {
          contexts: ['handoff'],
          origin: 'direct_queue',
          syncContract: { changedPaths: Object.keys(notePatch), mutationId: 'synthetic-note' },
        },
        { deferProcessing: true },
        {
          date,
          patch: notePatch,
          expectedOccupants: buildSpecialistHandoffTargets(day, notePatch),
          mutationId: 'synthetic-note',
        }
      );
      // The nurse's diagnosis for A, in the day task.
      await engine.queueDailyRecordTaskWithLocalRecord(
        { ...day, beds: { ...day.beds, R1: { ...day.beds.R1, pathology: PENDING } } },
        { syncContract: { expectedVersion: storedAt, changedPaths: ['beds.R1.pathology'] } },
        { deferProcessing: true }
      );
      // Another session: B, another patient and episode, takes R1, and R3 gets a new diagnosis.
      const other = syntheticPatient('R1', 'PACIENTE OTRO', 'FAKE-PASSPORT-OTHER', {
        documentType: 'Pasaporte',
        clinicalEpisodeId: 'ep_synthetic_other',
      });
      await writeElsewhere({
        'beds.R1': sanitizeForFirestore(other),
        'beds.R3.pathology': 'DIAGNOSTICO REMOTO R3',
      });

      await createEngine().processQueue();

      const r1 = await storedBed('R1');
      expect(r1).toMatchObject({
        patientName: 'PACIENTE OTRO',
        clinicalEpisodeId: 'ep_synthetic_other',
      });
      expect(JSON.stringify(r1)).not.toContain(NOTE);
      expect(JSON.stringify(r1)).not.toContain(PENDING);
      const tasks = await hospitalDB.syncQueue.toArray();
      expect(tasks.map(task => [task.type, task.status]).sort()).toEqual([
        ['UPDATE_DAILY_RECORD', 'CONFLICT'],
        ['UPDATE_SPECIALIST_HANDOFF', 'CONFLICT'],
      ]);
      const held = tasks.find(task => task.type === 'UPDATE_DAILY_RECORD')!;
      expect(held.key).toContain(':detached:');
      expect(held.syncContract?.changedPaths).toEqual(['beds.R1.pathology']);
      expect((held.payload as DailyRecord).beds.R1).toMatchObject({
        pathology: PENDING,
        clinicalEpisodeId: 'ep_synthetic_R1',
      });
      expect(readMedicalHandoffDrafts().map(draft => [draft.patientName, draft.value])).toEqual([
        ['PACIENTE UNO', NOTE],
      ]);
      // The ACK completed the day task: this device holds the stored day again, R3 included.
      const local = (await hospitalDB.dailyRecords.get(date))!;
      expect(local.beds.R1.patientName).toBe('PACIENTE OTRO');
      expect(local.beds.R3.pathology).toBe('DIAGNOSTICO REMOTO R3');

      // The sync panel names each for A and offers a confirmed discard, never a retry.
      const views = listQuarantinedOperations((await engine.listRecentOperations(10)) as never);
      expect(views.map(view => [view.targetLabel, view.refusedHandoff]).sort()).toEqual([
        [`Cambios de PACIENTE UNO · ${shownDate}`, 'detached'],
        [`Nota de entrega de PACIENTE UNO · ${shownDate}`, 'note'],
      ]);
      const store = createDexieSyncQueueStore();
      for (const view of views)
        expect(await store.discardQuarantinedTask!(view.id, OWNER)).toBe(true);
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      expect(await storedBed('R1')).toMatchObject({ patientName: 'PACIENTE OTRO' });
      expect(readMedicalHandoffDrafts().map(draft => draft.value)).toEqual([NOTE]);
    });
  }
);

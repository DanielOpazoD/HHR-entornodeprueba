/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { syncWithFirestoreDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import type { DailyRecord } from '@/types/domain/dailyRecord';

/**
 * A census edit that already entered this computer's queue is on its way to the server when its
 * author's session ends (Cerrar sesión, or 1 h without use) and another person signs in on the
 * same computer. The queue's own resend checks the session before every step of the send
 * (assertCanPublish); the direct send that follows the local write does not, so the edit reaches
 * the server inside the next person's session (W12-SC2, rule «nada se publica a nombre de una
 * sesión que ya no es la vigente»). The slow server read before the write stands for a slow or
 * returning network; everything else is the shipped code against the Firestore emulator.
 */

// One SDK per person, bound to the async chain that writes, as in syncQueueModel.
const { scope } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return { scope: new AsyncLocalStorage<{ db: unknown; uid: string; role: string }>() };
});
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return scope.getStore()?.db;
  },
  auth: {
    get currentUser() {
      const actor = scope.getStore();
      return actor
        ? {
            uid: actor.uid,
            email: `${actor.uid}@example.invalid`,
            displayName: 'Persona sintética',
            isAnonymous: false,
            getIdTokenResult: async () => ({ claims: { role: actor.role } }),
          }
        : null;
    },
  },
  storage: {},
  functions: {},
  firebaseReady: Promise.resolve(),
  getStorageInstance: vi.fn(),
  getFunctionsInstance: vi.fn(),
  mountConfigWarning: vi.fn(),
}));

// The server read that precedes the write answers only when the test says so (a slow network).
const slowRead = vi.hoisted(() => ({
  next: undefined as undefined | { reached: () => void; released: Promise<void> },
}));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDoc: async (...args: Parameters<typeof actual.getDoc>) => {
      const held = slowRead.next;
      if (held) {
        slowRead.next = undefined;
        held.reached();
        await held.released;
      }
      return actual.getDoc(...args);
    },
  };
});

const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-direct-send-session';
const ownerOf = (person: 'P1' | 'P2') => `user:synthetic-${person}`;

let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
let computer: { db: unknown };
const as = <T>(person: 'P1' | 'P2', action: () => T): T =>
  scope.run({ db: computer.db, uid: `synthetic-${person}`, role: 'nurse_hospital' }, action);
const readServer = async (): Promise<DailyRecord> => {
  const data = (await admin.doc(dayPath).get()).data();
  if (!data) throw new Error('Synthetic census missing');
  const stamp = data.lastUpdated;
  return docToRecord(
    { ...data, lastUpdated: stamp instanceof Timestamp ? stamp.toDate().toISOString() : stamp },
    date
  );
};

const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
(enabled ? describe : describe.skip)('a census edit on its way when the session changes', () => {
  beforeAll(async () => {
    const endpoint = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(
      process.env.FIRESTORE_EMULATOR_HOST ?? ''
    );
    if (!endpoint) throw new Error('A loopback Firestore emulator is required');
    env = await initializeTestEnvironment({
      projectId,
      firestore: {
        host: endpoint[1],
        port: Number(endpoint[2]),
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
    app = initializeApp({ projectId }, 'direct-send-session');
    admin = getFirestore(app);
    admin.settings({ ignoreUndefinedProperties: true });
    computer = {
      db: env
        .authenticatedContext('synthetic-P1', {
          email: 'synthetic-P1@example.invalid',
          role: 'nurse_hospital',
        })
        .firestore(),
    };
    setFirestoreEnabled(true);
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', '');
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_CALLABLE', '');
    // The queue runs only when the test says so.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await env?.cleanup();
    await admin?.terminate();
    if (app) await deleteApp(app);
  });

  it.fails(
    'does not publish an edit after its author’s session ended',
    async () => {
      await env.clearFirestore();
      await hospitalDB.dailyRecords.clear();
      await hospitalDB.syncQueue.clear();
      localStorage.clear();
      await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
        schemaVersion: 2,
        mode: 'preview',
        revision: 7,
        clinicalBatchMode: 'enforced',
      });
      await admin.doc(dayPath).set({
        ...DataFactory.createMockDailyRecord(date, {
          lastUpdated: '2026-01-01T00:00:00.000Z',
          dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
          handoffNovedadesNightShift: 'NOCHE BASE',
          activeExtraBeds: [],
        }),
        meta: { revision: 1 },
      });
      // P1 is signed in on this computer and has the day open.
      await as('P1', () => reconcileAuthorizedSessionOwner(ownerOf('P1')));
      await as('P1', () => syncWithFirestoreDetailed(date));
      const shown = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;

      // P1 writes the night shift note; the server is slow to answer.
      let reached!: () => void;
      let release!: () => void;
      const sending = new Promise<void>(resolve => (reached = resolve));
      slowRead.next = { reached, released: new Promise<void>(resolve => (release = resolve)) };
      const edit = as('P1', () =>
        updatePartialDetailed(
          date,
          { handoffNovedadesNightShift: 'NOTA SINTETICA DE P1' },
          { authoringSession: captureAuthoringSession(), baseRecord: shown }
        )
      );
      await sending;
      // The edit is already in P1's queue on this computer: the send follows the local write.
      const queued = await hospitalDB.syncQueue.toArray();
      expect(
        queued.some(
          task =>
            task.ownerKey === ownerOf('P1') &&
            (task.payload as Partial<DailyRecord>).handoffNovedadesNightShift ===
              'NOTA SINTETICA DE P1'
        )
      ).toBe(true);

      // P1 closes the session (the 1 h inactivity logout runs the same cleanup) and P2 signs in.
      await as('P1', () => clearSessionScopedClientState('manual'));
      await as('P2', () => reconcileAuthorizedSessionOwner(ownerOf('P2')));

      // The server answers.
      release();
      const result = await edit;
      process.stdout.write(
        `SC2 direct send after session change ${JSON.stringify({
          updatedRemotely: result.updatedRemotely,
          server: (await readServer()).handoffNovedadesNightShift,
          retainedForP1: (await hospitalDB.syncQueue.toArray()).map(task => ({
            owner: task.ownerKey,
            status: task.status,
            code: task.lastErrorCode,
          })),
        })}\n`
      );
      // Rule: nothing is published for a session that is no longer the current one. P1's text
      // stays in P1's queue («Sesión cerrada») for P1 to review and resend.
      expect((await readServer()).handoffNovedadesNightShift).toBe('NOCHE BASE');
    },
    60_000
  );
});

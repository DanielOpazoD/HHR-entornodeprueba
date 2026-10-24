import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { storedDay } from '@/tests/fixtures/identityReviewDayFixture';

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

import {
  saveRecordToFirestore,
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getTodayISO } from '@/utils/dateCoreUtils';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

type Json = Record<string, unknown>;

const date = getTodayISO();
const storedAt = `${date}T08:00:00.000Z`;
const docPath = `hospitals/hanga_roa/dailyRecords/${date}`;

describe.skipIf(!enabled)('writes against a stored day with an unreadable identity', () => {
  let environment: RulesTestEnvironment;

  const readStored = async (): Promise<Json> => {
    let data: Json = {};
    await environment.withSecurityRulesDisabled(async context => {
      data = ((await context.firestore().doc(docPath).get()).data() ?? {}) as Json;
    });
    return data;
  };
  const storedBed = async (bedId: string) =>
    ((await readStored()).beds as Record<string, Json>)[bedId];

  beforeAll(async () => {
    const { host, port } = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-identity-review-writes',
      firestore: {
        host,
        port,
        rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(docPath)
        .set(
          sanitizeForFirestore({
            ...storedDay(undefined, { date, lastUpdated: storedAt }),
            // The nurse editing window is anchored on this stamp.
            dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
          }) as Json
        );
    });
    activeDb = environment
      .authenticatedContext('synthetic-nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    setFirestoreEnabled(true);
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  it('reads the day with R1 under review', async () => {
    const record = await getRecordFromFirestore(date);

    expect(record?.beds.R1.identityReview?.fields).toEqual(['documentType']);
    expect(record?.beds.R1.documentType).toBeUndefined();
  });

  it('a nurse patch of another bed leaves the stored identity of R1 untouched', async () => {
    await updateRecordPartial(
      date,
      { 'beds.R2.pathology': 'DIAGNOSTICO EDITADO' } as DailyRecordPatch,
      storedAt
    );

    expect((await storedBed('R2')).pathology).toBe('DIAGNOSTICO EDITADO');
    expect((await storedBed('R1')).documentType).toBe('Cedula');
  });

  it('the replay of a queued edit of another bed writes R1 back exactly as stored', async () => {
    const payload = (await getRecordFromFirestore(date))!;
    payload.beds.R2.pathology = 'DIAGNOSTICO EDITADO';
    const runtime = { getDb: () => activeDb as Firestore, ready: Promise.resolve() };

    await createFirestoreSyncTransport(runtime).run({
      opId: 'synthetic-identity-review-op',
      type: 'UPDATE_DAILY_RECORD',
      payload,
      timestamp: 1,
      retryCount: 0,
      status: 'PENDING',
      syncContract: { expectedVersion: storedAt, changedPaths: ['beds.R2.pathology'] },
    });

    const r1 = await storedBed('R1');
    expect((await storedBed('R2')).pathology).toBe('DIAGNOSTICO EDITADO');
    expect(r1.documentType).toBe('Cedula');
    expect(r1.rut).toBe('FAKE-PASSPORT-R1');
    expect(JSON.stringify(await readStored())).not.toContain('identityReview');
  });

  it('a full save of the reviewed day is refused before anything is written', async () => {
    const before = await readStored();

    await expect(
      saveRecordToFirestore((await getRecordFromFirestore(date))!)
    ).rejects.toMatchObject({ code: 'patient_identity_repair_required', bedId: 'R1' });

    expect(await readStored()).toEqual(before);
  });
});

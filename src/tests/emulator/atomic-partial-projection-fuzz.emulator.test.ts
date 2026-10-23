import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  doc,
  getDocFromServer,
  setDoc,
  Timestamp,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

vi.mock('@/firebaseConfig', () => ({ db: null, auth: null }));

import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { prepareFirestorePartialData } from '@/services/storage/firestore/firestoreRecordWritePatchPolicy';
import { updateRecordPartiallyAtomically } from '@/services/storage/firestore/firestoreWriteSupport';
import { projectFirestoreUpdate } from '@/services/storage/firestore/firestoreUpdateProjection';

const runEmulatorTests =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;

const describeEmulator = runEmulatorTests ? describe : describe.skip;

// Synthetic data only. Rules are disabled: this pins update() semantics, not access control.
const DATE = '2026-10-23';
const RECORD_PATH = `hospitals/hanga_roa/dailyRecords/${DATE}`;
const BASE_VERSION = '2026-10-23T09:00:00.000Z';

const buildRecord = (): Record<string, unknown> => ({
  date: DATE,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: BASE_VERSION,
});

// Seeded generator (mulberry32), so a failure replays with the same base and payload.
const createRng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
type Rng = ReturnType<typeof createRng>;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const FUZZ_KEYS = ['R1', 'R2', 'clinicalCrib', 'devices', 'note'] as const;
const FUZZ_ROOTS = ['beds', 'extras', 'rayenSync', 'bedTypeOverrides', 'discharges'] as const;

const randomScalar = (rng: Rng): unknown =>
  pick(rng, [
    () => `texto-${Math.floor(rng() * 100)}`,
    () => Math.floor(rng() * 1000) - 500,
    () => Math.round(rng() * 1000) / 8,
    () => rng() < 0.5,
    () => null,
    () => new Date(Date.UTC(2026, 9, 1 + Math.floor(rng() * 20), 8, 30, 15, 250)),
    () => Timestamp.fromMillis(Date.UTC(2026, 0, 1) + Math.floor(rng() * 1e9)),
  ])();

// Scalars, arrays (never directly nested) and maps that may be empty. Random roots and keys give
// absent, null, scalar, array and Timestamp intermediates plus overlapping payload paths.
const randomValue = (rng: Rng, depth: number, inArray = false): unknown => {
  const roll = rng();
  if (depth <= 0 || roll < 0.4) return randomScalar(rng);
  if (roll < 0.6 && !inArray) {
    return Array.from({ length: Math.floor(rng() * 3) }, () => randomValue(rng, depth - 1, true));
  }
  return Object.fromEntries(
    Array.from({ length: Math.floor(rng() * 3) }, () => [
      pick(rng, FUZZ_KEYS),
      randomValue(rng, depth - 1, inArray),
    ])
  );
};

const randomPath = (rng: Rng): string =>
  [
    pick(rng, FUZZ_ROOTS),
    ...Array.from({ length: Math.floor(rng() * 4) }, () => pick(rng, FUZZ_KEYS)),
  ].join('.');

describeEmulator('Firestore emulator atomic partial projection fuzz', () => {
  let testEnv: RulesTestEnvironment;

  const withAdminDb = async <T>(run: (db: Firestore) => Promise<T>): Promise<T> => {
    let result: T | undefined;
    await testEnv.withSecurityRulesDisabled(async context => {
      result = await run(context.firestore() as unknown as Firestore);
    });
    return result as T;
  };

  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-atomic-partial-projection-fuzz',
      firestore: { rules, host: emulatorConfig.host, port: emulatorConfig.port },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('projects 50 seeded synthetic patches exactly as Firestore stores them', async () => {
    const rng = createRng(20261023);

    for (let iteration = 0; iteration < 50; iteration += 1) {
      const base = buildRecord();
      FUZZ_ROOTS.forEach(root => {
        if (rng() < 0.8) base[root] = randomValue(rng, 3);
      });
      const patch = Object.fromEntries(
        Array.from({ length: 1 + Math.floor(rng() * 4) }, () => [
          randomPath(rng),
          randomValue(rng, 3),
        ])
      );
      // The same pipeline updateRecordPartial runs before its atomic transaction.
      const payload = sanitizeForFirestore({
        ...(sanitizeForFirestore(
          prepareFirestorePartialData({
            partialData: patch,
            specialistScopedPatch: false,
            intentionalBedClear: undefined,
            clinicalCribCreate: rng() < 0.3,
          })
        ) as Record<string, unknown>),
        lastUpdated: Timestamp.now(),
      }) as DocumentData;
      await withAdminDb(db => setDoc(doc(db, RECORD_PATH), base));

      const committedBase = await withAdminDb(db =>
        updateRecordPartiallyAtomically(
          doc(db, RECORD_PATH),
          payload,
          BASE_VERSION,
          'conflict',
          `fuzz ${iteration}`,
          { historyPolicy: 'skip' },
          { getDb: () => db, ready: Promise.resolve() }
        )
      );
      const stored = await withAdminDb(async db =>
        (await getDocFromServer(doc(db, RECORD_PATH))).data()
      );

      expect(
        projectFirestoreUpdate(committedBase, payload),
        JSON.stringify({ iteration, base, payload })
      ).toStrictEqual(stored);
    }
  }, 120_000);
});

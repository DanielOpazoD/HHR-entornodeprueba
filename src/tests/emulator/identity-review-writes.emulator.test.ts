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
// The repository saves through its remote write; its local side has its own tests.
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', async () => {
  const { saveRecordToFirestore } =
    await import('@/services/storage/firestore/firestoreRecordWrites');
  return {
    save: (record: DailyRecord) => saveRecordToFirestore(record),
    saveDetailed: async (record: DailyRecord, expectedLastUpdated?: string) => {
      await saveRecordToFirestore(record, expectedLastUpdated ?? record.lastUpdated);
      return { outcome: 'clean', savedRemotely: true };
    },
  };
});
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: async () => undefined }));

import {
  saveRecordToFirestore,
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';
import { initializeDay } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { buildMovePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { getNextDay } from '@/utils/clinicalDayScheduleUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

type Json = Record<string, unknown>;

const date = getTodayISO();
const storedAt = `${date}T08:00:00.000Z`;
const dayPath = (day: string) => `hospitals/hanga_roa/dailyRecords/${day}`;
const docPath = dayPath(date);

describe.skipIf(!enabled)('writes against a stored day with an unreadable identity', () => {
  let environment: RulesTestEnvironment;

  const readStored = async (path = docPath): Promise<Json> => {
    let data: Json = {};
    await environment.withSecurityRulesDisabled(async context => {
      data = ((await context.firestore().doc(path).get()).data() ?? {}) as Json;
    });
    return data;
  };
  const storedBed = async (bedId: string, path = docPath) =>
    ((await readStored(path)).beds as Record<string, Json>)[bedId];
  const storeR1 = async (fields: Json) =>
    environment.withSecurityRulesDisabled(async context => {
      const stored = await readStored();
      const beds = stored.beds as Record<string, Json>;
      await context
        .firestore()
        .doc(docPath)
        .set({ ...stored, beds: { ...beds, R1: { ...beds.R1, ...fields } } });
    });
  const signInAs = (role: string, email: string) => {
    activeDb = environment.authenticatedContext(`synthetic-${role}`, { email, role }).firestore();
  };

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

  it('a full save of the reviewed day writes R1 back exactly as stored', async () => {
    const day = (await getRecordFromFirestore(date))!;
    day.beds.R2.pathology = 'DIAGNOSTICO EDITADO';
    signInAs('admin', 'synthetic-admin@example.invalid');

    await saveRecordToFirestore(day, storedAt);

    expect((await storedBed('R2')).pathology).toBe('DIAGNOSTICO EDITADO');
    expect(await storedBed('R1')).toMatchObject({
      documentType: 'Cedula',
      rut: 'FAKE-PASSPORT-R1',
      patientName: 'PACIENTE UNO',
    });
    expect(JSON.stringify(await readStored())).not.toContain('identityReview');
  });

  it('moving the reviewed patient writes it to the new bed exactly as stored', async () => {
    const day = (await getRecordFromFirestore(date))!;

    await updateRecordPartial(date, buildMovePatientPatches(day, 'R1', 'R4'), storedAt);

    expect(await storedBed('R4')).toMatchObject({
      documentType: 'Cedula',
      patientName: 'PACIENTE UNO',
      clinicalEpisodeId: 'ep_synthetic_R1',
    });
    expect((await storedBed('R1')).patientName).toBe('');
    expect(JSON.stringify(await readStored())).not.toContain('identityReview');
  });

  it('a patch of the review itself is refused and stores nothing', async () => {
    const before = await readStored();
    const review = { bedId: 'R2', slot: 'bed', fields: ['rut'], stored: { rut: 'X' } };

    await expect(
      updateRecordPartial(
        date,
        { 'beds.R2.identityReview': review } as unknown as DailyRecordPatch,
        storedAt
      )
    ).rejects.toMatchObject({ code: 'patient_identity_repair_required', bedId: 'R2' });

    expect(await readStored()).toEqual(before);
  });

  it('restoring a backup of the reviewed read stores the RUT exactly as it was stored', async () => {
    await storeR1({ documentType: 'RUT', rut: 12345678 });
    const read = (await getRecordFromFirestore(date))!;
    expect(read.beds.R1.identityReview?.fields).toEqual(['rut']);
    const backup = JSON.parse(
      JSON.stringify({
        version: '1',
        exportDate: date,
        year: 2026,
        month: 10,
        recordCount: 1,
        records: [read],
      })
    );
    signInAs('admin', 'synthetic-admin@example.invalid');

    await expect(importRecordsFromBackup(backup)).resolves.toMatchObject({ success: 1, failed: 0 });

    expect((await storedBed('R1')).rut).toBe(12345678);
    expect(JSON.stringify(await readStored())).not.toContain('identityReview');
  });

  it('the next day keeps R1 in its bed exactly as the day before stored it', async () => {
    const nextDate = getNextDay(date);

    const next = await initializeDay(nextDate, date);

    expect(next.beds.R1.identityReview?.fields).toEqual(['documentType']);
    const r1 = await storedBed('R1', dayPath(nextDate));
    expect(r1).toMatchObject({
      documentType: 'Cedula',
      patientName: 'PACIENTE UNO',
      rut: 'FAKE-PASSPORT-R1',
    });
    expect((await storedBed('R2', dayPath(nextDate))).patientName).toBe('PACIENTE DOS');
    expect(JSON.stringify(await readStored(dayPath(nextDate)))).not.toContain('identityReview');
  });
});

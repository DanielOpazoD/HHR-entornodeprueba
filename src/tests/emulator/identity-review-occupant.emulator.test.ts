import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
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
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: async () => undefined }));

import {
  saveRecordToFirestore,
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getTodayISO } from '@/utils/dateCoreUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

type Json = Record<string, unknown>;

const date = getTodayISO();
const storedAt = `${date}T08:00:00.000Z`;
const docPath = `hospitals/hanga_roa/dailyRecords/${date}`;

// R1 as storage holds it: neither its document type nor its episode can be read.
const UNREADABLE_R1 = { documentType: 'Cedula', clinicalEpisodeId: { fake: 'FAKE-EP-OLD' } };
/** Another patient, admitted to R1, as the nurse entered it. */
const NEW_PATIENT = {
  patientName: 'PACIENTE NUEVO SINTETICO',
  firstName: 'PACIENTE',
  lastName: 'NUEVO',
  secondLastName: 'SINTETICO',
  rut: 'FAKE-PASSPORT-NEW',
  documentType: 'Pasaporte',
  identityStatus: 'official',
  admissionDate: date,
  admissionTime: '11:30',
  pathology: 'DIAGNOSTICO SINTETICO NUEVO',
};

describe.skipIf(!enabled)('writes after a bed under identity review changes hands', () => {
  let environment: RulesTestEnvironment;

  const storedBed = async (bedId: string): Promise<Json> => {
    let bed: Json = {};
    await environment.withSecurityRulesDisabled(async context => {
      const data = (await context.firestore().doc(docPath).get()).data() ?? {};
      bed = (data.beds as Record<string, Json>)[bedId];
    });
    return bed;
  };
  const storeR1 = (r1: Json) =>
    environment.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(docPath)
        .set(
          sanitizeForFirestore({
            ...storedDay(r1, { date, lastUpdated: storedAt }),
            // The nurse editing window is anchored on this stamp.
            dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
          }) as Json
        );
    });
  const signInAs = (role: string, email: string) => {
    activeDb = environment.authenticatedContext(`synthetic-${role}`, { email, role }).firestore();
  };
  /** R1 holds the new patient as entered, and nothing of the one the review was read for. */
  const expectNewPatient = (r1: Json) => {
    expect(r1).toMatchObject(NEW_PATIENT);
    expect(r1.clinicalEpisodeId ?? null).toBeNull();
    expect(JSON.stringify(r1)).not.toMatch(/Cedula|FAKE-EP-OLD|identityReview/);
  };

  beforeAll(async () => {
    const { host, port } = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-identity-review-occupant',
      firestore: {
        host,
        port,
        rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await environment.clearFirestore();
    signInAs('nurse_hospital', 'hospitalizados@hospitalhangaroa.cl');
    setFirestoreEnabled(true);
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  it('a whole-bed replacement stores the new patient exactly as entered', async () => {
    await storeR1(UNREADABLE_R1);
    const read = (await getRecordFromFirestore(date))!;

    // The new patient takes over the bed object of the old one, review included.
    await updateRecordPartial(
      date,
      { 'beds.R1': { ...read.beds.R1, ...NEW_PATIENT } } as DailyRecordPatch,
      storedAt
    );

    expectNewPatient(await storedBed('R1'));
  });

  it('a full save with a new patient in the bed stores it as entered, not the old one', async () => {
    await storeR1(UNREADABLE_R1);
    const day = (await getRecordFromFirestore(date))!;
    day.beds.R1 = { ...day.beds.R1, ...(NEW_PATIENT as Partial<DailyRecord['beds'][string]>) };
    signInAs('admin', 'synthetic-admin@example.invalid');

    await saveRecordToFirestore(day, storedAt);

    expectNewPatient(await storedBed('R1'));
  });

  it('a repair stays repaired after a later unrelated save, which restores the rest', async () => {
    await storeR1({ documentType: 'Cedula', patientName: null, rut: ['FAKE-RUT', null] });
    const before = await storedBed('R1');
    signInAs('admin', 'synthetic-admin@example.invalid');
    const read = (await getRecordFromFirestore(date))!;
    const { record, mergedPatches } = preparePatchedRecordPersistence(read, date, {
      'beds.R1.documentType': 'Pasaporte',
    } as DailyRecordPatch);
    await updateRecordPartial(date, mergedPatches, storedAt);
    const { lastUpdated } = (await getRecordFromFirestore(date))!;
    record.beds.R2.pathology = 'DIAGNOSTICO EDITADO';

    await saveRecordToFirestore({ ...record, lastUpdated }, lastUpdated);

    const r1 = await storedBed('R1');
    expect(r1.documentType).toBe('Pasaporte');
    expect(r1.patientName).toEqual(before.patientName);
    expect(r1.rut).toEqual(['FAKE-RUT', null]);
    expect((await storedBed('R2')).pathology).toBe('DIAGNOSTICO EDITADO');
  });
});

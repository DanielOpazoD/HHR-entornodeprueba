import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
  makeCanonicalEmptyBed,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
let app: App;
let db: Firestore;
beforeAll(() => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
    throw new Error('Local emulator required');
  app = initializeApp(
    {
      projectId: 'demo-hhr-undo',
    },
    'movement-restore'
  );
  db = getFirestore(app);
});
afterAll(async () => {
  if (db) await db.terminate();
  if (app) await deleteApp(app);
  delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
});
it('restores mother and crib with their saved clinical data and rejects forged specialty audit', async () => {
  process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
  const base = makeRecord();
  const root = db.doc('hospitals/hanga_roa');
  const doc = root.collection('dailyRecords').doc(base.date);
  const metadata = {
    schemaVersion: 3,
    episodeId: 'ep-uno',
    decisionId: 'restore-decision',
    recordDate: base.date,
    source: 'manual',
    actorUid: 'synthetic-user',
    decidedAt: '2026-05-13T08:00:00Z',
  };
  const mother = {
    ...base.beds.R1,
    specialty: 'Cirugía',
    specialtyAssignment: metadata,
    vitalSigns: { systolic: 120 },
    evaluationScores: { test: 'preserved' },
  };
  const crib = {
    ...base.beds.R1,
    patientName: 'RN sintético',
    neonatalMaternalRut: base.beds.R1.rut,
    rut: '',
    bedMode: 'Cuna',
    clinicalEpisodeId: 'child',
    specialty: '',
    vitalSigns: { systolic: 80 },
  };
  const movements = [
    {
      movementDate: base.date,
      time: '12:00',
      id: 'mother-exit',
      bedId: 'R1',
      originalData: mother,
    },
    {
      movementDate: base.date,
      time: '12:00',
      id: 'child-exit',
      bedId: 'R1',
      isNested: true,
      originalData: crib,
    },
  ];
  await root
    .collection('settings')
    .doc('rayenImportPolicy')
    .set({ schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced' });
  await doc.set({ ...base, beds: { R1: makeCanonicalEmptyBed() }, discharges: movements });
  const api = createDailyRecordWriteAuthorityFunctions({
    firestore: db,
    Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
  });
  const candidate = {
    ...base,
    beds: { R1: { ...mother, clinicalCrib: crib } },
    discharges: movements.map(m => ({ ...m, deletedAt: '2026-05-13T13:00:00Z' })),
  };
  const request = { date: base.date, record: candidate, expectedLastUpdated: base.lastUpdated };
  await expect(
    api.saveDailyRecordWithClinicalAuthority.run(request, makeContext())
  ).rejects.toThrow(/Unverified specialty provenance/);
  await doc.collection('specialtyDecisions').doc(metadata.decisionId).set({
    recordDate: base.date,
    decisionId: metadata.decisionId,
    episodeId: 'ep-uno',
    value: 'Cirugía',
    metadata,
  });
  await expect(
    api.saveDailyRecordWithClinicalAuthority.run(request, makeContext())
  ).resolves.toMatchObject({ success: true });
  const stored = (await doc.get()).data();
  expect(stored?.beds.R1).toMatchObject({ ...mother, clinicalCrib: crib });
  expect(stored?.discharges.every((m: { deletedAt?: string }) => Boolean(m.deletedAt))).toBe(true);
});

/**
 * Synthetic-only, local emulator: the specialist note callable keeps its write id and path checks
 * inside a real Firestore transaction.
 */
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const {
  createSpecialistMedicalHandoffFunctions,
} = require('../../../functions/lib/specialistMedicalHandoffFunctions.js');
const { HOSPITAL_ID } = require('../../../functions/lib/runtime/runtimeConfig.js');
const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST
    ? describe
    : describe.skip;

const date = '2026-10-24';
const identity = {
  patientName: 'Paciente A Sintético',
  rut: '99.999.999-9',
  documentType: 'RUT',
  clinicalEpisodeId: 'synthetic-episode-A',
};
const context = {
  auth: { uid: 'synthetic-specialist', token: { email: 'specialist@example.invalid' } },
};
const entries = (note: string) => [{ id: 'entry-A', specialty: 'Medicina Interna', note }];
/** The client's specialistHandoffTextState for a patient with that single entry. */
const textState = (note: string) => JSON.stringify([note, [['entry-A', note]]]);
const notePatch = (note: string) => ({
  'beds.R4.medicalHandoffNote': note,
  'beds.R4.medicalHandoffEntries': entries(note),
});

describeEmulator('specialist note callable in a real Firestore transaction', () => {
  let app: App;
  let db: Firestore;
  let run: (data: unknown) => Promise<unknown>;
  const recordRef = () =>
    db.collection('hospitals').doc(HOSPITAL_ID).collection('dailyRecords').doc(date);
  const stored = async () => (await recordRef().get()).data();
  const seed = (note: string) =>
    recordRef().set({
      date,
      beds: { R4: { ...identity, medicalHandoffNote: note, medicalHandoffEntries: entries(note) } },
    });
  const write = (
    patch: Record<string, unknown>,
    base: string,
    mutationId: string,
    occupant: Record<string, unknown> = {}
  ) =>
    run({
      date,
      patch,
      expectedOccupants: [
        { bedId: 'R4', target: 'bed', ...identity, ...occupant, handoffBases: [textState(base)] },
      ],
      mutationId,
    });

  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
      throw new Error('This integration suite requires a local Firestore emulator.');
    }
    app = initializeApp({ projectId: 'demo-hhr-specialist-handoff' }, 'specialist-handoff');
    db = getFirestore(app);
    const api = createSpecialistMedicalHandoffFunctions({
      firestore: db,
      Timestamp,
      resolveRoleForEmail: async () => 'admin',
    });
    run = data => api.updateSpecialistMedicalHandoff.run(data, context);
  });
  beforeEach(async () => {
    await db.recursiveDelete(db.collection('hospitals').doc(HOSPITAL_ID));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });

  it('acknowledges only the same write again, never its id with another text or episode', async () => {
    await seed('Nota base');
    await expect(
      write(notePatch('Nota original'), 'Nota base', 'synthetic-write')
    ).resolves.toMatchObject({ success: true });
    await expect(
      write(notePatch('Nota original'), 'Nota base', 'synthetic-write')
    ).resolves.toMatchObject({ success: true, alreadyApplied: true });
    await expect(
      write(notePatch('Otra nota con el mismo envío'), 'Nota base', 'synthetic-write')
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      write(notePatch('Nota original'), 'Nota base', 'synthetic-write', {
        clinicalEpisodeId: 'synthetic-episode-B',
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const record = await stored();
    expect(record?.beds.R4).toMatchObject({
      medicalHandoffNote: 'Nota original',
      medicalHandoffEntries: entries('Nota original'),
    });
    expect(record?.meta).toEqual({
      lastMutationId: 'synthetic-write',
      lastMutationDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      lastChangedPaths: ['beds.R4.medicalHandoffNote', 'beds.R4.medicalHandoffEntries'],
    });
    expect(JSON.stringify(record?.meta)).not.toContain('Nota original');
  });

  it('refuses a replay once a write from an earlier tab replaced its note', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seed('Nota base');
    await write(notePatch('Nota original'), 'Nota base', 'synthetic-lost-answer');
    await run({ date, patch: notePatch('Nota de una pestaña anterior') });
    expect((await stored())?.meta).toEqual({
      lastMutationId: null,
      lastMutationDigest: null,
      lastChangedPaths: ['beds.R4.medicalHandoffNote', 'beds.R4.medicalHandoffEntries'],
    });

    await expect(
      write(notePatch('Nota original'), 'Nota base', 'synthetic-lost-answer')
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await stored())?.beds.R4.medicalHandoffNote).toBe('Nota de una pestaña anterior');
  });

  it('refuses a replay once a direct write that leaves meta replaced its note', async () => {
    await seed('Nota base');
    await write(notePatch('Nota original'), 'Nota base', 'synthetic-lost-answer');
    await recordRef().update(notePatch('Nota directa de un colega'));

    await expect(
      write(notePatch('Nota original'), 'Nota base', 'synthetic-lost-answer')
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    const record = await stored();
    expect(record?.beds.R4.medicalHandoffNote).toBe('Nota directa de un colega');
    expect(record?.meta?.lastMutationId).toBe('synthetic-lost-answer');
  });

  it('refuses a nested note path and keeps the stored entries a whole array', async () => {
    await seed('Nota más reciente');
    await expect(
      write(
        { 'beds.R4.medicalHandoffEntries.0.note': 'Nota antigua' },
        'Nota anterior',
        'synthetic-nested'
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });

    const record = await stored();
    expect(record?.beds.R4.medicalHandoffEntries).toEqual(entries('Nota más reciente'));
    expect(record?.meta).toBeUndefined();
  });
});

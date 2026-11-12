import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { HospitalConfigService } from '@/services/config/HospitalConfigService';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import type { MasterPatient } from '@/types/domain/patientMaster';

vi.mock('@/firebaseConfig', () => ({ db: null, auth: null }));
import { createPatientMasterRepository } from '@/services/repositories/PatientMasterRepository';

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const path = 'hospitals/hanga_roa/patients';
const patient = (i: number): MasterPatient => ({
  rut: `synthetic-${i}`,
  fullName: `Paciente Sintético ${String(i).padStart(4, '0')}`,
  createdAt: 1,
  updatedAt: i,
});
const target: MasterPatient = {
  rut: '12.345.678-5',
  fullName: 'Inés Riroroko Leiva',
  createdAt: 1,
  updatedAt: 0,
  lastClinicalEpisodeId: 'synthetic-episode-a',
};

describeEmulator('patient master with real Firestore', () => {
  let environment: RulesTestEnvironment;
  let repository: ReturnType<typeof createPatientMasterRepository>;
  beforeAll(async () => {
    const config = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    if (!['127.0.0.1', 'localhost'].includes(config.host))
      throw new Error('Local emulator required');
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-n5d-patient-master',
      firestore: config,
    });
  });
  beforeEach(async () => {
    HospitalConfigService.setHospitalId('hanga_roa');
    await environment.clearFirestore();
    // A fresh SDK cache must accompany the server reset between cases.
    const db = environment
      .authenticatedContext('synthetic-n5d-admin', {
        role: 'admin',
        email: 'admin@hospitalhangaroa.cl',
      })
      .firestore();
    repository = createPatientMasterRepository({ getDb: () => db as unknown as Firestore });
  });
  afterAll(async () => {
    HospitalConfigService.setHospitalId('hanga_roa');
    await environment?.cleanup();
  });
  const seed = async (patients: MasterPatient[]) =>
    environment.withSecurityRulesDisabled(async context => {
      for (let offset = 0; offset < patients.length; offset += 400) {
        const batch = context.firestore().batch();
        for (const row of patients.slice(offset, offset + 400))
          batch.set(context.firestore().doc(`${path}/${row.rut}`), row);
        await batch.commit();
      }
    });
  const stored = async () => {
    let rows: Record<string, unknown>[] = [];
    await environment.withSecurityRulesDisabled(async context => {
      rows = (await context.firestore().collection(path).get()).docs.map(doc => doc.data());
    });
    return rows;
  };

  it('reads normalized identity, confirmed absence and isolates hospitals', async () => {
    await seed([target]);
    expect(await repository.getPatientByRut('12345678-5')).toEqual(target);
    expect(await repository.getPatientByRut('11.111.111-1')).toBeNull();
    expect(await repository.getPatientByRut('invalid')).toBeNull();
    expect(await repository.getPatientByRut('P123456785')).toBeNull();
    HospitalConfigService.setHospitalId('synthetic-other');
    expect(await repository.getPatientByRut(target.rut)).toBeNull();
  });
  it('skips invalid identifiers without writing', async () => {
    await repository.upsertPatient({ rut: 'invalid', fullName: 'Paciente sintético' });
    expect(await stored()).toEqual([]);
  });
  // ID-01: current validation accepts letters stripped before checking the digit.
  it.fails('rejects passport identifiers on single upsert', async () => {
    await repository.upsertPatient({ rut: 'P123456785', fullName: 'Pasaporte Sintético' });
    expect(await stored()).toEqual([]);
  });
  it.fails('rejects passport identifiers on bulk upsert', async () => {
    expect(await repository.bulkUpsertPatients([{ ...target, rut: 'P123456785' }])).toEqual({
      successes: 0,
      errors: 1,
    });
    expect(await stored()).toEqual([]);
  });
  it('persists normalized updates and preserves demographics and episode through merge', async () => {
    await seed([target]);
    const before = Date.now();
    await repository.upsertPatient({ rut: '12345678-5', fullName: 'Nombre Sintético Nuevo' });
    const rows = await stored();
    expect(rows).toEqual([
      { ...target, fullName: 'Nombre Sintético Nuevo', updatedAt: expect.any(Number) },
    ]);
    expect(rows[0].updatedAt).toBeGreaterThanOrEqual(before);
    expect(rows[0].updatedAt).toBeLessThanOrEqual(Date.now());
  });
  it('bulk persists valid identifiers, skips invalid ones and preserves existing episode', async () => {
    await seed([target]);
    const { lastClinicalEpisodeId: _episode, ...demographics } = target;
    expect(
      await repository.bulkUpsertPatients([
        { ...demographics, rut: '12345678-5', fullName: 'Actualizado Sintético' },
        { ...patient(2), rut: 'invalid' },
      ])
    ).toEqual({ successes: 1, errors: 1 });
    expect(await stored()).toEqual([{ ...target, fullName: 'Actualizado Sintético' }]);
  });
  it('orders pages descending, advances real cursors and confirms the end', async () => {
    await seed([patient(1), patient(3), patient(2)]);
    const first = await repository.getPatientsPaginated(2);
    expect(first.patients).toEqual([patient(3), patient(2)]);
    const next = await repository.getPatientsPaginated(2, first.lastDoc!);
    expect(next.patients).toEqual([patient(1)]);
    expect(await repository.getPatientsPaginated(2, next.lastDoc!)).toEqual({
      patients: [],
      lastDoc: null,
    });
  });
  it('applies default and maximum limits to server results', async () => {
    await seed(Array.from({ length: 1001 }, (_, i) => patient(i)));
    expect((await repository.getPatientsPaginated(0)).patients).toHaveLength(20);
    expect((await repository.getPatientsPaginated(5000)).patients).toHaveLength(1000);
  });
  it('scans beyond 250 rows for accent insensitive multi word matches', async () => {
    await seed([...Array.from({ length: 250 }, (_, i) => patient(i + 1)), target]);
    expect(await repository.searchPatients('  Ines leiva  ')).toEqual([target]);
    expect(await repository.searchPatients('   ')).toEqual([]);
    expect(await repository.searchPatients(target.rut)).toEqual([target]);
  });
  it('bounds prefix queries and limits matches on the server', async () => {
    const rows = ['Alba', 'Alberto', 'Alfonso', 'Beatriz'].map((fullName, i) => ({
      ...patient(i),
      fullName,
    }));
    await seed(rows);
    expect(await repository.searchPatients('al', 2)).toEqual(rows.slice(0, 2));
    expect(await repository.searchPatients('Beatriz')).toEqual([rows[3]]);
    expect(await repository.searchPatients('Sin coincidencia')).toEqual([]);
  });
  it('rejects denied reads instead of reporting missing patients', async () => {
    const denied = createPatientMasterRepository({
      getDb: () => environment.unauthenticatedContext().firestore() as unknown as Firestore,
    });
    await expect(denied.getPatientByRut(target.rut)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(denied.getPatientsPaginated()).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(denied.searchPatients('alfa beta')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});

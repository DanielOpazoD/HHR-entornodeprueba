import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterPatient } from '@/types/domain/patientMaster';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

vi.mock('@/firebaseConfig', () => ({
  db: {},
}));

vi.mock('@/constants/firestorePaths', () => ({
  getActiveHospitalId: vi.fn(() => 'hanga_roa'),
  HOSPITAL_COLLECTIONS: {
    PATIENTS: 'patients',
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ __path: path, __id: id })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
  collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
  query: vi.fn((_base: unknown, ...parts: unknown[]) => ({ __parts: parts })),
  orderBy: vi.fn((_field: string, _direction: string) => ({ __orderBy: true })),
  limit: vi.fn((count: number) => ({ __limit: count })),
  startAfter: vi.fn((_doc: unknown) => ({ __startAfter: true })),
  getDocs: vi.fn(),
  where: vi.fn((_field: string, _op: string, _value: unknown) => ({ __where: true })),
}));

import * as firestore from 'firebase/firestore';
import {
  bulkUpsertPatients,
  createPatientMasterRepository,
  getPatientByRut,
  getPatientsPaginated,
  searchPatients,
  upsertPatient,
} from '@/services/repositories/PatientMasterRepository';

describe('PatientMasterRepository', () => {
  const runtime = { getDb: () => ({}) as never };
  const injectedRepository = createPatientMasterRepository(runtime);

  const buildPatientDoc = (patient: MasterPatient) => ({
    data: () => patient,
  });

  const buildPatientPage = (start: number, count: number, labelPrefix = 'Paciente') =>
    Array.from({ length: count }, (_, index) =>
      buildPatientDoc({
        rut: `1.${String(start + index).padStart(3, '0')}.000-0`,
        fullName: `${labelPrefix} ${start + index}`,
        createdAt: 1,
        updatedAt: 1,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for invalid RUT on getPatientByRut', async () => {
    const result = await getPatientByRut('invalid');
    expect(result).toBeNull();
    expect(vi.mocked(firestore.getDoc)).not.toHaveBeenCalled();
  });

  it('upsertPatient skips invalid RUT without writing', async () => {
    const consoleSpies = suppressConsole(['warn']);

    try {
      await upsertPatient({ rut: 'invalid', fullName: 'Paciente' });
      expect(vi.mocked(firestore.setDoc)).not.toHaveBeenCalled();
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('upsertPatient writes normalized rut and updatedAt', async () => {
    vi.mocked(firestore.setDoc).mockResolvedValue(undefined as never);
    await upsertPatient({ rut: '12345678-5', fullName: 'Paciente A' });

    expect(vi.mocked(firestore.setDoc)).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(firestore.setDoc).mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        rut: '12.345.678-5',
        fullName: 'Paciente A',
        updatedAt: expect.any(Number),
      })
    );
  });

  it('bulkUpsertPatients filters invalid RUTs before commit', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn();
    vi.mocked(firestore.writeBatch).mockReturnValue({ set, commit } as never);

    const result = await bulkUpsertPatients([
      { rut: '12345678-5', fullName: 'Paciente A', createdAt: 1, updatedAt: 1 },
      { rut: 'invalid', fullName: 'Paciente B', createdAt: 1, updatedAt: 1 },
    ]);

    expect(set).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ successes: 1, errors: 1 });
  });

  it('sanitizes pagination limit', async () => {
    vi.mocked(firestore.getDocs).mockResolvedValue({ docs: [] } as never);
    await getPatientsPaginated(0);
    expect(vi.mocked(firestore.limit)).toHaveBeenCalledWith(20);

    await getPatientsPaginated(5000);
    expect(vi.mocked(firestore.limit)).toHaveBeenCalledWith(1000);
  });

  it('searchPatients trims search term and returns empty for whitespace input', async () => {
    const result = await searchPatients('   ');
    expect(result).toEqual([]);
    expect(vi.mocked(firestore.getDocs)).not.toHaveBeenCalled();
  });

  it('searchPatients keeps scanning past the first patient page for multi-word matches', async () => {
    const targetPatient: MasterPatient = {
      rut: '12.345.678-5',
      fullName: 'Inés Riroroko Leiva',
      createdAt: 1,
      updatedAt: 1,
    };

    vi.mocked(firestore.getDocs)
      .mockResolvedValueOnce({
        docs: buildPatientPage(1, 250, 'Paciente'),
      } as never)
      .mockResolvedValueOnce({
        docs: [buildPatientDoc(targetPatient)],
      } as never);

    const result = await searchPatients('Ines leiva');

    expect(result).toEqual([targetPatient]);
    expect(vi.mocked(firestore.getDocs)).toHaveBeenCalledTimes(2);
  });

  it('supports injected Firestore runtime for isolated repository composition', async () => {
    vi.mocked(firestore.setDoc).mockResolvedValue(undefined as never);

    await injectedRepository.upsertPatient({ rut: '12345678-5', fullName: 'Paciente Runtime' });

    expect(vi.mocked(firestore.doc)).toHaveBeenCalledWith(
      expect.anything(),
      'hospitals/hanga_roa/patients',
      '12.345.678-5'
    );
  });
});

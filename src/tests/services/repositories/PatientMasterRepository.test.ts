import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterPatient } from '@/types/domain/patientMaster';

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
  orderBy: vi.fn((_field: string, _direction: string) => ({
    field: _field,
    direction: _direction,
  })),
  limit: vi.fn((count: number) => ({ __limit: count })),
  startAfter: vi.fn((_doc: unknown) => ({ cursor: _doc })),
  getDocs: vi.fn(),
  where: vi.fn((_field: string, _op: string, _value: unknown) => ({ __where: true })),
}));

import * as firestore from 'firebase/firestore';
import { createPatientMasterRepository } from '@/services/repositories/PatientMasterRepository';

describe('PatientMasterRepository transport failures', () => {
  const repository = createPatientMasterRepository({ getDb: () => ({}) as never });
  const failure = new Error('synthetic unavailable');
  const target: MasterPatient = {
    rut: '12.345.678-5',
    fullName: 'Inés Riroroko Leiva',
    createdAt: 1,
    updatedAt: 1,
  };
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when the patient index read fails at the SDK boundary', async () => {
    vi.mocked(firestore.getDoc).mockImplementation(async ref => {
      if ((ref as unknown as { __id: string }).__id === target.rut) throw failure;
      throw new Error('Unexpected document');
    });
    await expect(repository.getPatientByRut(target.rut)).rejects.toBe(failure);
  });

  it('searchPatients still finds a patient by RUT when the direct index read fails', async () => {
    vi.mocked(firestore.getDoc).mockImplementation(async ref => {
      if ((ref as unknown as { __id: string }).__id === target.rut) throw failure;
      throw new Error('Unexpected document');
    });
    vi.mocked(firestore.getDocs).mockImplementation(async q => {
      const parts = (q as unknown as { __parts: Array<{ field?: string }> }).__parts;
      if (parts.some(part => part.field === 'fullName')) return { docs: [] } as never;
      if (parts.some(part => part.field === 'updatedAt'))
        return { docs: [{ data: () => target }] } as never;
      throw new Error('Unexpected query');
    });
    expect(await repository.searchPatients(target.rut)).toEqual([target]);
  });

  it('rejects an incomplete full scan instead of returning absence', async () => {
    vi.mocked(firestore.getDocs).mockImplementation(async q => {
      const parts = (q as unknown as { __parts: Array<{ cursor?: unknown; field?: string }> })
        .__parts;
      if (parts.some(part => part.cursor)) throw failure;
      if (parts.some(part => part.field === 'updatedAt'))
        return { docs: Array.from({ length: 250 }, () => ({ data: () => target })) } as never;
      throw new Error('Unexpected query');
    });
    await expect(repository.searchPatients('alfa beta')).rejects.toBe(failure);
  });
});

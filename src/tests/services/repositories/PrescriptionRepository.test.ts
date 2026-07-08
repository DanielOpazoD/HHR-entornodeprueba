import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    subscribeQuery: vi.fn(),
  },
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

import { firestoreDb } from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { PrescriptionRepository } from '@/services/repositories/PrescriptionRepository';

const buildRecord = (
  id: string,
  createdAt: string,
  overrides: Partial<PrescriptionRecord> = {}
): PrescriptionRecord => ({
  id,
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  bedId: 'H5C1',
  patientName: 'Paciente',
  patientRut: '11.111.111-1',
  image: {
    storagePath: `hospitals/hhr/prescriptions/${id}/full.jpg`,
    thumbnailStoragePath: `hospitals/hhr/prescriptions/${id}/thumb.jpg`,
    byteSize: 200_000,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'authenticated', uid: 'u1', email: 't@h.cl' },
  createdAt,
  expiresAt: '2999-01-01T00:00:00.000Z',
  ...overrides,
});

describe('PrescriptionRepository.list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('returns sorted records (newest first) and drops corrupt ones', async () => {
    const corrupt: Partial<PrescriptionRecord> = { id: 'broken' };
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([
      buildRecord('rx-old', '2026-04-01T10:00:00.000Z'),
      corrupt as PrescriptionRecord,
      buildRecord('rx-new', '2026-05-01T10:00:00.000Z'),
    ]);

    const result = await PrescriptionRepository.list('hhr');

    expect(result.map(r => r.id)).toEqual(['rx-new', 'rx-old']);
    expect(firestoreDb.getDocs).toHaveBeenCalledWith(
      'hospitals/hhr/prescriptions',
      expect.objectContaining({
        orderBy: [{ field: 'createdAt', direction: 'desc' }],
      })
    );
  });

  it('returns empty without querying when Firestore is disabled', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    expect(await PrescriptionRepository.list('hhr')).toEqual([]);
    expect(firestoreDb.getDocs).not.toHaveBeenCalled();
  });
});

describe('PrescriptionRepository.listByDateRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('issues a where-range query with the from/to bounds', async () => {
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([
      buildRecord('rx-1', '2026-05-04T10:00:00.000Z'),
    ]);

    const result = await PrescriptionRepository.listByDateRange(
      '2026-05-04T00:00:00.000Z',
      '2026-05-04T23:59:59.999Z',
      'hhr'
    );

    expect(result.map(r => r.id)).toEqual(['rx-1']);
    expect(firestoreDb.getDocs).toHaveBeenCalledWith(
      'hospitals/hhr/prescriptions',
      expect.objectContaining({
        where: [
          { field: 'createdAt', operator: '>=', value: '2026-05-04T00:00:00.000Z' },
          { field: 'createdAt', operator: '<=', value: '2026-05-04T23:59:59.999Z' },
        ],
      })
    );
  });
});

describe('PrescriptionRepository.reassignPatient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('writes the patch and returns the refreshed record', async () => {
    const updated = buildRecord('rx-1', '2026-05-04T10:00:00.000Z', {
      bedId: 'H5C2',
      patientName: 'Nuevo Paciente',
      patientRut: '22.222.222-2',
      patientReassignedAt: '2026-05-05T08:00:00.000Z',
      patientReassignedBy: 'admin@h.cl',
    });
    vi.mocked(firestoreDb.updateDoc).mockResolvedValueOnce(undefined);
    vi.mocked(firestoreDb.getDoc).mockResolvedValueOnce(updated);

    const result = await PrescriptionRepository.reassignPatient(
      'rx-1',
      {
        bedId: 'H5C2',
        patientName: 'Nuevo Paciente',
        patientRut: '22.222.222-2',
        reassignedBy: 'admin@h.cl',
        reassignedAt: '2026-05-05T08:00:00.000Z',
      },
      'hhr'
    );

    expect(result.bedId).toBe('H5C2');
    expect(firestoreDb.updateDoc).toHaveBeenCalledWith(
      'hospitals/hhr/prescriptions',
      'rx-1',
      expect.objectContaining({
        bedId: 'H5C2',
        patientName: 'Nuevo Paciente',
        patientRut: '22.222.222-2',
        patientReassignedAt: '2026-05-05T08:00:00.000Z',
        patientReassignedBy: 'admin@h.cl',
      })
    );
  });

  it('clears patient assignment when bedId/name/rut are omitted', async () => {
    const cleared = buildRecord('rx-2', '2026-05-04T10:00:00.000Z', {
      bedId: undefined,
      patientName: undefined,
      patientRut: undefined,
      patientReassignedAt: '2026-05-05T08:00:00.000Z',
      patientReassignedBy: 'admin@h.cl',
    });
    vi.mocked(firestoreDb.updateDoc).mockResolvedValueOnce(undefined);
    vi.mocked(firestoreDb.getDoc).mockResolvedValueOnce(cleared);

    await PrescriptionRepository.reassignPatient(
      'rx-2',
      {
        reassignedBy: 'admin@h.cl',
        reassignedAt: '2026-05-05T08:00:00.000Z',
      },
      'hhr'
    );

    expect(firestoreDb.updateDoc).toHaveBeenCalledWith(
      'hospitals/hhr/prescriptions',
      'rx-2',
      expect.objectContaining({
        bedId: null,
        patientName: null,
        patientRut: null,
      })
    );
  });

  it('persists explicit hospitalized stock assignment without patient fields', async () => {
    const stock = {
      ...buildRecord('rx-stock', '2026-05-04T10:00:00.000Z', {
        assignmentScope: 'hospitalized_stock',
        patientReassignedAt: '2026-05-05T08:00:00.000Z',
        patientReassignedBy: 'admin@h.cl',
      }),
      bedId: null,
      patientName: null,
      patientRut: null,
    } as unknown as PrescriptionRecord;
    vi.mocked(firestoreDb.updateDoc).mockResolvedValueOnce(undefined);
    vi.mocked(firestoreDb.getDoc).mockResolvedValueOnce(stock);

    const result = await PrescriptionRepository.reassignPatient(
      'rx-stock',
      {
        assignmentScope: 'hospitalized_stock',
        reassignedBy: 'admin@h.cl',
        reassignedAt: '2026-05-05T08:00:00.000Z',
      },
      'hhr'
    );

    expect(result.assignmentScope).toBe('hospitalized_stock');
    expect(result.bedId).toBeUndefined();
    expect(firestoreDb.updateDoc).toHaveBeenCalledWith(
      'hospitals/hhr/prescriptions',
      'rx-stock',
      expect.objectContaining({
        assignmentScope: 'hospitalized_stock',
        bedId: null,
        patientName: null,
        patientRut: null,
      })
    );
  });

  it('keeps stock records with Firestore null patient fields in list results', async () => {
    const stock = {
      ...buildRecord('rx-stock-list', '2026-05-04T10:00:00.000Z', {
        assignmentScope: 'hospitalized_stock',
      }),
      bedId: null,
      patientName: null,
      patientRut: null,
    } as unknown as PrescriptionRecord;
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([stock]);

    const result = await PrescriptionRepository.list('hhr');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'rx-stock-list',
      assignmentScope: 'hospitalized_stock',
    });
    expect(result[0].bedId).toBeUndefined();
  });
});

describe('PrescriptionRepository.delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('forwards to firestoreDb.deleteDoc', async () => {
    await PrescriptionRepository.delete('rx-1', 'hhr');
    expect(firestoreDb.deleteDoc).toHaveBeenCalledWith('hospitals/hhr/prescriptions', 'rx-1');
  });
});

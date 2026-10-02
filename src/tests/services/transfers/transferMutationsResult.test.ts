// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import {
  changeTransferStatusMutationWithResult,
  createTransferRequestMutationWithResult,
  deleteStatusHistoryEntryMutationWithResult,
} from '@/services/transfers/transferMutationsService';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ id: 'mock-collection' })),
  doc: vi.fn(() => ({ id: 'mock-doc-id' })),
  getDoc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  Timestamp: class {
    static now = () => ({ toDate: () => new Date('2026-02-20T00:00:00.000Z') });
  },
}));

vi.mock('@/firebaseConfig', () => ({ db: {} }));

vi.mock('@/services/transfers/transferLoggers', () => ({
  transferMutationsLogger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('transfer mutation results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns explicit not_found for missing transfers', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
    } as never);

    const result = await changeTransferStatusMutationWithResult(
      'missing',
      'RECEIVED',
      'user@test.cl'
    );

    expect(result.status).toBe('not_found');
    if (result.status !== 'success') {
      expect(result.userSafeMessage).toContain('ya no existe');
    }
  });

  it('returns success when creating a transfer', async () => {
    const result = await createTransferRequestMutationWithResult({
      patientId: 'p1',
      bedId: 'R1',
      patientSnapshot: {
        name: 'Paciente',
        rut: '1-9',
        age: 40,
        sex: 'F',
        diagnosis: 'Dx',
        admissionDate: '2026-03-15',
      },
      destinationHospital: 'Hospital Demo',
      transferReason: 'Motivo',
      requestingDoctor: 'Doctor',
      customFields: {},
      status: 'REQUESTED',
      requestDate: '2026-03-15',
      createdBy: 'admin@test.cl',
    } as never);

    expect(result.status).toBe('success');
  });

  it('returns conflict when deleting an invalid history entry', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        statusHistory: [{ to: 'REQUESTED' }],
      }),
    } as never);

    const result = await deleteStatusHistoryEntryMutationWithResult('tr-1', 0);
    expect(result.status).toBe('conflict');
    if (result.status !== 'success') {
      expect(result.userSafeMessage).toContain('estado actual');
    }
  });
});

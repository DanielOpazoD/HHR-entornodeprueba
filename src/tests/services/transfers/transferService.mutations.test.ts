// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as firestore from 'firebase/firestore';
import { deleteDoc, setDoc } from 'firebase/firestore';

import {
  completeTransferWithResult,
  createFinalizedTransferRequestWithResult,
} from '@/services/transfers/transferService';

vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  PatientMasterRepository: {
    bulkUpsertPatients: vi.fn(),
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'mock-doc-id' })),
  getDoc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn((_q, cb) => {
    cb({ docs: [] });
    return vi.fn();
  }),
  Timestamp: class {
    static now = () => ({ toDate: () => new Date('2026-02-20T00:00:00.000Z') });
    toDate() {
      return new Date('2026-02-20T00:00:00.000Z');
    }
  },
}));

vi.mock('@/services/firebase-runtime/firebaseConfig', () => ({
  db: {},
}));

vi.mock('@/services/transfers/transferLoggers', () => ({
  transferMutationsLogger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('transferService mutations', () => {
  type TransferInput = Parameters<typeof createFinalizedTransferRequestWithResult>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a finalized transfer directly in history for census-origin executed transfers', async () => {
    const result = await createFinalizedTransferRequestWithResult(
      {
        patientId: 'p1',
        bedId: 'R1',
        patientSnapshot: {
          name: 'Test Patient',
          rut: '12.345.678-9',
          age: '50',
          pathology: 'Test',
        },
        destination: 'Hospital Salvador',
        destinationHospital: 'Hospital Salvador',
        requestDate: '2025-01-10',
        priority: 'NORMAL',
        createdBy: 'admin@hospital.cl',
        transferType: 'TRASLADO',
        evacuationMethod: 'SAMU',
        specialRequirements: [],
      } as unknown as TransferInput,
      'admin@hospital.cl'
    );

    expect(result.status).toBe('success');
    expect(result.data?.status).toBe('TRANSFERRED');
    expect(result.data?.statusHistory.map(history => history.to)).toEqual([
      'REQUESTED',
      'TRANSFERRED',
    ]);
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('moves transfer to history and deletes from active on completeTransfer', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    const deleteDocMock = vi.mocked(firestore.deleteDoc);
    const setDocMock = vi.mocked(firestore.setDoc);

    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: 'RECEIVED', statusHistory: [] }),
    } as unknown as Awaited<ReturnType<typeof firestore.getDoc>>);

    const result = await completeTransferWithResult('TR-1', 'user-1');

    expect(result.status).toBe('success');
    expect(setDocMock).toHaveBeenCalled();
    expect(deleteDocMock).toHaveBeenCalled();
  });

  it('returns not_found with a readable message when the transfer to complete is missing', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce({
      exists: () => false,
    } as unknown as Awaited<ReturnType<typeof firestore.getDoc>>);

    const result = await completeTransferWithResult('TR-NONEXISTENT', 'user-1');

    expect(result.status).toBe('not_found');
    if (result.status !== 'success') {
      expect(result.userSafeMessage).toContain('ya no existe o fue movida');
    }
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as firestore from 'firebase/firestore';
import { deleteDoc, getDoc, setDoc } from 'firebase/firestore';

import {
  changeTransferStatus,
  completeTransfer,
  createFinalizedTransferRequestWithResult,
  createTransferRequest,
  deleteStatusHistoryEntry,
  deleteTransferRequest,
  updateTransferRequest,
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
  onSnapshot: vi.fn((q, cb) => {
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

vi.mock('@/firebaseConfig', () => ({
  db: {},
}));

vi.mock('@/services/transfers/transferLoggers', () => ({
  transferMutationsLogger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('transferService mutations', () => {
  type TransferInput = Parameters<typeof createTransferRequest>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setDoc when creating a transfer', async () => {
    await expect(
      createTransferRequest({
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
      } as unknown as TransferInput)
    ).resolves.toBeDefined();

    expect(setDoc).toHaveBeenCalled();
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

  it('calls setDoc with merge option on updateTransferRequest', async () => {
    await updateTransferRequest('transfer-123', {
      observations: 'Updated notes',
    });

    expect(setDoc).toHaveBeenCalled();
  });

  it('calls getDoc and setDoc on changeTransferStatus', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        status: 'RECEIVED',
        observations: 'Urgent transfer',
        statusHistory: [],
      }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>);

    await changeTransferStatus('transfer-123', 'RECEIVED', 'user@hospital.cl');

    expect(getDoc).toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalled();
  });

  it('throws if transfer is missing on changeTransferStatus', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
    } as unknown as Awaited<ReturnType<typeof getDoc>>);

    await expect(
      changeTransferStatus('non-existent', 'RECEIVED', 'user@hospital.cl')
    ).rejects.toThrow('ya no existe o fue movida');
  });

  it('calls deleteDoc on deleteTransferRequest', async () => {
    await deleteTransferRequest('transfer-to-delete');

    expect(deleteDoc).toHaveBeenCalled();
  });

  it('moves transfer to history and deletes from active on completeTransfer', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    const deleteDocMock = vi.mocked(firestore.deleteDoc);
    const setDocMock = vi.mocked(firestore.setDoc);

    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: 'RECEIVED', statusHistory: [] }),
    } as unknown as Awaited<ReturnType<typeof firestore.getDoc>>);

    await completeTransfer('TR-1', 'user-1');

    expect(setDocMock).toHaveBeenCalled();
    expect(deleteDocMock).toHaveBeenCalled();
  });

  it('throws if transfer is missing on completeTransfer', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce({
      exists: () => false,
    } as unknown as Awaited<ReturnType<typeof firestore.getDoc>>);

    await expect(completeTransfer('TR-NONEXISTENT', 'user-1')).rejects.toThrow(
      'ya no existe o fue movida'
    );
  });

  it('removes history entry and reverts status on deleteStatusHistoryEntry', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    const setDocMock = vi.mocked(firestore.setDoc);

    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        status: 'RECEIVED',
        statusHistory: [{ to: 'REQUESTED' }, { to: 'RECEIVED' }],
      }),
    } as unknown as Awaited<ReturnType<typeof firestore.getDoc>>);

    await deleteStatusHistoryEntry('TR-1', 1);

    expect(setDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'REQUESTED' }),
      expect.anything()
    );
  });

  it('throws when trying to delete the first history entry', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ statusHistory: [{ to: 'REQUESTED' }] }),
    } as unknown as Awaited<ReturnType<typeof firestore.getDoc>>);

    await expect(deleteStatusHistoryEntry('TR-1', 0)).rejects.toThrow('estado actual del traslado');
  });
});

// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc, getDocs } from 'firebase/firestore';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((collectionRef: unknown, id: string) => ({ collectionRef, id })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
  query: vi.fn((...args: unknown[]) => ({ args })),
  where: vi.fn((field: string, op: string, value: string) => ({ field, op, value })),
}));

vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: {
    getDb: () => ({}),
    ready: Promise.resolve(),
  },
}));

vi.mock('@/services/transfers/transferFirestoreCollections', () => ({
  getTransfersCollection: vi.fn(() => 'active-transfers'),
  getTransferHistoryCollection: vi.fn(() => 'history-transfers'),
}));

vi.mock('@/services/transfers/transferSerializationController', () => ({
  querySnapshotToTransfers: vi.fn(() => [{ id: 'tr-active' }]),
  pickLatestOpenTransferFromSnapshot: vi.fn(() => ({ id: 'tr-open' })),
  transferDocToEntity: vi.fn((data: Record<string, unknown>, id: string) => ({ id, ...data })),
}));

import {
  getActiveTransfersQuery,
  getLatestOpenTransferRequestByBedIdQuery,
  getLatestOpenTransferRequestByPatientRutQuery,
  getTransferByIdQuery,
} from '@/services/transfers/transferQueriesService';

describe('transferQueriesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads active transfers through the serialized snapshot path', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);

    await expect(getActiveTransfersQuery()).resolves.toEqual([{ id: 'tr-active' }]);
  });

  it('resolves a transfer from active records first, then history, then null', async () => {
    vi.mocked(getDoc)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ status: 'REQUESTED' }),
      } as never)
      .mockResolvedValueOnce({
        exists: () => false,
      } as never)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ status: 'TRANSFERRED' }),
      } as never)
      .mockResolvedValueOnce({
        exists: () => false,
      } as never)
      .mockResolvedValueOnce({
        exists: () => false,
      } as never);

    await expect(getTransferByIdQuery('tr-1')).resolves.toEqual({
      id: 'tr-1',
      status: 'REQUESTED',
    });
    await expect(getTransferByIdQuery('tr-2')).resolves.toEqual({
      id: 'tr-2',
      status: 'TRANSFERRED',
    });
    await expect(getTransferByIdQuery('tr-3')).resolves.toBeNull();
  });

  it('resolves latest open transfers by bed and patient rut, short-circuiting blank RUTs', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);

    await expect(getLatestOpenTransferRequestByBedIdQuery('R1')).resolves.toEqual({
      id: 'tr-open',
    });
    await expect(getLatestOpenTransferRequestByPatientRutQuery('  ')).resolves.toBeNull();
    await expect(getLatestOpenTransferRequestByPatientRutQuery('1-9')).resolves.toEqual({
      id: 'tr-open',
    });
  });
});

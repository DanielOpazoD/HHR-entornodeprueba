import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as firestore from 'firebase/firestore';
import { getDoc } from 'firebase/firestore';

import {
  getActiveTransfers,
  getLatestOpenTransferRequestByBedId,
  getLatestOpenTransferRequestByPatientRut,
  getTransferById,
  subscribeToTransfers,
} from '@/services/transfers/transferService';
import type { TransferRequest } from '@/types/transferRequestTypes';

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

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';

describe('transferService queries and subscriptions', () => {
  const flushAsyncSubscription = async () => {
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('returns null when getTransferById does not find an active transfer', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
    } as unknown as Awaited<ReturnType<typeof getDoc>>);

    const transfer = await getTransferById('non-existent');

    expect(transfer).toBeNull();
  });

  it('falls back to history collection when active transfer is missing', async () => {
    vi.mocked(getDoc)
      .mockResolvedValueOnce({
        exists: () => false,
      } as unknown as Awaited<ReturnType<typeof getDoc>>)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          status: 'TRANSFERRED',
          requestDate: '2025-01-01',
          createdAt: '2025-01-01T10:00:00.000Z',
          updatedAt: '2025-01-02T10:00:00.000Z',
          statusHistory: [],
        }),
      } as unknown as Awaited<ReturnType<typeof getDoc>>);

    const transfer = await getTransferById('archived-transfer');

    expect(transfer?.id).toBe('archived-transfer');
    expect(transfer?.status).toBe('TRANSFERRED');
  });

  it('returns an unsubscribe function for subscribeToTransfers', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToTransfers(callback);

    expect(typeof unsubscribe).toBe('function');
  });

  it('calls the callback with transfers array in subscribeToTransfers', async () => {
    const callback = vi.fn();
    subscribeToTransfers(callback);
    await flushAsyncSubscription();

    expect(callback).toHaveBeenCalledWith([]);
  });

  it('merges active and history transfers in subscription', async () => {
    const onSnapshotMock = vi.mocked(firestore.onSnapshot);
    const callbacks: Array<
      (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void
    > = [];
    onSnapshotMock.mockImplementation((_q, next) => {
      if (typeof next !== 'function') return vi.fn();
      callbacks.push(next);
      return vi.fn();
    });

    let latest: TransferRequest[] = [];
    subscribeToTransfers(t => {
      latest = t;
    });
    await flushAsyncSubscription();

    callbacks[0]?.({
      docs: [
        {
          id: 'TR-ACTIVE',
          data: () => ({ status: 'REQUESTED', requestDate: '2025-01-01', statusHistory: [] }),
        },
      ],
    });
    callbacks[1]?.({
      docs: [
        {
          id: 'TR-CLOSED',
          data: () => ({
            status: 'TRANSFERRED',
            requestDate: '2025-01-01',
            statusHistory: [{ timestamp: '2025-01-01T10:00:00Z' }],
          }),
        },
      ],
    });

    expect(latest.some(t => t.id === 'TR-ACTIVE')).toBe(true);
    expect(latest.some(t => t.id === 'TR-CLOSED')).toBe(true);
  });

  it('includes history transfers even without status history', async () => {
    const onSnapshotMock = vi.mocked(firestore.onSnapshot);
    const callbacks: Array<
      (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void
    > = [];
    onSnapshotMock.mockImplementation((_q, next) => {
      if (typeof next !== 'function') return vi.fn();
      callbacks.push(next);
      return vi.fn();
    });

    let latest: TransferRequest[] = [];
    subscribeToTransfers(t => {
      latest = t;
    });
    await flushAsyncSubscription();

    callbacks[0]?.({ docs: [] });
    callbacks[1]?.({
      docs: [
        {
          id: 'TR-NO-HISTORY',
          data: () => ({ status: 'TRANSFERRED', requestDate: '2025-01-01' }),
        },
      ],
    });

    expect(latest.map(t => t.id)).toContain('TR-NO-HISTORY');
  });

  it('handles subscription errors', async () => {
    const onSnapshotMock = vi.mocked(firestore.onSnapshot);
    const callback = vi.fn();
    const onError = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let subscriptionCall = 0;
    onSnapshotMock.mockImplementation((...args: unknown[]) => {
      const onErrorCallback = args[2];
      if (subscriptionCall === 0 && typeof onErrorCallback === 'function') {
        (onErrorCallback as (error: Error) => void)(new Error('Sub error'));
      } else {
        const onNext = args[1];
        if (typeof onNext === 'function') {
          (onNext as (snapshot: { docs: [] }) => void)({ docs: [] });
        }
      }
      subscriptionCall += 1;
      return vi.fn();
    });

    subscribeToTransfers(callback, { onError });
    await flushAsyncSubscription();

    expect(callback).toHaveBeenCalledWith([]);
    expect(onError).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('fetches and returns active transfers', async () => {
    const getDocsMock = vi.mocked(firestore.getDocs);
    getDocsMock.mockResolvedValueOnce({
      docs: [{ id: 'TR-1', data: () => ({ status: 'SENT', requestDate: '2025-01-01' }) }],
    } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>);

    const results = await getActiveTransfers();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('RECEIVED');
  });

  it('returns the most recent non-closed transfer request for the bed', async () => {
    const getDocsMock = vi.mocked(firestore.getDocs);
    getDocsMock.mockResolvedValueOnce({
      docs: [
        {
          id: 'TR-CLOSED',
          data: () => ({
            bedId: 'BED_1',
            status: 'TRANSFERRED',
            archived: false,
            requestDate: '2026-02-01',
            updatedAt: '2026-02-01T10:00:00.000Z',
            createdAt: '2026-02-01T09:00:00.000Z',
            statusHistory: [],
          }),
        },
        {
          id: 'TR-OPEN-OLD',
          data: () => ({
            bedId: 'BED_1',
            status: 'REQUESTED',
            archived: false,
            requestDate: '2026-02-02',
            updatedAt: '2026-02-02T10:00:00.000Z',
            createdAt: '2026-02-02T09:00:00.000Z',
            statusHistory: [],
          }),
        },
        {
          id: 'TR-OPEN-NEW',
          data: () => ({
            bedId: 'BED_1',
            status: 'ACCEPTED',
            archived: false,
            requestDate: '2026-02-03',
            updatedAt: '2026-02-03T10:00:00.000Z',
            createdAt: '2026-02-03T09:00:00.000Z',
            statusHistory: [],
          }),
        },
      ],
    } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>);

    const result = await getLatestOpenTransferRequestByBedId('BED_1');
    expect(result?.id).toBe('TR-OPEN-NEW');
  });

  it('scopes open transfer lookup by request month when a reference date is provided', async () => {
    const getDocsMock = vi.mocked(firestore.getDocs);
    getDocsMock.mockResolvedValueOnce({
      docs: [
        {
          id: 'TR-OLD-MONTH',
          data: () => ({
            bedId: 'BED_1',
            status: 'ACCEPTED',
            archived: false,
            requestDate: '2026-02-28',
            updatedAt: '2026-02-28T10:00:00.000Z',
            createdAt: '2026-02-28T09:00:00.000Z',
            statusHistory: [],
          }),
        },
        {
          id: 'TR-SAME-MONTH',
          data: () => ({
            bedId: 'BED_1',
            status: 'REQUESTED',
            archived: false,
            requestDate: '2026-03-02',
            updatedAt: '2026-03-02T10:00:00.000Z',
            createdAt: '2026-03-02T09:00:00.000Z',
            statusHistory: [],
          }),
        },
      ],
    } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>);

    const result = await getLatestOpenTransferRequestByBedId('BED_1', {
      referenceDate: '2026-03-03',
    });
    expect(result?.id).toBe('TR-SAME-MONTH');
  });

  it('returns null when there are no open requests for the bed', async () => {
    const getDocsMock = vi.mocked(firestore.getDocs);
    getDocsMock.mockResolvedValueOnce({
      docs: [
        {
          id: 'TR-ARCHIVED',
          data: () => ({
            bedId: 'BED_2',
            status: 'REQUESTED',
            archived: true,
            requestDate: '2026-02-01',
            updatedAt: '2026-02-01T10:00:00.000Z',
            createdAt: '2026-02-01T09:00:00.000Z',
            statusHistory: [],
          }),
        },
        {
          id: 'TR-REJECTED',
          data: () => ({
            bedId: 'BED_2',
            status: 'REJECTED',
            archived: false,
            requestDate: '2026-02-01',
            updatedAt: '2026-02-01T10:00:00.000Z',
            createdAt: '2026-02-01T09:00:00.000Z',
            statusHistory: [],
          }),
        },
      ],
    } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>);

    const result = await getLatestOpenTransferRequestByBedId('BED_2');
    expect(result).toBeNull();
  });

  it('returns the most recent non-closed transfer request for the patient rut', async () => {
    const getDocsMock = vi.mocked(firestore.getDocs);
    getDocsMock.mockResolvedValueOnce({
      docs: [
        {
          id: 'TR-OLD',
          data: () => ({
            bedId: 'BED_1',
            patientSnapshot: { rut: '12.345.678-9' },
            status: 'REQUESTED',
            archived: false,
            requestDate: '2026-02-02',
            updatedAt: '2026-02-02T10:00:00.000Z',
            createdAt: '2026-02-02T09:00:00.000Z',
            statusHistory: [],
          }),
        },
        {
          id: 'TR-NEW',
          data: () => ({
            bedId: 'BED_9',
            patientSnapshot: { rut: '12.345.678-9' },
            status: 'ACCEPTED',
            archived: false,
            requestDate: '2026-02-03',
            updatedAt: '2026-02-03T10:00:00.000Z',
            createdAt: '2026-02-03T09:00:00.000Z',
            statusHistory: [],
          }),
        },
      ],
    } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>);

    const result = await getLatestOpenTransferRequestByPatientRut('12.345.678-9');
    expect(result?.id).toBe('TR-NEW');
  });

  it('returns null when patient rut is empty', async () => {
    const result = await getLatestOpenTransferRequestByPatientRut('   ');
    expect(result).toBeNull();
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('skips transfer lookup queries when Firestore is disabled', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);

    await expect(getActiveTransfers()).resolves.toEqual([]);
    await expect(getTransferById('TR-1')).resolves.toBeNull();
    await expect(getLatestOpenTransferRequestByBedId('BED_1')).resolves.toBeNull();
    await expect(getLatestOpenTransferRequestByPatientRut('12.345.678-9')).resolves.toBeNull();

    expect(firestore.getDocs).not.toHaveBeenCalled();
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });
});

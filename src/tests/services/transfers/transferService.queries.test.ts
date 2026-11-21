// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as firestore from 'firebase/firestore';

import {
  getLatestOpenTransferRequestByBedId,
  getLatestOpenTransferRequestByPatientRut,
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

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';

describe('transferService queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
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

    await expect(getLatestOpenTransferRequestByBedId('BED_1')).resolves.toBeNull();
    await expect(getLatestOpenTransferRequestByPatientRut('12.345.678-9')).resolves.toBeNull();

    expect(firestore.getDocs).not.toHaveBeenCalled();
  });
});

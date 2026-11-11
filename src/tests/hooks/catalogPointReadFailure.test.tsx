import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogRecord } from '@/services/storage/indexeddb/indexedDbCatalogContracts';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';

vi.unmock('@/services/repositories/CatalogRepository');
vi.mock('@/services/storage/indexeddb/indexedDbCore', async () => {
  const db = new Dexie('catalog-point-read-synthetic');
  db.version(1).stores({ catalogs: 'id' });
  return { hospitalDB: db, ensureDbReady: () => db.open() };
});
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));
vi.mock('@/services/storage/firestore', () => ({
  getNurseCatalogFromFirestore: vi.fn(async () => []),
  getTensCatalogFromFirestore: vi.fn(async () => []),
  getProfessionalsCatalogFromFirestore: vi.fn(async () => []),
  saveNurseCatalogToFirestore: vi.fn(),
  saveTensCatalogToFirestore: vi.fn(),
  saveProfessionalsCatalogToFirestore: vi.fn(),
  subscribeToNurseCatalog: vi.fn(() => () => {}),
  subscribeToTensCatalog: vi.fn(() => () => {}),
  subscribeToProfessionalsCatalog: vi.fn(() => () => {}),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ remoteSyncStatus: 'disabled' }) }));
vi.mock('@/hooks/useEloisaStaff', () => ({ useEloisaStaff: () => [] }));
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getCatalogValues } from '@/services/storage/indexeddb/indexedDbCatalogService';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import * as remote from '@/services/storage/firestore';
import {
  useNursesQuery,
  useTensQuery,
  useProfessionalsQuery,
  useSaveNursesMutation,
  useSaveTensMutation,
  useSaveProfessionalsMutation,
} from '@/hooks/useStaffQuery';
import { useTreatingPhysicianCatalogSync } from '@/features/rayen-import/hooks/useTreatingPhysicianCatalogSync';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

const catalogs: Table<CatalogRecord> = hospitalDB.table('catalogs');
const failure = new Error('synthetic catalog unavailable');
const snapshot: RayenCensusSnapshot = {
  capturedAt: '2026-07-31T12:00:00.000Z',
  facilityId: 1342,
  encounters: [],
  physicians: [{ practitionerId: 'synthetic-1', displayName: 'Synthetic Physician' }],
};
const cases = [
  {
    key: 'nurses',
    query: useNursesQuery,
    mutation: useSaveNursesMutation,
    read: remote.getNurseCatalogFromFirestore,
    save: remote.saveNurseCatalogToFirestore,
    replacement: ['Synthetic Nurse'],
    defaults: ['Enfermero/a 1', 'Enfermero/a 2'],
  },
  {
    key: 'tens',
    query: useTensQuery,
    mutation: useSaveTensMutation,
    read: remote.getTensCatalogFromFirestore,
    save: remote.saveTensCatalogToFirestore,
    replacement: ['Synthetic TENS'],
    defaults: ['TENS 1', 'TENS 2', 'TENS 3'],
  },
];

describe('catalog point reads through repository and queries', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
    await hospitalDB.open();
    await catalogs.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('distinguishes a genuinely empty local catalog from a failed Dexie read', async () => {
    await expect(getCatalogValues('professionals')).resolves.toEqual([]);
    await catalogs.put({
      id: 'professionals',
      list: [{ name: 'Synthetic Known', phone: '', specialty: 'Cirugía' }],
      lastUpdated: 'synthetic',
    });
    // A real Dexie read rejects when its reading hook fails; no mocked get().
    const failRead = () => {
      throw failure;
    };
    catalogs.hook('reading', failRead);
    try {
      await expect(getCatalogValues('professionals')).rejects.toBe(failure);
    } finally {
      catalogs.hook('reading').unsubscribe(failRead);
    }
    expect((await getCatalogValues('professionals'))[0]).toMatchObject({ specialty: 'Cirugía' });
  });

  for (const entry of cases) {
    it(`${entry.key}: remote failure is query error and cannot save default names`, async () => {
      vi.mocked(entry.read).mockRejectedValueOnce(failure);
      const { wrapper } = createQueryClientTestWrapper();
      const { result } = renderHook(() => ({ query: entry.query(), save: entry.mutation() }), {
        wrapper,
      });
      await waitFor(() => expect(result.current.query.isFetching).toBe(false));
      expect(result.current.query.error).toBe(failure);
      expect(result.current.query.isSuccess).toBe(false);
      expect(result.current.query.data).toEqual([]);
      await act(async () => {
        await expect(result.current.save.mutateAsync(entry.replacement)).rejects.toThrow();
      });
      expect(entry.save).not.toHaveBeenCalled();
      expect(await catalogs.get(entry.key)).toBeUndefined();
    });
    it(`${entry.key}: first load without Firestore still offers defaults and permits configuration`, async () => {
      vi.mocked(isFirestoreEnabled).mockReturnValue(false);
      const { wrapper } = createQueryClientTestWrapper();
      const { result } = renderHook(() => ({ query: entry.query(), save: entry.mutation() }), {
        wrapper,
      });
      await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
      expect(result.current.query.data).toEqual(entry.defaults);
      await act(async () => {
        await result.current.save.mutateAsync(entry.replacement);
      });
      expect((await catalogs.get(entry.key))?.list).toEqual(entry.replacement);
    });
  }

  for (const source of ['remote', 'local', 'both']) {
    it(`${source} failure prevents automatic physician merge and manual replacement`, async () => {
      if (source !== 'local')
        vi.mocked(remote.getProfessionalsCatalogFromFirestore).mockRejectedValueOnce(failure);
      const failRead = () => {
        throw failure;
      };
      if (source !== 'remote') catalogs.hook('reading', failRead);
      try {
        const { wrapper } = createQueryClientTestWrapper();
        const { result } = renderHook(
          () => ({
            query: useProfessionalsQuery(),
            sync: useTreatingPhysicianCatalogSync(),
            save: useSaveProfessionalsMutation(),
          }),
          { wrapper }
        );
        await waitFor(() => expect(result.current.query.isFetching).toBe(false));
        expect(result.current.query.error).toBe(failure);
        act(() => {
          expect(result.current.sync(snapshot)).toBe(snapshot);
        });
        await act(async () => {
          await expect(
            result.current.save.mutateAsync([{ name: 'Replacement', phone: '' }])
          ).rejects.toThrow();
        });
        expect(remote.saveProfessionalsCatalogToFirestore).not.toHaveBeenCalled();
      } finally {
        catalogs.hook('reading').unsubscribe(failRead);
      }
      expect(await catalogs.get('professionals')).toBeUndefined();
    });
  }

  it('does not persist an automatic merge after a remote read failure', async () => {
    vi.mocked(remote.getProfessionalsCatalogFromFirestore).mockRejectedValueOnce(failure);
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(
      () => ({ query: useProfessionalsQuery(), sync: useTreatingPhysicianCatalogSync() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.query.isFetching).toBe(false));
    act(() => {
      result.current.sync(snapshot);
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(remote.saveProfessionalsCatalogToFirestore).not.toHaveBeenCalled();
    expect(await catalogs.get('professionals')).toBeUndefined();
  });

  for (const entry of cases) {
    it(`${entry.key}: rejects manual replacement without a successfully read catalog`, async () => {
      const { wrapper } = createQueryClientTestWrapper();
      const { result } = renderHook(() => entry.mutation(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync(entry.replacement)).rejects.toThrow();
      });
      expect(await catalogs.count()).toBe(0);
    });
  }

  it('professionals: rejects manual replacement without a successfully read catalog', async () => {
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(() => useSaveProfessionalsMutation(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync([])).rejects.toThrow();
    });
    expect(await catalogs.count()).toBe(0);
  });

  it('a genuinely empty professionals catalog permits initial discovery', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(
      () => ({ query: useProfessionalsQuery(), sync: useTreatingPhysicianCatalogSync() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual([]);
    act(() => {
      result.current.sync(snapshot);
    });
    await waitFor(async () =>
      expect((await catalogs.get('professionals'))?.list).toEqual([
        expect.objectContaining({ name: 'Synthetic Physician' }),
      ])
    );
  });

  it('keeps the last known list and specialty after refetch failure', async () => {
    const known = [{ name: 'Synthetic Known', phone: '', specialty: 'Cirugía' }];
    await catalogs.put({ id: 'professionals', list: known, lastUpdated: 'synthetic' });
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(() => useProfessionalsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const failRead = () => {
      throw failure;
    };
    catalogs.hook('reading', failRead);
    try {
      await act(async () => {
        await result.current.refetch();
      });
      await waitFor(() => expect(result.current.error).toBe(failure));
      expect(result.current.data).toEqual(known);
    } finally {
      catalogs.hook('reading').unsubscribe(failRead);
    }
  });

  for (const subscribe of [
    CatalogRepository.subscribeNurses,
    CatalogRepository.subscribeTens,
    CatalogRepository.subscribeProfessionals,
  ]) {
    it('routes local subscription failure to onError without publishing an empty list', async () => {
      vi.mocked(isFirestoreEnabled).mockReturnValue(false);
      const failRead = () => {
        throw failure;
      };
      await catalogs.bulkPut(
        ['nurses', 'tens', 'professionals'].map(id => ({ id, list: [], lastUpdated: 'synthetic' }))
      );
      catalogs.hook('reading', failRead);
      const onData = vi.fn();
      const onError = vi.fn();
      const unsubscribe = subscribe(onData, onError);
      try {
        await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
        expect(onData).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
        catalogs.hook('reading').unsubscribe(failRead);
      }
    });
  }
});

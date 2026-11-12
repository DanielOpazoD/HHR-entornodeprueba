import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.unmock('@/services/repositories/CatalogRepository');
vi.mock(
  '@/services/storage/firestore',
  async () => import('@/services/storage/firestore/firestoreCatalogService')
);
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { getDb: () => ({}), ready: Promise.resolve() },
}));
vi.mock('@/hooks/useEloisaStaff', () => ({ useEloisaStaff: () => [] }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ remoteSyncStatus: 'ready' }) }));
vi.mock('@/services/auth/sessionPermissionStormDetector', () => ({
  reportBasicReadPermissionDenied: vi.fn(),
}));

import { onSnapshot, doc, setDoc, runTransaction } from 'firebase/firestore';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import { useNursesQuery, useTensQuery, useProfessionalsQuery } from '@/hooks/useStaffQuery';
import { normalizeProfessionalCatalog } from '@/services/repositories/contracts/catalogContracts';
import { queryKeys } from '@/config/queryClient';

const listeners = new Map<
  string,
  {
    next: (snapshot: unknown) => void;
    error: (error: unknown) => void;
  }
>();
const professionals = normalizeProfessionalCatalog([
  { name: 'Profesional sintético', specialty: 'Pediatría', rayenPractitionerId: 'synthetic-1' },
]);
const catalogs = [
  { key: 'nurses', docId: 'nurses', list: ['Enfermería sintética A', 'Enfermería sintética B'] },
  { key: 'tens', docId: 'tens', list: ['TENS sintético A', 'TENS sintético B'] },
  { key: 'professionals', docId: 'professionals_catalog', list: professionals },
];
let client: QueryClient;
const stops: (() => void)[] = [];

beforeEach(async () => {
  listeners.clear();
  vi.mocked(runTransaction).mockImplementation(async (_db, update) =>
    update({
      get: async () => ({ exists: () => true, data: () => ({ list: professionals }) }),
      set: setDoc,
    } as never)
  );
  await hospitalDB.catalogs.clear();
  vi.mocked(doc).mockImplementation((_db, ...segments) => ({ id: segments.at(-1) }) as never);
  vi.mocked(onSnapshot).mockImplementation((...args: unknown[]) => {
    const ref = args[0] as { id: string };
    listeners.set(ref.id, {
      next: args[2] as (snapshot: unknown) => void,
      error: args[3] as (error: unknown) => void,
    });
    return vi.fn();
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  stops.splice(0).forEach(stop => stop());
  client.clear();
  vi.restoreAllMocks();
});

const mount = async () => {
  const hook = renderHook(
    () => ({
      nurses: { ...useNursesQuery() },
      tens: { ...useTensQuery() },
      professionals: { ...useProfessionalsQuery() },
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );
  stops.push(hook.unmount);
  await waitFor(() => expect(listeners.size).toBe(3));
  await waitFor(() => expect(hook.result.current.professionals.isSuccess).toBe(true));
  return hook;
};
const emit = async (empty = false) => {
  act(() => {
    catalogs.forEach(catalog =>
      listeners.get(catalog.docId)!.next({
        metadata: { hasPendingWrites: false },
        exists: () => true,
        data: () => ({ list: empty ? [] : catalog.list }),
      })
    );
  });
  await waitFor(() =>
    catalogs.forEach(catalog =>
      expect(client.getQueryData([...queryKeys.staff.all, catalog.key])).toEqual(
        empty ? [] : catalog.list
      )
    )
  );
};

describe('catalog subscriptions through IndexedDB and staff queries', () => {
  it.each(['unavailable', 'permission-denied'])(
    'keeps last known catalogs after %s and saves from that base',
    async code => {
      const hook = await mount();
      await emit();
      await waitFor(() => expect(hook.result.current.professionals.data).toEqual(professionals));
      const put = vi.spyOn(hospitalDB.catalogs, 'put');
      act(() =>
        listeners.forEach(listener =>
          listener.error(Object.assign(new Error('synthetic'), { code }))
        )
      );
      // Drain any erroneous persistence before checking both durable and published copies.
      await act(async () => {
        await hospitalDB.catalogs.toArray();
      });
      for (const catalog of catalogs) {
        expect((await hospitalDB.catalogs.get(catalog.key))?.list).toEqual(catalog.list);
        expect(client.getQueryData([...queryKeys.staff.all, catalog.key])).toEqual(catalog.list);
      }
      expect(put).not.toHaveBeenCalled();
      expect(hook.result.current.nurses.data).toEqual(catalogs[0].list);
      expect(hook.result.current.tens.data).toEqual(catalogs[1].list);
      expect(hook.result.current.professionals.data).toEqual(professionals);
      await CatalogRepository.saveProfessionals(
        [
          ...hook.result.current.professionals.data!,
          { name: 'Nuevo sintético', phone: '', specialty: 'Cirugía' },
        ],
        professionals
      );
      expect(vi.mocked(setDoc)).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          list: expect.arrayContaining([
            expect.objectContaining({ rayenPractitionerId: 'synthetic-1', specialty: 'Pediatría' }),
          ]),
        })
      );
    }
  );

  it.each(['unavailable', 'permission-denied'])(
    'delivers %s through repository onError only and accepts a replacement subscription',
    async code => {
      const onData = vi.fn();
      const onError = vi.fn();
      const subscriptions = [
        CatalogRepository.subscribeNurses,
        CatalogRepository.subscribeTens,
        CatalogRepository.subscribeProfessionals,
      ];
      const unsubscribe = subscriptions.map(subscribe => subscribe(onData, onError));
      await waitFor(() => expect(listeners.size).toBe(3));
      const error = Object.assign(new Error('synthetic'), { code });
      listeners.forEach(listener => listener.error(error));
      expect(onError).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenCalledWith(error);
      expect(onData).not.toHaveBeenCalled();
      unsubscribe.forEach(stop => stop());
      listeners.clear();
      vi.mocked(runTransaction).mockImplementation(async (_db, update) =>
        update({
          get: async () => ({ exists: () => true, data: () => ({ list: professionals }) }),
          set: setDoc,
        } as never)
      );
      const hook = await mount();
      await emit();
      await waitFor(() => expect(hook.result.current.professionals.data).toEqual(professionals));
    }
  );

  it('publishes and persists a genuinely empty server list, then accepts a new subscription snapshot', async () => {
    await mount();
    await emit();
    await emit(true);
    for (const catalog of catalogs)
      expect((await hospitalDB.catalogs.get(catalog.key))?.list).toEqual([]);
    await emit();
  });

  it.each(['unavailable', 'permission-denied'])(
    'does not persist an empty list on initial %s failure',
    async code => {
      await mount();
      const before = catalogs.map(catalog =>
        client.getQueryData([...queryKeys.staff.all, catalog.key])
      );
      const put = vi.spyOn(hospitalDB.catalogs, 'put');
      act(() =>
        listeners.forEach(listener =>
          listener.error(Object.assign(new Error('synthetic'), { code }))
        )
      );
      await act(async () => {
        await hospitalDB.catalogs.toArray();
      });
      expect(put).not.toHaveBeenCalled();
      expect(await hospitalDB.catalogs.count()).toBe(0);
      expect(
        catalogs.map(catalog => client.getQueryData([...queryKeys.staff.all, catalog.key]))
      ).toEqual(before);
    }
  );
});

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/context/AuthContext';
import { useTreatingPhysicianCatalogSync } from '@/features/rayen-import/hooks/useTreatingPhysicianCatalogSync';
import {
  useProfessionalsQuery,
  useSaveNursesMutation,
  useSaveProfessionalsMutation,
  useSaveTensMutation,
} from '@/hooks/useStaffQuery';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import { CatalogConflictError } from '@/services/repositories/contracts/catalogChanges';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

vi.mock('@/services/repositories/CatalogRepository');
vi.mock('@/hooks/useEloisaStaff', () => ({ useEloisaStaff: () => [] }));
vi.mock('@/context/AuthContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/context/AuthContext')>()),
  useAuth: vi.fn(),
}));

/**
 * W14-CAT1 — a catalog save answered after its session ended must not refill the catalog cache
 * that logout cleared. The Rayen preview used to save A's discovered physician; its late answer
 * wrote A's list into the shared cache, and B opened the catalog without reading it. The hooks are
 * the shipped ones; only the repository's answer is held.
 */
const storageFrame = document.createElement('iframe');
document.body.append(storageFrame);
const local = storageFrame.contentWindow!.localStorage;
const session = storageFrame.contentWindow!.sessionStorage;
afterAll(() => storageFrame.remove());

const A_PHYSICIAN: ProfessionalCatalogItem = {
  name: 'PROFESIONAL SINTETICO A',
  phone: '',
  rayenPractitionerId: 'synthetic-A',
  source: 'rayen',
};
const B_PHYSICIAN: ProfessionalCatalogItem = {
  name: 'PROFESIONAL SINTETICO B',
  phone: '',
  rayenPractitionerId: 'synthetic-B',
  source: 'rayen',
};

let client: QueryClient;
let wrapper: (props: { children: ReactNode }) => ReactNode;
const held: Array<() => void> = [];

beforeEach(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  local.clear();
  session.clear();
  vi.mocked(useAuth).mockReturnValue({ remoteSyncStatus: 'ready' } as ReturnType<typeof useAuth>);
  vi.mocked(CatalogRepository.subscribeNurses).mockImplementation(() => () => {});
  vi.mocked(CatalogRepository.subscribeTens).mockImplementation(() => () => {});
  vi.mocked(CatalogRepository.subscribeProfessionals).mockImplementation(() => () => {});
  ({ queryClient: client, wrapper } = createQueryClientTestWrapper());
  await reconcileAuthorizedSessionOwner('user:synthetic-A');
});
afterEach(async () => {
  await act(async () => held.splice(0).forEach(release => release()));
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

/** Logout as the app runs it (cache cleared during the session cleanup), then B signs in. */
const switchToNextSession = async () => {
  await clearSessionScopedClientState('manual', async () => client.clear());
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
};

/** The repository's next save answers only when the case says so. */
const holdSave = (save: (...args: never[]) => Promise<unknown>) => {
  let answer!: { resolve: (value: unknown) => void; reject: (error: unknown) => void };
  vi.mocked(save).mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        answer = { resolve, reject };
        held.push(() => resolve(undefined));
      })
  );
  return {
    accept: (list: unknown) => act(async () => answer.resolve(list)),
    conflict: (current: (string | ProfessionalCatalogItem)[]) =>
      act(async () => answer.reject(new CatalogConflictError(current))),
  };
};

describe('staff catalog answers that arrive after the session changed', () => {
  it('B opens the treating-physician catalog with its own read, not the late answer to A', async () => {
    const key = ['staff', 'professionals'];
    client.setQueryData(key, []);
    const save = holdSave(CatalogRepository.saveProfessionals);
    const preview = renderHook(() => useTreatingPhysicianCatalogSync(), { wrapper });
    act(() => {
      preview.result.current({
        capturedAt: '2026-11-17T12:00:00Z',
        facilityId: 1342,
        encounters: [],
        physicians: [{ practitionerId: 'synthetic-A', displayName: A_PHYSICIAN.name }],
      });
    });
    await waitFor(() => expect(CatalogRepository.saveProfessionals).toHaveBeenCalledOnce());

    preview.unmount();
    await switchToNextSession();
    expect(client.getQueryData(key)).toBeUndefined();
    await save.accept([A_PHYSICIAN]);
    expect(client.getQueryData(key)).toBeUndefined();

    vi.mocked(CatalogRepository.getProfessionals).mockResolvedValue([B_PHYSICIAN]);
    const reader = renderHook(() => useProfessionalsQuery(), { wrapper });
    await waitFor(() => expect(reader.result.current.data).toEqual([B_PHYSICIAN]));
    expect(CatalogRepository.getProfessionals).toHaveBeenCalledOnce();
  });

  const catalogs = [
    {
      catalog: 'nurses',
      useSave: useSaveNursesMutation,
      save: CatalogRepository.saveNurses,
      before: ['ENFERMERA SINTETICA'],
      next: ['ENFERMERA SINTETICA', 'ENFERMERA SINTETICA A'],
    },
    {
      catalog: 'tens',
      useSave: useSaveTensMutation,
      save: CatalogRepository.saveTens,
      before: ['TENS SINTETICO'],
      next: ['TENS SINTETICO', 'TENS SINTETICO A'],
    },
    {
      catalog: 'professionals',
      useSave: useSaveProfessionalsMutation,
      save: CatalogRepository.saveProfessionals,
      before: [B_PHYSICIAN],
      next: [B_PHYSICIAN, A_PHYSICIAN],
    },
  ] as const;

  /** A sends a save of the loaded catalog; the case decides when the session changes. */
  const sendSave = async ({ catalog, useSave, save, before, next }: (typeof catalogs)[number]) => {
    client.setQueryData(['staff', catalog], before);
    vi.mocked(save).mockClear();
    const answer = holdSave(save);
    const mutation = renderHook(() => useSave(), { wrapper });
    act(() => {
      (mutation.result.current.mutate as (edit: unknown) => void)({ next, base: before });
    });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    return answer;
  };

  it.each(catalogs)('a late confirmation of $catalog leaves the next session empty', async row => {
    const save = await sendSave(row);
    await switchToNextSession();
    await save.accept(row.next);
    expect(client.getQueryData(['staff', row.catalog])).toBeUndefined();
  });

  it.each(catalogs)('a late conflict of $catalog leaves the next session empty', async row => {
    const save = await sendSave(row);
    await switchToNextSession();
    await save.conflict([...row.next]);
    expect(client.getQueryData(['staff', row.catalog])).toBeUndefined();
  });

  it.each(catalogs)('within the same session, $catalog shows what the server holds', async row => {
    const accepted = await sendSave(row);
    await accepted.accept(row.next);
    await waitFor(() => expect(client.getQueryData(['staff', row.catalog])).toEqual(row.next));

    const conflicted = await sendSave(row);
    await conflicted.conflict([...row.next]);
    await waitFor(() => expect(client.getQueryData(['staff', row.catalog])).toEqual(row.next));
  });
});

import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  getDocFromServer,
  initializeFirestore,
  setDoc,
  terminate,
  type Firestore,
} from 'firebase/firestore';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import { TreatingPhysiciansSettings } from '@/features/admin/components/TreatingPhysiciansSettings';
import {
  useNursesQuery,
  useSaveNursesMutation,
  useSaveProfessionalsMutation,
} from '@/hooks/useStaffQuery';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import { CatalogConflictError } from '@/services/repositories/contracts/catalogChanges';
import * as remote from '@/services/storage/firestore';
import * as local from '@/services/storage/indexeddb/indexedDbCatalogService';
import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

vi.unmock('@/services/repositories/CatalogRepository');
vi.mock('@/services/storage/sync', () => ({ recordSyncQueueOwnershipTelemetry: vi.fn() }));
let realtime = 'ready';
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ remoteSyncStatus: realtime }) }));
vi.mock('@/hooks/useEloisaStaff', () => ({ useEloisaStaff: () => [] }));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock(
  '@/services/storage/firestore',
  () => import('@/services/storage/firestore/firestoreCatalogService')
);
let sdk: Firestore;
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: () => sdk },
}));

/**
 * W14-CAT1 — the local catalog copy keeps the newest list this computer confirmed. An earlier
 * request answered late (A's save or read, held across A's logout and B's sign-in) used to
 * replace the list B had just confirmed; B, reopening without network, saw A's old list marked
 * «Actualizado» while the server held B's. Real Firestore emulator, Dexie, session and screen;
 * only the moment the earlier answer arrives is held.
 */
const PROJECT = 'demo-cat1-late-answer';
const REMOTE = { timeout: 10_000 };
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
const settingsRef = (id: string) => doc(sdk, `hospitals/${getActiveHospitalId()}/settings/${id}`);
const serverList = async (id: string) => (await getDocFromServer(settingsRef(id))).data()?.list;
const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>(resolve => (open = resolve));
  return { open, opened };
};

let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
let app: FirebaseApp;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      host,
      port: Number(port),
      rules:
        'rules_version = "2"; service cloud.firestore {match /databases/{database}/documents {match /{doc=**} {allow read, write: if true;}}}',
    },
  });
  await ensureDbReady();
});
beforeEach(async () => {
  app = initializeApp({ projectId: PROJECT, apiKey: 'synthetic' }, crypto.randomUUID());
  sdk = initializeFirestore(app, { ignoreUndefinedProperties: true });
  connectFirestoreEmulator(sdk, host, Number(port));
  await env.clearFirestore();
  await hospitalDB.catalogs.clear();
  await reconcileAuthorizedSessionOwner('user:synthetic-A');
  realtime = 'ready';
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await terminate(sdk);
  await deleteApp(app);
});
afterAll(async () => {
  await env.cleanup();
  await hospitalDB.delete();
});

/** A's save reaches the server; its answer waits until the case releases it. */
const holdAnswer = (
  name: 'saveNurseCatalogToFirestore' | 'saveProfessionalsCatalogToFirestore'
) => {
  const committed = gate();
  const answer = gate();
  const actual = remote[name] as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(remote, name).mockImplementationOnce((async (...args: unknown[]) => {
    const result = await actual(...args);
    committed.open();
    await answer.opened;
    return result;
  }) as never);
  return { committed: committed.opened, release: answer.open };
};

/** Logout as the app runs it, then B signs in on the same computer. */
const switchToB = async (clearCache: () => void) => {
  await clearSessionScopedClientState('manual', async () => clearCache());
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
};

it('B, offline, sees the specialty it confirmed, not the late answer to A', async () => {
  const before = [{ name: 'PROFESIONAL SINTETICO', phone: '', specialty: 'Cirugía' }];
  const current = [{ ...before[0], specialty: 'Pediatría' }];
  const { queryClient, wrapper } = createQueryClientTestWrapper();
  const held = holdAnswer('saveProfessionalsCatalogToFirestore');
  queryClient.setQueryData(['staff', 'professionals'], []);
  const a = renderHook(useSaveProfessionalsMutation, { wrapper });
  let settled!: Promise<unknown>;
  act(() => {
    settled = a.result.current.mutateAsync({ base: [], next: before });
  });
  await held.committed;
  a.unmount();
  await switchToB(() => queryClient.clear());
  await CatalogRepository.saveProfessionals(current, before);

  await act(async () => {
    held.release();
    await settled;
  });
  expect(await serverList('professionals_catalog')).toEqual(current);
  expect((await local.getCatalogValues('professionals'))[0]).toMatchObject(current[0]);

  await disableNetwork(sdk);
  realtime = 'local_only';
  render(createElement(TreatingPhysiciansSettings), { wrapper });
  const field = await screen.findByRole('combobox', {
    name: 'Especialidad de PROFESIONAL SINTETICO',
  });
  expect(field).toHaveValue('Pediatría');
});

it('a late confirmation of A leaves the nurse list B confirmed', async () => {
  const before = ['ENFERMERA SINTETICA A'];
  const current = ['ENFERMERA SINTETICA B'];
  const { queryClient, wrapper } = createQueryClientTestWrapper();
  const held = holdAnswer('saveNurseCatalogToFirestore');
  queryClient.setQueryData(['staff', 'nurses'], []);
  const a = renderHook(useSaveNursesMutation, { wrapper });
  let settled!: Promise<unknown>;
  act(() => {
    settled = a.result.current.mutateAsync({ base: [], next: before });
  });
  await held.committed;
  a.unmount();
  await switchToB(() => queryClient.clear());
  expect(await CatalogRepository.saveNurses(current, before)).toEqual(current);

  await act(async () => {
    held.release();
    await settled;
  });
  expect(await local.getCatalog('nurses')).toEqual(current);

  await disableNetwork(sdk);
  realtime = 'local_only';
  const b = renderHook(useNursesQuery, { wrapper });
  await waitFor(() => expect(b.result.current.saved?.list).toEqual(current));
});

it('a late read of A leaves the nurse list B confirmed', async () => {
  const before = ['ENFERMERA SINTETICA A'];
  const current = ['ENFERMERA SINTETICA B'];
  await setDoc(settingsRef('nurses'), { list: before });
  const read = gate();
  const answer = gate();
  const actual = remote.getNurseCatalogFromFirestore;
  vi.spyOn(remote, 'getNurseCatalogFromFirestore').mockImplementationOnce(async () => {
    const result = await actual();
    read.open();
    await answer.opened;
    return result;
  });
  const { queryClient, wrapper } = createQueryClientTestWrapper();
  realtime = 'bootstrapping';
  const a = renderHook(useNursesQuery, { wrapper });
  await read.opened;
  a.unmount();
  await switchToB(() => queryClient.clear());
  expect(await CatalogRepository.saveNurses(current, before)).toEqual(current);

  await act(async () => answer.open());
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(await local.getCatalog('nurses')).toEqual(current);
});

it('two saves in a row keep the last one locally, and a conflict still refreshes the copy', async () => {
  await CatalogRepository.saveNurses(['ENFERMERA UNO'], []);
  await CatalogRepository.saveNurses(['ENFERMERA UNO', 'ENFERMERA DOS'], ['ENFERMERA UNO']);
  expect(await local.getCatalog('nurses')).toEqual(['ENFERMERA UNO', 'ENFERMERA DOS']);
  await waitFor(
    async () => expect(await serverList('nurses')).toEqual(['ENFERMERA UNO', 'ENFERMERA DOS']),
    REMOTE
  );

  // Another computer removes a name; this one, still on the old list, renames the same one.
  await setDoc(settingsRef('nurses'), { list: ['ENFERMERA UNO'] });
  await expect(
    CatalogRepository.saveNurses(
      ['ENFERMERA UNO', 'ENFERMERA DOS BIS'],
      ['ENFERMERA UNO', 'ENFERMERA DOS']
    )
  ).rejects.toBeInstanceOf(CatalogConflictError);
  expect(await local.getCatalog('nurses')).toEqual(['ENFERMERA UNO']);
});

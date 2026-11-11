import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CatalogRecord } from '@/services/storage/indexeddb/indexedDbCatalogContracts';

vi.unmock('@/services/repositories/CatalogRepository');
vi.mock('@/services/storage/indexeddb/indexedDbCore', async () => {
  const db = new Dexie('catalog-save-truth-synthetic');
  db.version(1).stores({ catalogs: 'id' });
  return { hospitalDB: db, ensureDbReady: () => db.open() };
});
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));
vi.mock(
  '@/services/storage/firestore',
  () => import('@/services/storage/firestore/firestoreCatalogService')
);
let sdkDb: import('firebase/firestore').Firestore;
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: () => sdkDb },
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ remoteSyncStatus: 'ready' }) }));
const eloisa = vi.hoisted(() => ({
  staff: [] as { key: string; role: string; name: string; aliases: string[] }[],
}));
vi.mock('@/hooks/useEloisaStaff', () => ({ useEloisaStaff: () => eloisa.staff }));
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import * as remote from '@/services/storage/firestore';
import { useNursesQuery, useTensQuery } from '@/hooks/useStaffQuery';
import { NurseManagerModal } from '@/components/modals/NurseManagerModal';
import { TensManagerModal } from '@/components/modals/TensManagerModal';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

const catalogs: Table<CatalogRecord> = hospitalDB.table('catalogs');
const cacheWrites = vi.fn();
catalogs.hook('creating', () => {
  cacheWrites();
});
catalogs.hook('updating', () => {
  cacheWrites();
});

const cases = [
  {
    key: 'nurses',
    role: 'nurse',
    query: useNursesQuery,
    read: remote.getNurseCatalogFromFirestore,
    save: remote.saveNurseCatalogToFirestore,
    name: 'Enfermero/a 1',
  },
  {
    key: 'tens',
    role: 'tens',
    query: useTensQuery,
    read: remote.getTensCatalogFromFirestore,
    save: remote.saveTensCatalogToFirestore,
    name: 'TENS 1',
  },
];
function Manager({ entry }: { entry: (typeof cases)[number] }) {
  const query = entry.query();
  return entry.key === 'nurses' ? (
    <NurseManagerModal isOpen onClose={() => {}} nursesList={query.data} />
  ) : (
    <TensManagerModal isOpen onClose={() => {}} tensList={query.data} />
  );
}

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  disableNetwork,
  enableNetwork,
  getDocFromServer,
  initializeFirestore,
  connectFirestoreEmulator,
  terminate,
} from 'firebase/firestore';
import { beforeAll, afterAll } from 'vitest';

import { getActiveHospitalId } from '@/constants/firestorePaths';

// A resumed SDK listener or write against a real emulator can exceed RTL's 1 s default wait.
const RESUMED_TRANSPORT = { timeout: 10_000 };
let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-c3-rework',
    firestore: {
      host,
      port: Number(port),
      rules:
        'rules_version = "2"; service cloud.firestore {match /databases/{database}/documents {match /{doc=**} {allow read, write: if true;}}}',
    },
  });
});
afterAll(async () => {
  cleanup();
  await env.cleanup();
  await hospitalDB.delete();
});

let sdkApp: FirebaseApp;
beforeEach(() => {
  sdkApp = initializeApp({ projectId: 'demo-c3-rework', apiKey: 'synthetic' }, crypto.randomUUID());
  sdkDb = initializeFirestore(sdkApp, { ignoreUndefinedProperties: true });
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  connectFirestoreEmulator(sdkDb, host, Number(port));
});
afterEach(async () => {
  cleanup();
  await enableNetwork(sdkDb);
  await terminate(sdkDb);
  await deleteApp(sdkApp);
  vi.restoreAllMocks();
});
for (const entry of cases) {
  it(
    entry.key + ': pending SDK snapshot never enters UI or Dexie; accepted change delivered once',
    async () => {
      vi.mocked(isFirestoreEnabled).mockReturnValue(true);
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      await hospitalDB.open();
      await catalogs.clear();
      const ref = doc(sdkDb, `hospitals/${getActiveHospitalId()}/settings/${entry.key}`);
      await setDoc(ref, { list: ['Synthetic Base'] });
      const { wrapper, queryClient } = createQueryClientTestWrapper();
      render(<Manager entry={entry} />, { wrapper });
      await screen.findByText('Synthetic Base');
      await new Promise(r => setTimeout(r, 200));
      cacheWrites.mockClear();
      await disableNetwork(sdkDb);
      fireEvent.change(screen.getByPlaceholderText('Nombre completo…'), {
        target: { value: 'Synthetic X' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
      try {
        await new Promise(r => setTimeout(r, 300));
        expect(queryClient.getMutationCache().getAll()[0].state.status).toBe('pending');
        expect(screen.queryByText('Synthetic X')).not.toBeInTheDocument();
        expect((await catalogs.get(entry.key))?.list).toEqual(['Synthetic Base']);
        expect(cacheWrites).not.toHaveBeenCalled();
      } finally {
        await enableNetwork(sdkDb);
        await waitFor(
          () => expect(queryClient.getMutationCache().getAll()[0].state.status).toBe('success'),
          RESUMED_TRANSPORT
        );
      }
      await screen.findByText('Synthetic X', {}, RESUMED_TRANSPORT);
      await waitFor(
        () => expect(queryClient.getMutationCache().getAll()[0].state.status).toBe('success'),
        RESUMED_TRANSPORT
      );
      expect((await getDocFromServer(ref)).data()?.list).toEqual(['Synthetic Base', 'Synthetic X']);
      await new Promise(r => setTimeout(r, 100));
      expect(cacheWrites).toHaveBeenCalledTimes(1);
    }
  );
}

const serviceCases = [
  {
    key: 'professionals',
    doc: 'professionals_catalog',
    subscribe: remote.subscribeToProfessionalsCatalog,
    value: [{ name: 'Synthetic Physician', phone: '', specialty: 'Pediatría' }],
  },
  {
    key: 'nurses',
    doc: 'nurses',
    subscribe: remote.subscribeToNurseCatalog,
    value: ['Synthetic Base', 'Synthetic X'],
  },
  {
    key: 'tens',
    doc: 'tens',
    subscribe: remote.subscribeToTensCatalog,
    value: ['Synthetic Base', 'Synthetic X'],
  },
];
for (const entry of serviceCases) {
  it(
    entry.key +
      ': cached clean snapshot is delivered offline without duplicate metadata deliveries',
    async () => {
      const ref = doc(sdkDb, `hospitals/${getActiveHospitalId()}/settings/${entry.doc}`);
      await setDoc(ref, { list: entry.value });
      await getDocFromServer(ref);
      await disableNetwork(sdkDb);
      const received = vi.fn();
      const unsubscribe = entry.subscribe(received);
      try {
        await waitFor(() => expect(received).toHaveBeenCalledWith(entry.value), RESUMED_TRANSPORT);
        await enableNetwork(sdkDb);
        await new Promise(r => setTimeout(r, 300));
        expect(received).toHaveBeenCalledTimes(1);
      } finally {
        unsubscribe();
      }
    }
  );
}
it('professionals: pending writes do not publish or cache; ACK publishes once', async () => {
  await hospitalDB.open();
  await catalogs.clear();
  const ref = doc(sdkDb, `hospitals/${getActiveHospitalId()}/settings/professionals_catalog`);
  const base = [{ name: 'Synthetic Physician', phone: '', specialty: 'Pediatría' }];
  const updated = [{ ...base[0], specialty: 'Cirugía' }];
  await setDoc(ref, { list: base });
  const { CatalogRepository } = await import('@/services/repositories/CatalogRepository');
  const received = vi.fn();
  const unsubscribe = CatalogRepository.subscribeProfessionals(received);
  await waitFor(() => expect(received).toHaveBeenCalledTimes(1), RESUMED_TRANSPORT);
  cacheWrites.mockClear();
  await disableNetwork(sdkDb);
  const saving = CatalogRepository.saveProfessionals(updated);
  try {
    await new Promise(r => setTimeout(r, 300));
    expect(received).toHaveBeenCalledTimes(1);
    expect(cacheWrites).not.toHaveBeenCalled();
    expect((await catalogs.get('professionals'))?.list).toEqual([
      expect.objectContaining({ specialty: 'Pediatría' }),
    ]);
  } finally {
    await enableNetwork(sdkDb);
    await saving;
  }
  await waitFor(() => expect(received).toHaveBeenCalledTimes(2), RESUMED_TRANSPORT);
  expect(received.mock.calls[1][0]).toEqual([expect.objectContaining({ specialty: 'Cirugía' })]);
  await new Promise(r => setTimeout(r, 200));
  expect(received).toHaveBeenCalledTimes(2);
  expect(cacheWrites).toHaveBeenCalledTimes(1);
  unsubscribe();
});
it('late SDK acceptance removes the timeout warning and updates the visible list', async () => {
  await hospitalDB.open();
  await catalogs.clear();
  const ref = doc(sdkDb, `hospitals/${getActiveHospitalId()}/settings/nurses`);
  await setDoc(ref, { list: ['Synthetic Base'] });
  const { wrapper } = createQueryClientTestWrapper();
  render(<Manager entry={cases[0]} />, { wrapper });
  await screen.findByText('Synthetic Base');
  await new Promise(r => setTimeout(r, 200));
  await disableNetwork(sdkDb);
  fireEvent.change(screen.getByPlaceholderText('Nombre completo…'), {
    target: { value: 'Synthetic Late' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
  await screen.findByText(/no se guardó/i, {}, { timeout: 17000 });
  expect(screen.getByPlaceholderText('Nombre completo…')).toHaveValue('Synthetic Late');
  expect(screen.getByRole('button', { name: 'Agregar personal' })).toBeEnabled();
  expect(screen.queryByText('Synthetic Late')).not.toBeInTheDocument();
  await enableNetwork(sdkDb);
  await screen.findByText('Synthetic Late', {}, RESUMED_TRANSPORT);
  await waitFor(
    () => expect(screen.queryByText(/no se guardó/i)).not.toBeInTheDocument(),
    RESUMED_TRANSPORT
  );
});

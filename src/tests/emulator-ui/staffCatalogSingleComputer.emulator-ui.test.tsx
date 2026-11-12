import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { CatalogRecord } from '@/services/storage/indexeddb/indexedDbCatalogContracts';

vi.unmock('@/services/repositories/CatalogRepository');
vi.mock('@/services/storage/indexeddb/indexedDbCore', async () => {
  const db = new Dexie('catalog-single-computer-synthetic');
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
vi.mock('@/hooks/useEloisaStaff', () => ({ useEloisaStaff: () => [] }));
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  getDocFromServer,
  initializeFirestore,
  connectFirestoreEmulator,
  terminate,
} from 'firebase/firestore';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import * as remote from '@/services/storage/firestore';
import { useNursesQuery, useTensQuery } from '@/hooks/useStaffQuery';
import { NurseManagerModal } from '@/components/modals/NurseManagerModal';
import { TensManagerModal } from '@/components/modals/TensManagerModal';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { getActiveHospitalId } from '@/constants/firestorePaths';

// A real emulator transaction can exceed RTL's 1 s default wait.
const REMOTE = { timeout: 10_000 };
const CONFLICT = 'La lista cambió en otro equipo. Revise la lista actualizada y repita el cambio.';
const catalogs: Table<CatalogRecord> = hospitalDB.table('catalogs');

// The shown list and the saved list behind it come from one source, as in the census.
function Nurses() {
  const query = useNursesQuery();
  return (
    <NurseManagerModal isOpen onClose={() => {}} nursesList={query.data} saved={query.saved} />
  );
}
function Tens() {
  const query = useTensQuery();
  return <TensManagerModal isOpen onClose={() => {}} tensList={query.data} saved={query.saved} />;
}
const settingsRef = (id: string) => doc(sdkDb, `hospitals/${getActiveHospitalId()}/settings/${id}`);
const serverList = async (id = 'nurses') => (await getDocFromServer(settingsRef(id))).data()?.list;
const visibleRows = () =>
  screen.getAllByTitle('Editar').map(button => button.closest('.group')?.textContent);
const rename = (from: string, to: string) => {
  fireEvent.click(screen.getByText(from).closest('.group')!.querySelector('[title="Editar"]')!);
  fireEvent.change(screen.getByDisplayValue(from), { target: { value: to } });
  fireEvent.click(screen.getByTitle('Guardar'));
};
const renderManager = (ui: ReactElement) => {
  const { wrapper } = createQueryClientTestWrapper();
  render(ui, { wrapper });
};
// Keeps the examples on screen, as before the first realtime delivery.
const holdListener = () => {
  vi.spyOn(remote, 'subscribeToNurseCatalog').mockImplementation(() => () => {});
  vi.spyOn(remote, 'subscribeToTensCatalog').mockImplementation(() => () => {});
};

let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-n4c-single-computer',
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
beforeEach(async () => {
  sdkApp = initializeApp(
    { projectId: 'demo-n4c-single-computer', apiKey: 'synthetic' },
    crypto.randomUUID()
  );
  sdkDb = initializeFirestore(sdkApp, { ignoreUndefinedProperties: true });
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  connectFirestoreEmulator(sdkDb, host, Number(port));
  await env.clearFirestore();
  await hospitalDB.open();
  await catalogs.clear();
});
afterEach(async () => {
  cleanup();
  await terminate(sdkDb);
  await deleteApp(sdkApp);
  vi.restoreAllMocks();
});

// Examples are rows with no saved text: editing beside them saves only what the person wrote.
it('renaming a display example on an empty catalog saves the new name, without a conflict', async () => {
  await setDoc(settingsRef('nurses'), { list: [] });
  holdListener();
  renderManager(<Nurses />);
  await screen.findByText('Enfermero/a 1');
  rename('Enfermero/a 1', 'Sintético Real');
  await waitFor(async () => expect(await serverList()).toEqual(['Sintético Real']), REMOTE);
  await screen.findByText('Sintético Real', {}, REMOTE);
  expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Edición pendiente')).not.toBeInTheDocument();
});

it('removing an example or adding beside them on a missing catalog saves no example', async () => {
  holdListener();
  renderManager(<Tens />);
  await screen.findByText('TENS 2');
  fireEvent.click(
    screen.getByText('TENS 2').closest('.group')!.querySelector('[title="Eliminar"]')!
  );
  await waitFor(async () => expect(await serverList('tens')).toEqual([]), REMOTE);
  fireEvent.change(screen.getByPlaceholderText('Nombre completo…'), {
    target: { value: 'Sintético Nuevo' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
  await waitFor(async () => expect(await serverList('tens')).toEqual(['Sintético Nuevo']), REMOTE);
  expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
});

it('renaming a row with hidden case variants does not bring the old name back', async () => {
  await setDoc(settingsRef('nurses'), { list: ['Sintético Uno', 'sintético uno'] });
  renderManager(<Nurses />);
  await screen.findByText('sintético uno');
  expect(screen.queryByText('Sintético Uno')).not.toBeInTheDocument();
  rename('sintético uno', 'Sintético Nuevo');
  await waitFor(async () => expect(await serverList()).toEqual(['Sintético Nuevo']), REMOTE);
  await screen.findByText('Sintético Nuevo', {}, REMOTE);
  expect(screen.queryByText('Sintético Uno')).not.toBeInTheDocument();
  expect(screen.queryByText('sintético uno')).not.toBeInTheDocument();
});

it('renaming keeps the visible position of the row', async () => {
  await setDoc(settingsRef('nurses'), {
    list: ['Sintético Uno', 'Sintético Dos', 'Sintético Tres'],
  });
  renderManager(<Nurses />);
  await screen.findByText('Sintético Uno');
  rename('Sintético Uno', 'Sintético Nuevo');
  await screen.findByText('Sintético Nuevo', {}, REMOTE);
  expect(visibleRows()).toEqual(['Sintético Nuevo', 'Sintético Dos', 'Sintético Tres']);
  rename('Sintético Dos', 'Sintético Medio');
  await screen.findByText('Sintético Medio', {}, REMOTE);
  expect(visibleRows()).toEqual(['Sintético Nuevo', 'Sintético Medio', 'Sintético Tres']);
  expect(await serverList()).toEqual(['Sintético Nuevo', 'Sintético Medio', 'Sintético Tres']);
});

it('removing the only row leaves a real empty list', async () => {
  await setDoc(settingsRef('nurses'), { list: ['Sintético Uno'] });
  renderManager(<Nurses />);
  await screen.findByText('Sintético Uno');
  fireEvent.click(screen.getByTitle('Eliminar'));
  await waitFor(async () => expect(await serverList()).toEqual([]), REMOTE);
  await waitFor(() => expect(screen.queryByText('Sintético Uno')).not.toBeInTheDocument(), REMOTE);
  expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
});

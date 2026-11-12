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
  const db = new Dexie('catalog-eloisa-derived-synthetic');
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
import { SHARED_STAFF_DOC } from '@/services/staff/sharedEloisaStaffCatalog';

// A real emulator transaction or shared-catalog delivery can exceed RTL's 1 s default wait.
const REMOTE = { timeout: 10_000 };
const CONFLICT = 'La lista cambió en otro equipo. Revise la lista actualizada y repita el cambio.';
const catalogs: Table<CatalogRecord> = hospitalDB.table('catalogs');

function Nurses() {
  return <NurseManagerModal isOpen onClose={() => {}} nursesList={useNursesQuery().data} />;
}
function Tens() {
  return <TensManagerModal isOpen onClose={() => {}} tensList={useTensQuery().data} />;
}
const settingsRef = (id: string) => doc(sdkDb, `hospitals/${getActiveHospitalId()}/settings/${id}`);
const serverList = async (id = 'nurses') => (await getDocFromServer(settingsRef(id))).data()?.list;
const row = (name: string) => screen.getByText(name).closest('.group')!;
const rename = (from: string, to: string) => {
  fireEvent.click(row(from).querySelector('[title="Editar"]')!);
  fireEvent.change(screen.getByDisplayValue(from), { target: { value: to } });
  fireEvent.click(screen.getByTitle('Guardar'));
};
const renderManager = (ui: ReactElement) => {
  const { wrapper } = createQueryClientTestWrapper();
  render(ui, { wrapper });
};
// The shared Eloísa catalog the app subscribes to; these people are not in the saved list.
const seedEloisa = (role: 'nurse' | 'tens', name: string) =>
  setDoc(settingsRef(SHARED_STAFF_DOC), {
    list: [{ key: `synthetic-${role}`, role, name, aliases: [] }],
  });

let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-n4c-eloisa-derived',
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
    { projectId: 'demo-n4c-eloisa-derived', apiKey: 'synthetic' },
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

it('removing a person shown only from Eloísa keeps the saved list, without a conflict', async () => {
  await setDoc(settingsRef('nurses'), { list: ['Sintético Guardado'] });
  await seedEloisa('nurse', 'Sintético Eloísa');
  renderManager(<Nurses />);
  await screen.findByText('Sintético Eloísa', {}, REMOTE);
  fireEvent.click(row('Sintético Eloísa').querySelector('[title="Eliminar"]')!);
  // The seeded document has no lastUpdated: it appears only once this save is confirmed.
  await waitFor(
    async () =>
      expect((await getDocFromServer(settingsRef('nurses'))).data()?.lastUpdated).toBeDefined(),
    REMOTE
  );
  expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
  expect(await serverList()).toEqual(['Sintético Guardado']);
});

it('renaming a person shown only from Eloísa saves the new name, without a conflict', async () => {
  await setDoc(settingsRef('nurses'), { list: ['Sintético Guardado'] });
  await seedEloisa('nurse', 'Sintético Eloísa');
  renderManager(<Nurses />);
  await screen.findByText('Sintético Eloísa', {}, REMOTE);
  rename('Sintético Eloísa', 'Sintético Renombrado');
  await waitFor(
    async () => expect(await serverList()).toEqual(['Sintético Guardado', 'Sintético Renombrado']),
    REMOTE
  );
  await screen.findByText('Sintético Renombrado', {}, REMOTE);
  expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Edición pendiente')).not.toBeInTheDocument();
});

it('TENS: renaming a person shown only from Eloísa saves the new name', async () => {
  await setDoc(settingsRef('tens'), { list: ['Sintético TENS'] });
  await seedEloisa('tens', 'Sintético TENS Eloísa');
  renderManager(<Tens />);
  await screen.findByText('Sintético TENS Eloísa', {}, REMOTE);
  rename('Sintético TENS Eloísa', 'Sintético TENS Nuevo');
  await waitFor(
    async () =>
      expect(await serverList('tens')).toEqual(['Sintético TENS', 'Sintético TENS Nuevo']),
    REMOTE
  );
  expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
});

it('removing a saved person that another computer renamed is still a conflict', async () => {
  await setDoc(settingsRef('nurses'), { list: ['Sintético Guardado'] });
  await seedEloisa('nurse', 'Sintético Eloísa');
  // The editor keeps the list it read, as before the other computer's change arrives.
  vi.spyOn(remote, 'subscribeToNurseCatalog').mockImplementation(() => () => {});
  renderManager(<Nurses />);
  await screen.findByText('Sintético Guardado');
  await screen.findByText('Sintético Eloísa', {}, REMOTE);
  await setDoc(settingsRef('nurses'), { list: ['Sintético Otro Equipo'] });
  fireEvent.click(row('Sintético Guardado').querySelector('[title="Eliminar"]')!);
  await screen.findByText(CONFLICT, {}, REMOTE);
  expect(await serverList()).toEqual(['Sintético Otro Equipo']);
});

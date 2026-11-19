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
// Any copy of the Eloísa list other than the one the shown rows come from can arrive late; a
// test sets this to model that copy still empty while the rows already show Eloísa people.
const otherEloisaCopy = vi.hoisted(() => ({ late: false }));
vi.mock('@/hooks/useEloisaStaff', async importOriginal => {
  const real = await importOriginal<typeof import('@/hooks/useEloisaStaff')>();
  return {
    useEloisaStaff: (shared = false) => {
      const list = real.useEloisaStaff(shared);
      return !shared && otherEloisaCopy.late ? [] : list;
    },
  };
});
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
import { StaffManagerModal } from '@/features/census/components/staff-catalog/StaffManagerModal';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import { SHARED_STAFF_DOC } from '@/services/staff/sharedEloisaStaffCatalog';

// A real emulator transaction or shared-catalog delivery can exceed RTL's 1 s default wait.
const REMOTE = { timeout: 10_000 };
const CONFLICT = 'La lista cambió en otro equipo. Revise la lista actualizada y repita el cambio.';
const catalogs: Table<CatalogRecord> = hospitalDB.table('catalogs');

// The shown list and the saved list behind it come from one source, as in the census.
function Nurses() {
  const query = useNursesQuery();
  return (
    <StaffManagerModal
      role="nurse"
      isOpen
      onClose={() => {}}
      staffList={query.data}
      saved={query.saved}
    />
  );
}
function Tens() {
  const query = useTensQuery();
  return (
    <StaffManagerModal
      role="tens"
      isOpen
      onClose={() => {}}
      staffList={query.data}
      saved={query.saved}
    />
  );
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
  const { wrapper, queryClient } = createQueryClientTestWrapper();
  render(ui, { wrapper });
  return queryClient;
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
  otherEloisaCopy.late = false;
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
  await screen.findByText('Sintético Guardado', {}, REMOTE);
  await screen.findByText('Sintético Eloísa', {}, REMOTE);
  await setDoc(settingsRef('nurses'), { list: ['Sintético Otro Equipo'] });
  fireEvent.click(row('Sintético Guardado').querySelector('[title="Eliminar"]')!);
  await screen.findByText(CONFLICT, {}, REMOTE);
  expect(await serverList()).toEqual(['Sintético Otro Equipo']);
});

it('removing a row shown with its Eloísa name removes the saved alias, as on main', async () => {
  await setDoc(settingsRef('nurses'), { list: ['Sintético Alias', 'Sintético Otro'] });
  await setDoc(settingsRef(SHARED_STAFF_DOC), {
    list: [
      { key: 'synthetic', role: 'nurse', name: 'Sintético Canónico', aliases: ['Sintético Alias'] },
    ],
  });
  const rows = () =>
    screen.getAllByTitle('Editar').map(button => button.closest('.group')?.textContent);
  renderManager(<Nurses />);
  await screen.findByText('Sintético Canónico', {}, REMOTE);
  expect(rows()).toEqual(['Sintético Canónico', 'Sintético Otro']);
  fireEvent.click(row('Sintético Canónico').querySelector('[title="Eliminar"]')!);
  await waitFor(async () => expect(await serverList()).toEqual(['Sintético Otro']), REMOTE);
  await waitFor(() => expect(rows()).toEqual(['Sintético Otro', 'Sintético Canónico']), REMOTE);
  cleanup();
  renderManager(<Nurses />);
  await waitFor(() => expect(rows()).toEqual(['Sintético Otro', 'Sintético Canónico']), REMOTE);
  expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
});

it.each(['nurse', 'tens'] as const)(
  '%s: adding a cedilla-less alias of the same Eloísa ID keeps one saved entry, spelled as saved',
  async role => {
    const listDoc = role === 'nurse' ? 'nurses' : 'tens';
    await setDoc(settingsRef(listDoc), { list: ['Françoise Soto'] });
    await setDoc(settingsRef(SHARED_STAFF_DOC), {
      list: [
        {
          key: `${role}:id:syn1`,
          role,
          name: 'Françoise Soto',
          practitionerId: 'syn1',
          aliases: ['Françoise Soto', 'Francoise Soto'],
        },
      ],
    });
    renderManager(role === 'nurse' ? <Nurses /> : <Tens />);
    await screen.findByText('Françoise Soto', {}, REMOTE);
    const input = screen.getByPlaceholderText('Nombre completo…');
    fireEvent.change(input, { target: { value: 'Francoise Soto' } });
    fireEvent.click(screen.getByLabelText('Agregar personal'));
    await waitFor(() => expect(input).toHaveValue(''), REMOTE);
    expect(await serverList(listDoc)).toEqual(['Françoise Soto']);
    const rows = screen
      .getAllByTitle('Editar')
      .map(button => button.closest('.group')?.textContent);
    expect(rows).toEqual(['Françoise Soto']);
    expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
  }
);

it.each(['nurse', 'tens'] as const)(
  '%s: respelling one of two Eloísa people whose names fold alike keeps the other row',
  async role => {
    const listDoc = role === 'nurse' ? 'nurses' : 'tens';
    const names = ['Maria Pena', 'Maria Peña'];
    await setDoc(settingsRef(listDoc), { list: names });
    await setDoc(settingsRef(SHARED_STAFF_DOC), {
      list: names.map((name, index) => ({
        key: `${role}:id:syn${index}`,
        role,
        name,
        aliases: [name],
        practitionerId: `syn${index}`,
      })),
    });
    renderManager(role === 'nurse' ? <Nurses /> : <Tens />);
    await screen.findByText('Maria Pena', {}, REMOTE);
    await screen.findByText('Maria Peña', {}, REMOTE);
    const input = screen.getByPlaceholderText('Nombre completo…');
    fireEvent.change(input, { target: { value: 'Alba Prado' } });
    fireEvent.click(screen.getByLabelText('Agregar personal'));
    await waitFor(() => expect(input).toHaveValue(''), REMOTE);
    expect(await serverList(listDoc)).toEqual([...names, 'Alba Prado']);
    rename('Maria Pena', 'María Pena');
    await waitFor(
      async () =>
        expect(await serverList(listDoc)).toEqual(['María Pena', 'Maria Peña', 'Alba Prado']),
      REMOTE
    );
    expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
  }
);

it.each(['nurse', 'tens'] as const)(
  '%s: a respelled row stays its person when the editor reopens and Eloísa publishes again',
  async role => {
    const listDoc = role === 'nurse' ? 'nurses' : 'tens';
    const names = ['Maria Pena', 'Maria Peña'];
    const people = names.map((name, index) => ({
      key: `${role}:id:syn${index}`,
      role,
      name,
      aliases: [name],
      practitionerId: `syn${index}`,
    }));
    await setDoc(settingsRef(listDoc), { list: names });
    await setDoc(settingsRef(SHARED_STAFF_DOC), { list: people });
    const rows = () =>
      screen.getAllByTitle('Editar').map(button => button.closest('.group')?.textContent);
    renderManager(role === 'nurse' ? <Nurses /> : <Tens />);
    await screen.findByText('Maria Pena', {}, REMOTE);
    await screen.findByText('Maria Peña', {}, REMOTE);
    rename('Maria Pena', 'María Pena');
    await waitFor(
      async () => expect(await serverList(listDoc)).toEqual(['María Pena', 'Maria Peña']),
      REMOTE
    );
    cleanup();
    renderManager(role === 'nurse' ? <Nurses /> : <Tens />);
    await waitFor(() => expect(rows()).toEqual(['María Pena', 'Maria Peña']), REMOTE);
    const { publishSharedStaffCatalog } = await import('@/services/staff/sharedEloisaStaffCatalog');
    await publishSharedStaffCatalog(people);
    expect(await serverList(listDoc)).toEqual(['María Pena', 'Maria Peña']);
    await waitFor(() => expect(rows()).toEqual(['María Pena', 'Maria Peña']), REMOTE);
  }
);

// An offline addition whose accent-only twin is another Eloísa ID's saved row.
const failedAdditionKeepsWarning = async (role: 'nurse' | 'tens') => {
  const listDoc = role === 'nurse' ? 'nurses' : 'tens';
  await setDoc(settingsRef(listDoc), { list: ['Luz Peña'] });
  await setDoc(settingsRef(SHARED_STAFF_DOC), {
    list: [
      {
        key: `${role}:id:syn1`,
        role,
        name: 'Luz Pena Vega',
        aliases: ['Luz Pena Vega', 'Luz Pena'],
        practitionerId: 'syn1',
      },
      {
        key: `${role}:id:syn2`,
        role,
        name: 'Luz Peña',
        aliases: ['Luz Peña'],
        practitionerId: 'syn2',
      },
    ],
  });
  const client = renderManager(role === 'nurse' ? <Nurses /> : <Tens />);
  await screen.findByText('Luz Pena Vega', {}, REMOTE);
  await screen.findByText('Luz Peña', {}, REMOTE);
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const input = screen.getByPlaceholderText('Nombre completo…');
  fireEvent.change(input, { target: { value: 'Luz Pena' } });
  fireEvent.click(screen.getByLabelText('Agregar personal'));
  await waitFor(
    () => expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('error'),
    REMOTE
  );
  // The accepted list holds «Luz Peña», another person: the warning must stay.
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(screen.getByText(/El cambio no se guardó/)).toBeInTheDocument();
  expect(input).toHaveValue('Luz Pena');
  expect(await serverList(listDoc)).toEqual(['Luz Peña']);
  online.mockReturnValue(true);
  fireEvent.click(screen.getByLabelText('Agregar personal'));
  await waitFor(() => expect(input).toHaveValue(''), REMOTE);
  expect(await serverList(listDoc)).toEqual(['Luz Peña', 'Luz Pena']);
};

it.each(['nurse', 'tens'] as const)(
  '%s: a failed addition keeps its warning while only another ID that spells alike is saved',
  failedAdditionKeepsWarning
);

// The save once judged with its own copy of the Eloísa list: while that copy was still empty,
// «Luz Pena» passed for the saved «Luz Peña» and the unsaved addition lost its warning.
it.each(['nurse', 'tens'] as const)(
  '%s: a failed addition keeps its warning while another copy of the Eloísa list is still empty',
  async role => {
    otherEloisaCopy.late = true;
    await failedAdditionKeepsWarning(role);
  }
);

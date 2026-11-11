import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const failure = new Error('synthetic unavailable');
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

import { TreatingPhysiciansSettings } from '@/features/admin/components/TreatingPhysiciansSettings';
import { onlineManager } from '@tanstack/react-query';

describe('confirmed catalog saves', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
    onlineManager.setOnline(true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await hospitalDB.open();
    await catalogs.clear();
  });
  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });
  const add = () => {
    fireEvent.change(screen.getByPlaceholderText('Nombre completo…'), {
      target: { value: 'Synthetic X' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
  };
  for (const entry of cases) {
    it(entry.key + ': healthy save updates remote, IndexedDB and visible list', async () => {
      await catalogs.put({ id: entry.key, list: ['Synthetic Base'], lastUpdated: 'synthetic' });
      const { wrapper } = createQueryClientTestWrapper();
      render(<Manager entry={entry} />, { wrapper });
      await screen.findByText('Synthetic Base');
      add();
      await screen.findByText('Synthetic X');
      expect(entry.save).toHaveBeenCalledWith(['Synthetic Base', 'Synthetic X']);
      expect((await catalogs.get(entry.key))?.list).toEqual(['Synthetic Base', 'Synthetic X']);
      await waitFor(() => expect(screen.getByPlaceholderText('Nombre completo…')).toHaveValue(''));
    });
    it(
      entry.key + ': offline rejects without pausing, preserves input and retries explicitly',
      async () => {
        await catalogs.put({ id: entry.key, list: ['Synthetic Base'], lastUpdated: 'synthetic' });
        const { wrapper, queryClient } = createQueryClientTestWrapper();
        render(<Manager entry={entry} />, { wrapper });
        await screen.findByText('Synthetic Base');
        onlineManager.setOnline(false);
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        add();
        await screen.findByText(/no se guardó/i);
        expect(queryClient.getMutationCache().getAll()[0].state.isPaused).toBe(false);
        expect(screen.getByPlaceholderText('Nombre completo…')).toHaveValue('Synthetic X');
        expect(screen.queryByText('Synthetic X')).not.toBeInTheDocument();
        expect(entry.save).not.toHaveBeenCalled();
        expect((await catalogs.get(entry.key))?.list).toEqual(['Synthetic Base']);
        onlineManager.setOnline(true);
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
        await screen.findByText('Synthetic X');
        expect(entry.save).toHaveBeenCalledTimes(1);
      }
    );
    it.each([['Synthetic Base'], ['Synthetic Base', 'Synthetic Y']])(
      entry.key + ': rejection and snapshot %j preserve draft and newest base for retry',
      async (...server) => {
        await catalogs.put({ id: entry.key, list: ['Synthetic Base'], lastUpdated: 'synthetic' });
        vi.mocked(entry.save).mockRejectedValue(failure);
        const { wrapper } = createQueryClientTestWrapper();
        render(<Manager entry={entry} />, { wrapper });
        await screen.findByText('Synthetic Base');
        add();
        await screen.findByText(/no se guardó/i);
        expect(screen.queryByText(/Se guardó localmente/)).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('Nombre completo…')).toHaveValue('Synthetic X');
        expect((await catalogs.get(entry.key))?.list).toEqual(['Synthetic Base']);
        const subscribe =
          entry.key === 'nurses' ? remote.subscribeToNurseCatalog : remote.subscribeToTensCatalog;
        const callback = vi.mocked(subscribe).mock.calls.at(-1)![0];
        await act(async () => {
          await callback(server);
        });
        expect((await catalogs.get(entry.key))?.list).toEqual(server);
        for (const name of server) await screen.findByText(name);
        expect(screen.getByPlaceholderText('Nombre completo…')).toHaveValue('Synthetic X');
        expect(screen.queryByText('Synthetic X')).not.toBeInTheDocument();
        vi.mocked(entry.save).mockResolvedValue(undefined);
        fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
        await screen.findByText('Synthetic X');
        expect(entry.save).toHaveBeenLastCalledWith([...server, 'Synthetic X']);
      }
    );
    it(entry.key + ': rejection keeps rename editor through snapshot', async () => {
      await catalogs.put({ id: entry.key, list: ['Synthetic Base'], lastUpdated: 'synthetic' });
      vi.mocked(entry.save).mockRejectedValue(failure);
      const { wrapper } = createQueryClientTestWrapper();
      render(<Manager entry={entry} />, { wrapper });
      await screen.findByText('Synthetic Base');
      fireEvent.click(screen.getByTitle('Editar'));
      fireEvent.change(screen.getByDisplayValue('Synthetic Base'), {
        target: { value: 'Synthetic Renamed' },
      });
      fireEvent.click(screen.getByTitle('Guardar'));
      await screen.findByText(/no se guardó/i);
      expect(screen.getByDisplayValue('Synthetic Renamed')).toBeInTheDocument();
      expect((await catalogs.get(entry.key))?.list).toEqual(['Synthetic Base']);
    });
  }
  it('physicians: rejected specialty stays in editor across snapshot and retries', async () => {
    const base = [{ name: 'Synthetic Physician', phone: '', specialty: 'Pediatría' }];
    await catalogs.put({ id: 'professionals', list: base, lastUpdated: 'synthetic' });
    vi.mocked(remote.saveProfessionalsCatalogToFirestore).mockRejectedValue(failure);
    const { wrapper } = createQueryClientTestWrapper();
    render(<TreatingPhysiciansSettings />, { wrapper });
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'Cirugía' } });
    await screen.findByText(/El cambio no se guardó/);
    expect(select).toHaveValue('Cirugía');
    expect((await catalogs.get('professionals'))?.list).toEqual(base);
    const callback = vi.mocked(remote.subscribeToProfessionalsCatalog).mock.calls.at(-1)![0];
    await act(async () => {
      await callback(base);
    });
    expect(select).toHaveValue('Cirugía');
    vi.mocked(remote.saveProfessionalsCatalogToFirestore).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar guardado' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Cirugía'));
    await waitFor(async () =>
      expect((await catalogs.get('professionals'))?.list).toEqual([
        expect.objectContaining({ specialty: 'Cirugía' }),
      ])
    );
  });
  it('disabled remote runtime cannot claim a shared save', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    await catalogs.put({ id: 'nurses', list: ['Synthetic Base'], lastUpdated: 'synthetic' });
    const { wrapper } = createQueryClientTestWrapper();
    render(<Manager entry={cases[0]} />, { wrapper });
    await screen.findByText('Synthetic Base');
    add();
    await screen.findByText(/El cambio no se guardó/);
    expect(screen.getByPlaceholderText('Nombre completo…')).toHaveValue('Synthetic X');
    expect((await catalogs.get('nurses'))?.list).toEqual(['Synthetic Base']);
  });

  it('accepted remote save remains successful if the local cache fails', async () => {
    await catalogs.put({ id: 'nurses', list: ['Synthetic Base'], lastUpdated: 'synthetic' });
    const failWrite = () => {
      throw failure;
    };
    catalogs.hook('updating', failWrite);
    try {
      const { wrapper } = createQueryClientTestWrapper();
      render(<Manager entry={cases[0]} />, { wrapper });
      await screen.findByText('Synthetic Base');
      add();
      await screen.findByText('Synthetic X');
      await waitFor(() => expect(screen.getByPlaceholderText('Nombre completo…')).toHaveValue(''));
      expect(remote.saveNurseCatalogToFirestore).toHaveBeenCalledWith([
        'Synthetic Base',
        'Synthetic X',
      ]);
      expect(screen.queryByText(/no se guardó/i)).not.toBeInTheDocument();
    } finally {
      catalogs.hook('updating').unsubscribe(failWrite);
    }
  });
});

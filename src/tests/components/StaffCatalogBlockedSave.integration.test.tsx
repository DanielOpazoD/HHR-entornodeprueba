import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogRecord } from '@/services/storage/indexeddb/indexedDbCatalogContracts';

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
import * as local from '@/services/storage/indexeddb/indexedDbCatalogService';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import * as remote from '@/services/storage/firestore';
import { useNursesQuery, useTensQuery } from '@/hooks/useStaffQuery';
import { NurseManagerModal } from '@/components/modals/NurseManagerModal';
import { TreatingPhysiciansSettings } from '@/features/admin/components/TreatingPhysiciansSettings';
import { TensManagerModal } from '@/components/modals/TensManagerModal';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

const catalogs: Table<CatalogRecord> = hospitalDB.table('catalogs');
const failure = new Error('synthetic unavailable');
const cases = [
  {
    key: 'nurses',
    query: useNursesQuery,
    read: remote.getNurseCatalogFromFirestore,
    save: remote.saveNurseCatalogToFirestore,
    name: 'Enfermero/a 1',
  },
  {
    key: 'tens',
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
describe('staff catalog blocked save visible integration', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
    await hospitalDB.open();
    await catalogs.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  for (const entry of cases) {
    it(`${entry.key}: preserves input after blocked save and can retry reading`, async () => {
      vi.mocked(entry.read).mockRejectedValue(failure);
      const localSave = vi.spyOn(local, 'saveCatalog');
      const { wrapper } = createQueryClientTestWrapper();
      render(<Manager entry={entry} />, { wrapper });
      await screen.findByText(entry.name);
      const input = screen.getByPlaceholderText('Nombre completo…');
      fireEvent.change(input, { target: { value: 'Synthetic Added' } });
      fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
      expect(await screen.findByText(/No se pudo leer la lista.*no se guardó/)).toBeInTheDocument();
      expect(screen.queryByText(/Se guardó localmente/)).not.toBeInTheDocument();
      expect(input).toHaveValue('Synthetic Added');
      expect(localSave).not.toHaveBeenCalled();
      expect(entry.save).not.toHaveBeenCalled();
      vi.mocked(entry.read).mockResolvedValue([]);
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
      );
      fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
      await waitFor(() =>
        expect(entry.save).toHaveBeenCalledWith(expect.arrayContaining(['Synthetic Added']))
      );
      expect((await catalogs.get(entry.key))?.list).toContain('Synthetic Added');
    });
    it(`${entry.key}: preserves the rename editor when the catalog read failed`, async () => {
      vi.mocked(entry.read).mockRejectedValue(failure);
      const { wrapper } = createQueryClientTestWrapper();
      render(<Manager entry={entry} />, { wrapper });
      await screen.findByText(entry.name);
      fireEvent.click(screen.getAllByTitle('Editar')[0]);
      const editor = screen.getByDisplayValue(entry.name);
      fireEvent.change(editor, { target: { value: 'Synthetic Renamed' } });
      fireEvent.click(screen.getByTitle('Guardar'));
      expect(await screen.findByText(/No se pudo leer la lista.*no se guardó/)).toBeInTheDocument();
      expect(editor).toHaveValue('Synthetic Renamed');
      expect(screen.getByTitle('Guardar')).toBeInTheDocument();
      expect(entry.save).not.toHaveBeenCalled();
      expect(await catalogs.get(entry.key)).toBeUndefined();
    });
    it(`${entry.key}: a failed IndexedDB write never claims a local save`, async () => {
      await catalogs.put({ id: entry.key, list: ['Synthetic Local'], lastUpdated: 'synthetic' });
      const failWrite = () => {
        throw failure;
      };
      catalogs.hook('updating', failWrite);
      vi.mocked(entry.save).mockRejectedValue(failure);
      try {
        const { wrapper } = createQueryClientTestWrapper();
        render(<Manager entry={entry} />, { wrapper });
        await screen.findByText('Synthetic Local');
        const input = screen.getByPlaceholderText('Nombre completo…');
        fireEvent.change(input, { target: { value: 'Synthetic Added' } });
        fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
        expect(await screen.findByText(/No se pudo guardar la lista/)).toBeInTheDocument();
        expect(input).toHaveValue('Synthetic Added');
        expect(screen.queryByText(/Se guardó localmente/)).not.toBeInTheDocument();
        expect(entry.save).not.toHaveBeenCalled();
        expect((await catalogs.get(entry.key))?.list).toEqual(['Synthetic Local']);
      } finally {
        catalogs.hook('updating').unsubscribe(failWrite);
      }
    });
    it(`${entry.key}: local save with remote failure still shows local confirmation`, async () => {
      vi.mocked(entry.read).mockResolvedValue([]);
      vi.mocked(entry.save).mockRejectedValue(failure);
      const { wrapper } = createQueryClientTestWrapper();
      render(<Manager entry={entry} />, { wrapper });
      await screen.findByText(entry.name);
      fireEvent.change(screen.getByPlaceholderText('Nombre completo…'), {
        target: { value: 'Synthetic Added' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
      expect(await screen.findByText(/Se guardó localmente/)).toBeInTheDocument();
      expect(await screen.findByText('Synthetic Added')).toBeInTheDocument();
      expect((await catalogs.get(entry.key))?.list).toContain('Synthetic Added');
    });
  }
  it('a failed IndexedDB write rejects a save and is tolerated only for a best-effort copy', async () => {
    await catalogs.put({ id: 'nurses', list: ['Synthetic Local'], lastUpdated: 'synthetic' });
    const failWrite = () => {
      throw failure;
    };
    catalogs.hook('updating', failWrite);
    try {
      await expect(local.saveCatalog('nurses', ['Synthetic Added'])).rejects.toThrow();
      await expect(
        local.cacheCatalogValues('nurses', ['Synthetic Added'])
      ).resolves.toBeUndefined();
      expect((await catalogs.get('nurses'))?.list).toEqual(['Synthetic Local']);
    } finally {
      catalogs.hook('updating').unsubscribe(failWrite);
    }
  });
  it('physicians: failed initial read offers retry and never claims an updated catalog', async () => {
    vi.mocked(remote.getProfessionalsCatalogFromFirestore).mockRejectedValue(failure);
    const { wrapper } = createQueryClientTestWrapper();
    render(<TreatingPhysiciansSettings />, { wrapper });
    expect(await screen.findByText(/No se pudo leer la lista de médicos/)).toBeInTheDocument();
    expect(screen.queryByText('Actualizado')).not.toBeInTheDocument();
    expect(remote.saveProfessionalsCatalogToFirestore).not.toHaveBeenCalled();
    vi.mocked(remote.getProfessionalsCatalogFromFirestore).mockResolvedValue([
      { name: 'Synthetic Physician', phone: '' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    const specialty = await screen.findByRole('combobox');
    fireEvent.change(specialty, { target: { value: 'Cirugía' } });
    await waitFor(() =>
      expect(remote.saveProfessionalsCatalogToFirestore).toHaveBeenCalledWith([
        expect.objectContaining({ specialty: 'Cirugía' }),
      ])
    );
  });
});

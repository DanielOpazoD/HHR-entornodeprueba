import 'fake-indexeddb/auto';
import React from 'react';
import { act, render, renderHook, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@/services/storage/indexeddb/indexedDbCore';
import { getAllRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import { exportDataJSONWithResult } from '@/services/exporters/exportService';
import { useFileOperations } from '@/hooks/useFileOperations';
import { PatientHistoryModal } from '@/components/modals/PatientHistoryModal';
import { RecoverCensusStaffButton } from '@/components/modals/RecoverCensusStaffButton';

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  save: vi.fn(),
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  getDocsFromServer: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
  collection: vi.fn(),
  query: vi.fn(),
}));
vi.mock('@/services/exporters/exportImportJson', () => ({
  importDataJSON: vi.fn(),
  importDataJSONDetailed: vi.fn(),
}));
vi.mock('@/services/exporters/exportDownload', () => ({ downloadBlob: mocks.download }));
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: mocks.success, error: mocks.error, warning: vi.fn() }),
}));
vi.mock('@/services/storage/firestore', () => ({
  getRecordPagesFromFirestore: async function* () {
    yield* [];
    throw new Error('synthetic remote failure');
  },
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: vi.fn() },
}));
vi.mock('@/services/staff/eloisaStaffRegistry', () => ({ saveDiscoveredStaff: mocks.save }));

const failRead = () =>
  vi
    .spyOn(core.hospitalDB.dailyRecords, 'toArray')
    .mockRejectedValue(new Error('synthetic local failure'));

describe('full local read consumers', () => {
  beforeEach(async () => {
    await core.ensureDbReady();
    await core.hospitalDB.dailyRecords.clear();
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());
  it('preserves a valid empty store and its backup', async () => {
    expect(await getAllRecords()).toEqual({});
    expect((await exportDataJSONWithResult()).status).toBe('success');
    mocks.download.mockClear();
    const { result } = renderHook(() => useFileOperations(null, vi.fn()));
    act(() => result.current.handleExportJSON());
    await waitFor(() => expect(mocks.success).toHaveBeenCalled(), { timeout: 10000 });
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it('reports export failure without a download or success notification', async () => {
    failRead();
    const { result } = renderHook(() => useFileOperations(null, vi.fn()));
    act(() => result.current.handleExportJSON());
    await waitFor(() => expect(mocks.error).toHaveBeenCalled(), { timeout: 10000 });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it('shows history failure instead of claiming no movements', async () => {
    failRead();
    render(<PatientHistoryModal isOpen onClose={vi.fn()} patientRut="11111111-1" />);
    expect(await screen.findByText('Error al cargar el historial.')).toBeInTheDocument();
    expect(screen.queryByText(/No hay movimientos disponibles localmente/)).not.toBeInTheDocument();
  });
  it('rejects staff recovery before publishing an incomplete catalog', async () => {
    failRead();
    const { recoverCensusStaff } = await import('@/services/staff/recoverCensusStaff');
    await expect(recoverCensusStaff(vi.fn())).rejects.toThrow('synthetic local failure');
    render(<RecoverCensusStaffButton />);
    fireEvent.click(screen.getByRole('button', { name: /Buscar profesionales/ }));
    expect(await screen.findByText(/No se pudo completar la búsqueda/)).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

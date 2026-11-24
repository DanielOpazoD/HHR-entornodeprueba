import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { reconcileAuthorizedSessionOwner } from '@/services/session/sessionScopedStorageService';
import { setSessionGeneration } from '@/services/session/sessionStorageTransition';
import { buildSyncQueueTelemetryFromRows } from '@/services/storage/sync/syncQueueTelemetryController';
import { toSyncQueueOperationSnapshot } from '@/services/storage/sync/syncQueueOperationSnapshot';
import { buildSyncQueueStats } from '@/features/rayen-import/hooks/syncQueueMonitorController';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const OWNER = 'user:synthetic-panel-discard';
let id: number;
const task: SyncTask = {
  opId: 'synthetic-panel-send',
  type: 'UPDATE_DAILY_RECORD',
  key: 'daily:2026-10-22',
  payload: { date: '2026-10-22', beds: {}, nurses: ['SYNTHETIC ORIGINAL'] },
  timestamp: 1,
  retryCount: 0,
  status: 'FAILED',
  ownerKey: OWNER,
  lastErrorCategory: 'authorization',
  lastErrorCode: 'permission-denied',
};

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await hospitalDB.syncQueue.clear();
  await reconcileAuthorizedSessionOwner(OWNER);
  id = await hospitalDB.syncQueue.add(structuredClone(task));
});

afterEach(() => {
  vi.restoreAllMocks();
  setSessionGeneration(null);
  localStorage.clear();
});

const openPanel = async () => {
  const load = async () => {
    const rows = await hospitalDB.syncQueue.toArray();
    return {
      stats: buildSyncQueueStats(buildSyncQueueTelemetryFromRows(rows, Date.now(), 5)),
      operations: rows.map(toSyncQueueOperationSnapshot),
    };
  };
  const initial = await load();
  const refresh = async () => {
    const props = await load();
    view.rerender(<RayenSyncQueueDetails {...props} working={false} refresh={refresh} />);
  };
  const view = render(<RayenSyncQueueDetails {...initial} working={false} refresh={refresh} />);
  fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
  return view;
};

it('lets the user cancel one-step discard without changing the blocked send', async () => {
  await openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Descartar envío' }));
  expect(screen.getByText(/Estos cambios no se enviarán/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByText(/Estos cambios no se enviarán/)).not.toBeInTheDocument();
  expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...task, id });
});

it('deletes the blocked send on one-step confirmation without rendering a discarded-sends bin', async () => {
  await openPanel();
  expect(screen.queryByText('Envíos descartados')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Descartar envío' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar envío' }));
  await waitFor(() =>
    expect(screen.queryByText('Guardado local · 1 por revisar')).not.toBeInTheDocument()
  );
  expect(screen.queryByText('Envíos descartados')).not.toBeInTheDocument();
  expect(await hospitalDB.syncQueue.get(id)).toBeUndefined();
});

it('keeps the failed send visible when its discard cannot be persisted', async () => {
  await openPanel();
  vi.spyOn(hospitalDB.syncQueue, 'delete').mockRejectedValueOnce(
    new Error('synthetic storage failure')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Descartar envío' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar envío' }));
  await screen.findByText(/El envío sigue pendiente/);
  expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...task, id });
  expect(screen.getByText('Guardado local · 1 por revisar')).toBeVisible();
});

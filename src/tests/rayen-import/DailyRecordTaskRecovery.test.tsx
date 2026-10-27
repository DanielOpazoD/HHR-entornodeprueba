import 'fake-indexeddb/auto';
import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { buildSyncQueueTelemetryFromRows } from '@/services/storage/sync/syncQueueTelemetryController';
import { toSyncQueueOperationSnapshot } from '@/services/storage/sync/syncQueueOperationSnapshot';
import { buildSyncQueueStats } from '@/hooks/controllers/syncQueueMonitorController';
import { downloadBlob } from '@/services/exporters/exportDownload';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

vi.mock('@/services/exporters/exportDownload', () => ({ downloadBlob: vi.fn() }));
const OWNER = 'user:synthetic-panel-retirement';
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
  await hospitalDB.syncQueue.clear();
  localStorage.setItem(SESSION_OWNER_KEY, OWNER);
  localStorage.setItem(SESSION_GENERATION_KEY, 'synthetic-panel-generation');
  setSessionGeneration('synthetic-panel-generation');
  id = await hospitalDB.syncQueue.add(structuredClone(task));
});
afterEach(() => {
  vi.restoreAllMocks();
  setSessionGeneration(null);
  localStorage.removeItem(SESSION_OWNER_KEY);
  localStorage.removeItem(SESSION_GENERATION_KEY);
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
  fireEvent.click(screen.getByText('Guardado local · 1 por enviar'));
  fireEvent.click(screen.getByRole('button', { name: 'Descartar envío' }));
  await screen.findByText('Ya revisé el censo compartido y no necesito enviar estos cambios.');
  return view;
};

it('lets the user cancel without changing the blocked send', async () => {
  await openPanel();
  expect(screen.getByRole('button', { name: 'Sí, descartar envío' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...task, id });
});

it('removes the pending indicator only after confirmation and exposes the original backup', async () => {
  await openPanel();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar envío' }));
  await screen.findByRole('button', { name: 'Descargar respaldo' });
  expect(screen.queryByText('Guardado local · 1 por enviar')).not.toBeInTheDocument();
  expect(
    screen.getByText(/no se reintentan ni cuentan como guardados en el servidor/)
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Descargar respaldo' }));
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
  const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
  const contents = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
  expect(filename).toBe(`hhr-envio-local-${id}.json`);
  expect(JSON.parse(contents)).toMatchObject({
    remotelyConfirmed: false,
    task: { payload: task.payload, retirement: { reason: 'manual_discard' } },
  });
});

it('leaves the newer send pending when another tab changes it while the confirmation is open', async () => {
  await openPanel();
  const payload = { date: '2026-10-22', beds: {}, nurses: ['SYNTHETIC NEW EDIT'] };
  await hospitalDB.syncQueue.update(id, { payload });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar envío' }));
  await screen.findByText(/No se pudo completar la acción/);
  expect(await hospitalDB.syncQueue.get(id)).toMatchObject({ status: 'FAILED', payload });
  expect(screen.getByText('Guardado local · 1 por enviar')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Descargar respaldo' })).not.toBeInTheDocument();
});

it('keeps the failed send visible when its retirement cannot be persisted', async () => {
  await openPanel();
  vi.spyOn(hospitalDB.syncQueue, 'update').mockRejectedValueOnce(
    new Error('synthetic storage failure')
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar envío' }));
  await screen.findByText(/No se pudo completar la acción/);
  expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...task, id });
  expect(screen.getByText('Guardado local · 1 por enviar')).toBeVisible();
});

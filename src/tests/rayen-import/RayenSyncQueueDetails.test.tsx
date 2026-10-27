import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import type { SyncQueueOperation } from '@/hooks/useSyncQueueMonitor';
import { discardQuarantinedSyncTask, retryQuarantinedSyncTask } from '@/services/storage/sync';

vi.mock('@/services/storage/sync', () => ({
  retryQuarantinedSyncTask: vi.fn().mockResolvedValue(true),
  discardQuarantinedSyncTask: vi.fn().mockResolvedValue(true),
}));

beforeEach(() => vi.clearAllMocks());

it('keeps a baseless write for review while other failed writes can still retry', async () => {
  const operation: SyncQueueOperation = {
    id: 41,
    type: 'UPDATE_DAILY_RECORD',
    status: 'FAILED',
    retryCount: 0,
    timestamp: 1,
    key: 'daily:2026-10-24',
    lastErrorCategory: 'validation',
    lastErrorCode: 'functions/failed-precondition',
    error:
      '[validation/functions/failed-precondition] base_required: An existing daily record requires a verifiable base version.',
  };
  render(
    <RayenSyncQueueDetails
      stats={{ pending: 0, failed: 2, conflict: 0, retrying: 0, acked: 0, oldestPendingAgeMs: 0 }}
      operations={[
        operation,
        { ...operation, id: 42, key: 'daily:2026-10-25', error: 'Invalid field' },
      ]}
      working={false}
      refresh={vi.fn().mockResolvedValue(undefined)}
    />
  );
  fireEvent.click(screen.getByText('Guardado local · 2 por enviar'));
  const [blocked, retryable] = screen.getAllByRole('listitem');
  expect(within(blocked).getByText('Requiere revisión de la versión de origen')).toBeVisible();
  expect(within(blocked).getByText(/Los cambios siguen guardados en este equipo/)).toBeVisible();
  expect(within(blocked).getByRole('button', { name: 'Descartar envío' })).toBeVisible();
  expect(within(blocked).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  fireEvent.click(within(retryable).getByRole('button', { name: 'Reintentar' }));
  expect(retryQuarantinedSyncTask).toHaveBeenCalledExactlyOnceWith(42);
});

it.each(['UPDATE_SPECIALIST_HANDOFF', 'UPDATE_DAILY_RECORD'] as const)(
  'still requires confirmation to discard a refused occupant-bound write: %s',
  type => {
    render(
      <RayenSyncQueueDetails
        stats={{ pending: 0, failed: 0, conflict: 1, retrying: 0, acked: 0, oldestPendingAgeMs: 0 }}
        operations={[
          {
            id: 43,
            type,
            status: 'CONFLICT',
            retryCount: 0,
            timestamp: 1,
            key: 'daily:2026-10-24:detached:43:[]',
          },
        ]}
        working={false}
        refresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    fireEvent.click(screen.getByText('Guardado local · 1 por enviar'));
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(discardQuarantinedSyncTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar envío' }));
    expect(discardQuarantinedSyncTask).toHaveBeenCalledExactlyOnceWith(43);
  }
);

it('offers a confirmed retirement for a census blocked by permissions', async () => {
  render(
    <RayenSyncQueueDetails
      stats={{ pending: 0, failed: 1, conflict: 0, retrying: 0, acked: 0, oldestPendingAgeMs: 0 }}
      operations={[
        {
          id: 51,
          type: 'UPDATE_DAILY_RECORD',
          status: 'FAILED',
          retryCount: 0,
          timestamp: 1,
          key: 'daily:2026-10-22',
          lastErrorCategory: 'authorization',
          lastErrorCode: 'permission-denied',
        },
      ]}
      working={false}
      refresh={vi.fn().mockResolvedValue(undefined)}
    />
  );
  fireEvent.click(screen.getByText('Guardado local · 1 por enviar'));
  expect(await screen.findByRole('button', { name: 'Descartar envío' })).toBeVisible();
});

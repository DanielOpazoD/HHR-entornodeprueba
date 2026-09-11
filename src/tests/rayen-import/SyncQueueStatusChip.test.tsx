import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncQueueStatusChip } from '@/features/rayen-import/components/SyncQueueStatusChip';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  retryQuarantinedSyncTask: vi.fn().mockResolvedValue(true),
  discardQuarantinedSyncTask: vi.fn().mockResolvedValue(true),
  useSyncQueueMonitor: vi.fn(),
}));

vi.mock('@/hooks/useSyncQueueMonitor', () => ({
  useSyncQueueMonitor: mocks.useSyncQueueMonitor,
}));

vi.mock('@/services/storage/sync', () => ({
  retryQuarantinedSyncTask: mocks.retryQuarantinedSyncTask,
  discardQuarantinedSyncTask: mocks.discardQuarantinedSyncTask,
}));

describe('SyncQueueStatusChip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSyncQueueMonitor.mockReturnValue({
      stats: {
        pending: 1,
        failed: 0,
        retrying: 1,
        acked: 0,
        conflict: 0,
        oldestPendingAgeMs: 6 * 60_000,
      },
      operations: [
        {
          id: 21,
          type: 'UPDATE_DAILY_RECORD',
          status: 'PENDING',
          retryCount: 2,
          timestamp: Date.now() - 6 * 60_000,
          lastErrorAt: Date.now() - 60_000,
          key: 'daily:2026-09-07',
        },
      ],
      refresh: mocks.refresh,
      hasQueueIssues: true,
    });
  });

  it('explica que la tarea puede estar atascada y muestra trazabilidad temporal', () => {
    render(<SyncQueueStatusChip open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId('sync-queue-status-chip')).toHaveTextContent('1 por revisar');
    const pending = screen.getByText(/Censo 2026-09-07/).closest('p');
    expect(pending).not.toBeNull();
    expect(pending).toHaveTextContent('Censo 2026-09-07');
    expect(pending).toHaveTextContent('Posible atasco');
    expect(pending).toHaveTextContent('Último intento fallido:');
    expect(pending).not.toHaveTextContent('en camino al servidor');
  });

  it('atribuye el atasco a la tarea más antigua y no inventa censos para otras claves', () => {
    const current = mocks.useSyncQueueMonitor();
    mocks.useSyncQueueMonitor.mockReturnValue({
      ...current,
      operations: [
        {
          id: 30,
          type: 'UPDATE_DAILY_RECORD',
          status: 'PENDING',
          retryCount: 0,
          timestamp: Date.now(),
        },
        {
          id: 31,
          type: 'UPDATE_DAILY_RECORD',
          status: 'PENDING',
          retryCount: 1,
          timestamp: Date.now() - 6 * 60_000,
          lastErrorAt: Date.now() - 60_000,
          key: 'daily:2026-09-06',
        },
      ],
    });

    const { rerender } = render(<SyncQueueStatusChip open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/Censo 2026-09-06/)).toHaveTextContent('Posible atasco');

    mocks.useSyncQueueMonitor.mockReturnValue({
      ...current,
      operations: [
        { id: 32, type: 'UPDATE_PATIENT', status: 'PENDING', retryCount: 0, timestamp: 1 },
      ],
    });
    rerender(<SyncQueueStatusChip open onOpenChange={vi.fn()} />);
    expect(screen.queryByText(/Censo/)).not.toBeInTheDocument();
  });

  it('comprueba la cola explícitamente sin eliminar la tarea', async () => {
    render(<SyncQueueStatusChip open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Comprobar ahora' }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.discardQuarantinedSyncTask).not.toHaveBeenCalled();
  });
});

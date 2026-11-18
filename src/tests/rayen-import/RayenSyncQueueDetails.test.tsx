import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import type { SyncQueueOperation } from '@/hooks/useSyncQueueMonitor';
import { discardQuarantinedSyncTask, retryQuarantinedSyncTask } from '@/services/storage/sync';

vi.mock('@/services/storage/sync', () => ({
  retryQuarantinedSyncTask: vi.fn().mockResolvedValue(true),
  discardQuarantinedSyncTask: vi.fn().mockResolvedValue(true),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

/** 15:00 Rapa Nui on the day: the nurse editing window of `daily:2026-10-22` is still open. */
const insideWindowOf20261022 = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T20:00:00Z'));
};

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
  fireEvent.click(screen.getByText('Guardado local · 2 por revisar'));
  const [blocked, retryable] = screen.getAllByRole('listitem');
  expect(within(blocked).getByText('Revisar antes de reenviar')).toBeVisible();
  expect(within(blocked).getByText(/Los cambios siguen guardados en este equipo/)).toBeVisible();
  expect(within(blocked).getByRole('button', { name: 'Descartar envío' })).toBeVisible();
  expect(within(blocked).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  fireEvent.click(within(retryable).getByRole('button', { name: 'Reintentar' }));
  expect(retryQuarantinedSyncTask).toHaveBeenCalledExactlyOnceWith(42);
});

it.each(['UPDATE_DAILY_RECORD'] as const)(
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
    fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
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
  fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
  expect(await screen.findByRole('button', { name: 'Descartar envío' })).toBeVisible();
});

it.each([
  ['permission-denied', 'Sin permisos', 'El servidor rechazó este envío por permisos.'],
  [
    'functions/unauthenticated',
    'Sesión no validada',
    'El servidor todavía no validó la sesión de este envío.',
  ],
])(
  'requires review before manually retrying %s, while retaining discard',
  async (code, category, guidance) => {
    insideWindowOf20261022();
    render(
      <RayenSyncQueueDetails
        stats={{ pending: 0, failed: 1, conflict: 0, retrying: 0, acked: 0, oldestPendingAgeMs: 0 }}
        operations={[
          {
            id: 61,
            type: 'UPDATE_DAILY_RECORD',
            status: 'FAILED',
            retryCount: 0,
            timestamp: 1,
            key: 'daily:2026-10-22',
            lastErrorCategory: 'authorization',
            lastErrorCode: code,
          },
        ]}
        working={false}
        refresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
    expect(screen.getByText(category)).toBeVisible();
    expect(screen.getByText(guidance, { exact: false })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Descartar envío' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Revisar reintento'));
    expect(retryQuarantinedSyncTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ya revisé, reintentar' }));
    expect(retryQuarantinedSyncTask).toHaveBeenCalledExactlyOnceWith(61);
  }
);

it('offers retirement with a backup, not a retry, for a census a closed session left unsent', () => {
  render(
    <RayenSyncQueueDetails
      stats={{ pending: 0, failed: 1, conflict: 0, retrying: 0, acked: 0, oldestPendingAgeMs: 0 }}
      operations={[
        {
          id: 44,
          type: 'UPDATE_DAILY_RECORD',
          status: 'FAILED',
          retryCount: 0,
          timestamp: 1,
          key: 'daily:2026-10-24',
          lastErrorCategory: 'authorization',
          lastErrorCode: 'session_owner_logged_out',
          projectionReleased: true,
        },
      ]}
      working={false}
      refresh={vi.fn().mockResolvedValue(undefined)}
    />
  );
  fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
  const [blocked] = screen.getAllByRole('listitem');
  expect(within(blocked).getByText('Sesión cerrada')).toBeVisible();
  expect(within(blocked).getByText(/quedó pendiente al cerrar sesión/)).toBeVisible();
  expect(within(blocked).getByText(/No se puede reenviar/)).toBeVisible();
  expect(within(blocked).queryByText(/antes de reenviarlos/)).not.toBeInTheDocument();
  expect(within(blocked).queryByText(/versión del servidor/)).not.toBeInTheDocument();
  expect(within(blocked).getByRole('button', { name: 'Descartar envío' })).toBeVisible();
  expect(within(blocked).queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
  expect(within(blocked).queryByText('Revisar reintento')).not.toBeInTheDocument();
  expect(retryQuarantinedSyncTask).not.toHaveBeenCalled();
});

it('never promises a resend for a released census that kept an earlier diagnosis', () => {
  render(
    <RayenSyncQueueDetails
      stats={{ pending: 0, failed: 1, conflict: 0, retrying: 0, acked: 0, oldestPendingAgeMs: 0 }}
      operations={[
        {
          id: 45,
          type: 'UPDATE_DAILY_RECORD',
          status: 'FAILED',
          retryCount: 0,
          timestamp: 1,
          key: 'daily:2026-10-24',
          lastErrorCategory: 'validation',
          lastErrorCode: 'functions/failed-precondition',
          projectionReleased: true,
        },
      ]}
      working={false}
      refresh={vi.fn().mockResolvedValue(undefined)}
    />
  );
  fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
  const [blocked] = screen.getAllByRole('listitem');
  expect(within(blocked).getByText('Sin copia local')).toBeVisible();
  expect(within(blocked).getByText(/No se puede reenviar/)).toBeVisible();
  expect(within(blocked).queryByText(/antes de reenviarlos/)).not.toBeInTheDocument();
  expect(within(blocked).getByRole('button', { name: 'Descartar envío' })).toBeVisible();
});

// Shape left by the queue when the rules refuse a send after the day's 48 h closed (W14-H1M).
const RULES_REFUSAL =
  "[authorization/permission-denied] 7 PERMISSION_DENIED: \nevaluation error at L518:26 for 'update' @ L518";
const closedWindowSend: SyncQueueOperation = {
  id: 71,
  type: 'UPDATE_DAILY_RECORD',
  status: 'FAILED',
  retryCount: 0,
  timestamp: 1,
  key: 'daily:2026-10-22',
  lastErrorCategory: 'authorization',
  lastErrorCode: 'permission-denied',
  error: RULES_REFUSAL,
};
const renderStopped = (operation: SyncQueueOperation, isAdmin?: boolean) =>
  render(
    <RayenSyncQueueDetails
      stats={{ pending: 0, failed: 1, conflict: 0, retrying: 0, acked: 0, oldestPendingAgeMs: 0 }}
      operations={[operation]}
      working={false}
      refresh={vi.fn().mockResolvedValue(undefined)}
      isAdmin={isAdmin}
    />
  );

it('says the editing window closed, offers only the discard with its copy, and never a retry', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // 48 h and one minute after midnight of 22-10 in Rapa Nui (UTC-5 since September).
  vi.setSystemTime(new Date('2026-10-24T05:01:00Z'));
  renderStopped(closedWindowSend);
  fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
  const [blocked] = screen.getAllByRole('listitem');
  expect(within(blocked).getByText('Plazo de edición cerrado')).toBeVisible();
  expect(within(blocked).getByText(/plazo de 48 h para editar este día cerró/)).toBeVisible();
  expect(within(blocked).getByText(/Quedó solo en este equipo y no se enviará/)).toBeVisible();
  expect(within(blocked).queryByText('Sin permisos')).not.toBeInTheDocument();
  expect(within(blocked).queryByText(/acceso de tu cuenta/)).not.toBeInTheDocument();
  expect(within(blocked).queryByText('Revisar reintento')).not.toBeInTheDocument();
  expect(within(blocked).queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
  expect(
    within(blocked)
      .getAllByRole('button')
      .map(button => button.textContent)
  ).toEqual(['Descartar envío']);
  expect(screen.queryByText(/por enviar/)).not.toBeInTheDocument();
});

it('keeps «Sin permisos» one minute before the window closes', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T04:59:00Z'));
  renderStopped(closedWindowSend);
  fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
  expect(screen.getByText('Sin permisos')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Ya revisé, reintentar' })).toBeInTheDocument();
});

// Reviewer probe (W14-H1A review): only a real day whose window already passed proves a closure.
it.each(['daily:2026-11-20', 'daily:2026-02-30', 'daily:invalid', undefined])(
  'keeps «Sin permisos» and «Ya revisé, reintentar» for %s, which proves no closure',
  key => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
    renderStopped({ ...closedWindowSend, key });
    fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
    expect(screen.queryByText('Plazo de edición cerrado')).not.toBeInTheDocument();
    expect(screen.getByText('Sin permisos')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ya revisé, reintentar' })).toBeInTheDocument();
  }
);

it('keeps «Sin permisos» for the administrator, who has no editing window', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
  renderStopped(closedWindowSend, true);
  fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
  expect(screen.getByText('Sin permisos')).toBeVisible();
  expect(screen.queryByText('Plazo de edición cerrado')).not.toBeInTheDocument();
});

it('shows the raw refusal only to the administrator', () => {
  const { unmount } = renderStopped(closedWindowSend);
  fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
  expect(screen.queryByText('Detalle técnico')).not.toBeInTheDocument();
  expect(screen.queryByText(/PERMISSION_DENIED|evaluation error/)).not.toBeInTheDocument();
  unmount();
  renderStopped(closedWindowSend, true);
  fireEvent.click(screen.getByText('Guardado local · 1 por revisar'));
  fireEvent.click(screen.getByText('Detalle técnico'));
  expect(screen.getByText('permission-denied')).toBeVisible();
  expect(screen.getByText(/evaluation error at L518:26/)).toBeVisible();
});

it('counts what will be sent apart from what stopped and waits for a decision', () => {
  render(
    <RayenSyncQueueDetails
      stats={{ pending: 2, failed: 1, conflict: 1, retrying: 1, acked: 0, oldestPendingAgeMs: 0 }}
      operations={[]}
      working={false}
      refresh={vi.fn().mockResolvedValue(undefined)}
    />
  );
  expect(screen.getByText('Guardado local · 2 por enviar · 2 por revisar')).toBeInTheDocument();
});

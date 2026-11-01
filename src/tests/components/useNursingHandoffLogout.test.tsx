import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNursingHandoffLogout } from '@/hooks/useNursingHandoffLogout';
import NursingHandoffLogoutDialog from '@/components/layout/NursingHandoffLogoutDialog';
import NursingHandoffSessionNotice from '@/components/layout/NursingHandoffSessionNotice';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type { AuthUser } from '@/types/authRoleTypes';

const { attempt, backup, resume } = vi.hoisted(() => ({
  attempt: vi.fn(),
  backup: vi.fn(),
  resume: vi.fn(),
}));
vi.mock('@/services/storage/sync/nursingHandoffSession', () => ({
  attemptNursingHandoffLogout: attempt,
  downloadPendingNursingHandoff: backup,
  resumeOwnedNursingHandoff: resume,
}));
const user: AuthUser = {
  uid: 'synthetic-A',
  email: 'a@hospital.test',
  displayName: 'Enfermera A',
  role: 'nurse_hospital',
};
const close = vi.fn().mockResolvedValue(undefined);
const Surface = () => {
  const { handleLogout, logoutPrompt } = useNursingHandoffLogout(user, close);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void handleLogout().finally(() => setBusy(false));
        }}
      >
        {busy ? 'Guardando…' : 'Cerrar sesión'}
      </button>
      {logoutPrompt && <NursingHandoffLogoutDialog {...logoutPrompt} />}
    </>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-A');
  setSessionGeneration('synthetic-generation');
  attempt.mockResolvedValue(false);
  backup.mockResolvedValue(undefined);
  resume.mockResolvedValue([]);
  // JSDOM has no modal top layer; simulate only the native visibility change.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  setSessionGeneration(null);
});

it('holds the session while sending and closes only after confirmation, without a dialog', async () => {
  let confirm!: (value: boolean) => void;
  attempt.mockImplementation(
    () =>
      new Promise<boolean>(resolve => {
        confirm = resolve;
      })
  );
  render(<Surface />);
  fireEvent.click(screen.getByText('Cerrar sesión'));
  expect(screen.getByText('Guardando…')).toBeDisabled();
  await vi.waitFor(() => expect(attempt).toHaveBeenCalledOnce());
  expect(close).not.toHaveBeenCalled();
  await act(async () => confirm(true));
  expect(close).toHaveBeenCalledWith('manual');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('shows exactly three choices after failure; Cancel keeps the current session and work', async () => {
  render(<Surface />);
  fireEvent.click(screen.getByText('Cerrar sesión'));
  const dialog = await screen.findByRole('dialog', { name: 'Entrega de turno sin enviar' });
  expect(dialog.querySelectorAll('button')).toHaveLength(3);
  expect(screen.getByText('Reintentar')).toBeVisible();
  expect(screen.getByText('Descargar copia y salir')).toBeVisible();
  fireEvent.click(screen.getByText('Cancelar'));
  await screen.findByText('Cerrar sesión');
  expect(close).not.toHaveBeenCalled();
  expect(backup).not.toHaveBeenCalled();
  expect(localStorage.getItem(SESSION_OWNER_KEY)).toBe('user:synthetic-A');
});

it('retries the existing send, closes on confirmation and never downloads a backup', async () => {
  attempt.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<Surface />);
  fireEvent.click(screen.getByText('Cerrar sesión'));
  fireEvent.click(await screen.findByText('Reintentar'));
  await vi.waitFor(() => expect(close).toHaveBeenCalledWith('manual'));
  expect(attempt).toHaveBeenCalledTimes(2);
  expect(backup).not.toHaveBeenCalled();
});

it('downloads before closing, without claiming that the retained work was confirmed', async () => {
  const order: string[] = [];
  backup.mockImplementation(async () => {
    order.push('download');
  });
  close.mockImplementation(async () => {
    order.push('logout');
  });
  render(<Surface />);
  fireEvent.click(screen.getByText('Cerrar sesión'));
  fireEvent.click(await screen.findByText('Descargar copia y salir'));
  await vi.waitFor(() => expect(order).toEqual(['download', 'logout']));
  expect(backup).toHaveBeenCalledWith('user:synthetic-A');
});

it('keeps the session and offers the three choices again if downloading fails', async () => {
  backup.mockRejectedValueOnce(new Error('synthetic unavailable disk'));
  render(<Surface />);
  fireEvent.click(screen.getByText('Cerrar sesión'));
  fireEvent.click(await screen.findByText('Descargar copia y salir'));
  expect(await screen.findByRole('status')).toHaveTextContent('No se pudo descargar la copia');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Cancelar'));
});

it('closes without a dialog when there is no nursing handoff, as reported by the queue inspection', async () => {
  attempt.mockResolvedValue(true);
  render(<Surface />);
  fireEvent.click(screen.getByText('Cerrar sesión'));
  await vi.waitFor(() => expect(close).toHaveBeenCalledWith('manual'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('bounds an automatic logout at ten seconds even if sending never settles', async () => {
  vi.useFakeTimers();
  attempt.mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useNursingHandoffLogout(user, close));
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.handleLogout('automatic');
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9_999);
  });
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
    await operation;
  });
  expect(close).toHaveBeenCalledWith('automatic');
  expect(result.current.logoutPrompt).toBeNull();
});

it('bounds a manual logout at ten seconds and lets the user cancel its unresolved send', async () => {
  vi.useFakeTimers();
  attempt.mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useNursingHandoffLogout(user, close));
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.handleLogout();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(close).not.toHaveBeenCalled();
  expect(result.current.logoutPrompt).not.toBeNull();
  await act(async () => {
    result.current.logoutPrompt?.choose('cancel');
    await operation;
  });
  expect(close).not.toHaveBeenCalled();
});

it('automatic expiration resolves an open manual dialog without extending the session', async () => {
  const { result } = renderHook(() => useNursingHandoffLogout(user, close));
  let manual!: Promise<void>;
  act(() => {
    manual = result.current.handleLogout();
  });
  await vi.waitFor(() => expect(result.current.logoutPrompt).not.toBeNull());
  await act(async () => {
    await result.current.handleLogout('automatic');
    await manual;
  });
  expect(close).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledWith('automatic');
});

it('cannot close B after the admitted identity changes while A waits', async () => {
  let finish!: (value: boolean) => void;
  attempt.mockImplementation(
    () =>
      new Promise<boolean>(resolve => {
        finish = resolve;
      })
  );
  const { result } = renderHook(() => useNursingHandoffLogout(user, close));
  let operation!: Promise<void>;
  act(() => {
    operation = result.current.handleLogout();
  });
  await vi.waitFor(() => expect(attempt).toHaveBeenCalledOnce());
  localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-B');
  setSessionGeneration('B-generation');
  await act(async () => {
    finish(true);
    await operation;
  });
  expect(close).not.toHaveBeenCalled();
});

it('B sees one dismissible staff-only notice containing no handoff content', async () => {
  resume.mockResolvedValue(['Enfermera A']);
  render(<NursingHandoffSessionNotice uid="synthetic-B" />);
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Hay una entrega de turno de Enfermera A sin enviar en este equipo.'
  );
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(attempt).not.toHaveBeenCalled();
  expect(backup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso de entrega pendiente' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

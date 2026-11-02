/* @flake-safe: Date usage is limited to deriving a same-day key for deterministic reminder receipts. */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderCenterProvider } from '@/context/ReminderCenterContext';
import { useReminderCenter } from '@/hooks/useReminders';

const subscribeMock = vi.fn();
const getUserShiftReadStateMock = vi.fn();
const markAsReadWithResultMock = vi.fn();
let mockShift: 'day' | 'night' = 'day';
let mockRemoteSyncStatus: 'ready' | 'bootstrapping' | 'local_only' = 'ready';

const getCurrentDateKey = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: {
      uid: 'user-1',
      email: 'nurse@hospitalhangaroa.cl',
      displayName: 'Enfermera Test',
    },
    user: {
      uid: 'user-1',
      email: 'nurse@hospitalhangaroa.cl',
      displayName: 'Enfermera Test',
    },
    role: 'nurse_hospital',
    isAuthenticated: true,
    remoteSyncStatus: mockRemoteSyncStatus,
  }),
}));

vi.mock('@/services/reminders/ReminderImageService', () => ({
  ReminderImageService: {
    uploadImage: vi.fn(),
    deleteImage: vi.fn(),
  },
}));

vi.mock('@/services/reminders/ReminderRepository', () => ({
  ReminderRepository: {
    subscribe: (...args: unknown[]) => subscribeMock(...args),
  },
}));

vi.mock('@/services/reminders/ReminderReadService', () => ({
  ReminderReadService: {
    getUserShiftReadState: (...args: unknown[]) => getUserShiftReadStateMock(...args),
    markAsReadWithResult: (...args: unknown[]) => markAsReadWithResultMock(...args),
    buildReceipt: vi.fn(({ userId, userName, shift, dateKey }) => ({
      userId,
      userName,
      shift,
      dateKey,
      readAt: '2026-03-15T12:00:00.000Z',
    })),
  },
}));

vi.mock('@/services/reminders/reminderErrorPolicy', () => ({
  resolveReminderAdminErrorMessage: vi.fn(() => 'No fue posible cargar avisos.'),
}));

vi.mock('@/services/admin/attributionService', () => ({
  getCurrentShift: () => mockShift,
}));

const reminder = {
  id: 'rem-1',
  title: 'Actualizar carro de paro',
  message: 'Revisar checklist antes de las 09:00.',
  type: 'urgent',
  targetRoles: ['nurse_hospital'],
  targetShifts: ['day'],
  startDate: '2026-03-01',
  endDate: '2099-12-31',
  priority: 3,
  isActive: true,
  createdBy: 'admin-1',
  createdByName: 'Jefatura',
  createdAt: '2026-03-10T08:00:00.000Z',
  updatedAt: '2026-03-10T08:00:00.000Z',
} as const;

const ReminderProbe: React.FC = () => {
  const { unreadCount, isOpen, markReminderAsRead } = useReminderCenter();

  return (
    <div>
      <span data-testid="unread-count">{unreadCount}</span>
      <span data-testid="modal-state">{isOpen ? 'open' : 'closed'}</span>
      <button type="button" onClick={() => void markReminderAsRead('rem-1')}>
        mark
      </button>
    </div>
  );
};

describe('ReminderCenterProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShift = 'day';
    mockRemoteSyncStatus = 'ready';
    window.localStorage.clear();
    getUserShiftReadStateMock.mockResolvedValue({ status: 'unread' });
    markAsReadWithResultMock.mockResolvedValue({ status: 'success' });
    subscribeMock.mockImplementation((callback: (reminders: unknown[]) => void) => {
      callback([reminder]);
      return () => undefined;
    });
  });

  it('expone avisos no leidos sin autoabrir el centro', async () => {
    render(
      <ReminderCenterProvider>
        <ReminderProbe />
      </ReminderCenterProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('unread-count').textContent).toBe('1');
    });

    expect(screen.getByTestId('modal-state').textContent).toBe('closed');
  });

  it('marca un aviso como leido y reduce el contador', async () => {
    render(
      <ReminderCenterProvider>
        <ReminderProbe />
      </ReminderCenterProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('unread-count').textContent).toBe('1');
    });

    await act(async () => {
      fireEvent.click(screen.getByText('mark'));
    });

    await waitFor(() => {
      expect(markAsReadWithResultMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('unread-count').textContent).toBe('0');
    });

    expect(markAsReadWithResultMock).toHaveBeenCalledWith(
      'rem-1',
      expect.objectContaining({
        userId: 'user-1',
        shift: 'day',
        dateKey: getCurrentDateKey(),
      })
    );
  });

  it('vuelve a mostrar el aviso si cambia el turno o la fecha de lectura', async () => {
    getUserShiftReadStateMock.mockImplementation(
      async (_reminderId: string, _userId: string, shift: string, dateKey: string) => ({
        status: shift === 'day' && dateKey === getCurrentDateKey() ? 'read' : 'unread',
      })
    );

    render(
      <ReminderCenterProvider>
        <ReminderProbe />
      </ReminderCenterProvider>
    );

    await waitFor(() => {
      expect(getUserShiftReadStateMock).toHaveBeenCalledWith(
        'rem-1',
        'user-1',
        'day',
        getCurrentDateKey()
      );
      expect(screen.getByTestId('unread-count').textContent).toBe('0');
    });
  });

  it('no oculta el aviso si falla guardar el receipt de visto', async () => {
    markAsReadWithResultMock.mockResolvedValue({ status: 'permission_denied', error: new Error() });

    render(
      <ReminderCenterProvider>
        <ReminderProbe />
      </ReminderCenterProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('unread-count').textContent).toBe('1');
    });

    await act(async () => {
      fireEvent.click(screen.getByText('mark'));
    });

    await waitFor(() => {
      expect(markAsReadWithResultMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('unread-count').textContent).toBe('1');
    });
  });

  it('no autoabre el modal cuando la suscripcion falla por permisos', async () => {
    subscribeMock.mockImplementation(
      (
        callback: (reminders: unknown[]) => void,
        options?: { onError?: (error: unknown, kind: string) => void }
      ) => {
        options?.onError?.({ code: 'permission-denied' }, 'permission_denied');
        return () => undefined;
      }
    );

    render(
      <ReminderCenterProvider>
        <ReminderProbe />
      </ReminderCenterProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('unread-count').textContent).toBe('0');
    });

    expect(screen.getByTestId('modal-state').textContent).toBe('closed');
  });

  it('no abre suscripcion remota cuando el runtime esta local-only', async () => {
    mockRemoteSyncStatus = 'local_only';

    render(
      <ReminderCenterProvider>
        <ReminderProbe />
      </ReminderCenterProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('unread-count').textContent).toBe('0');
    });

    expect(subscribeMock).not.toHaveBeenCalled();
    expect(getUserShiftReadStateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('modal-state').textContent).toBe('closed');
  });
});

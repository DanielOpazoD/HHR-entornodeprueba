import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderCenterProvider } from '@/context/ReminderCenterContext';
import { ReminderBadge } from '@/components/reminders/ReminderBadge';
import { ReminderModal } from '@/components/reminders/ReminderModal';
import type { Reminder } from '@/types/reminders';

const mocks = vi.hoisted(() => ({
  next: (_snapshot: {
    metadata?: { fromCache?: boolean; hasPendingWrites?: boolean };
    docs: { id: string; data: () => Reminder }[];
  }) => {},
  fail: (_error: unknown) => {},
  recordEvent: vi.fn(),
  shift: 'day' as 'day' | 'night',
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  query: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn((_query, optionsOrNext, nextOrFail, maybeFail) => {
    const hasOptions = typeof optionsOrNext !== 'function';
    mocks.next = hasOptions ? nextOrFail : optionsOrNext;
    mocks.fail = hasOptions ? maybeFail : nextOrFail;
    return vi.fn();
  }),
}));
vi.mock('@/services/reminders/reminderShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/reminders/reminderShared')>()),
  getRemindersCollectionRef: vi.fn(),
}));
vi.mock('@/services/reminders/reminderObservability', () => ({
  reminderObservability: {
    logger: { error: vi.fn(), info: vi.fn() },
    recordEvent: mocks.recordEvent,
  },
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'synthetic-user' },
    role: 'nurse_hospital',
    isAuthenticated: true,
    remoteSyncStatus: 'ready',
  }),
}));
vi.mock('@/utils/clinicalDayUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/clinicalDayUtils')>()),
  getCurrentShift: () => mocks.shift,
}));
vi.mock('@/services/reminders/ReminderReadService', () => ({
  ReminderReadService: {
    getUserShiftReadState: vi.fn(async () => ({ status: 'read' })),
  },
}));
const reminder: Reminder = {
  id: 'synthetic-reminder',
  title: 'Revisar equipo de prueba',
  message: 'Aviso sintético vigente',
  type: 'info',
  targetRoles: ['nurse_hospital'],
  targetShifts: ['day'],
  startDate: '2020-01-01',
  endDate: '2099-12-31',
  priority: 1,
  isActive: true,
  createdBy: 'synthetic-admin',
  createdByName: 'Prueba',
  createdAt: '2026-11-01T12:00:00Z',
  updatedAt: '2026-11-01T12:00:00Z',
};
const mount = () =>
  render(
    <ReminderCenterProvider>
      <ReminderBadge />
      <ReminderModal />
    </ReminderCenterProvider>
  );
const emit = (reminders: Reminder[]) =>
  act(() =>
    mocks.next({
      docs: reminders.map(item => ({ id: item.id, data: () => item })),
    })
  );

describe('reminder feed continuity from Firestore listener to screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shift = 'day';
  });

  it.each([{ code: 'permission-denied' }, { code: 'unavailable' }])(
    'preserves the last reminder, read count and open center after $code',
    async error => {
      mount();
      emit([reminder]);
      await waitFor(() =>
        expect(screen.getByTestId('reminder-badge-count')).toHaveTextContent('0')
      );
      fireEvent.click(screen.getByRole('button', { name: 'Abrir avisos' }));
      expect(screen.getByText(reminder.title)).toBeVisible();
      act(() => mocks.fail(error));
      expect(screen.getByText(reminder.title)).toBeVisible();
      expect(screen.getByTestId('reminder-badge-count')).toHaveTextContent('0');
      expect(screen.getByRole('button', { name: 'Abrir avisos' })).toHaveAttribute(
        'data-reminder-center-available',
        'false'
      );
      expect(
        screen.queryByText('No hay avisos activos para tu rol y turno.')
      ).not.toBeInTheDocument();
      expect(mocks.recordEvent).toHaveBeenCalledWith(
        'subscribe_reminders',
        'degraded',
        expect.anything()
      );
    }
  );

  it('distinguishes a first-read failure from a confirmed empty feed and a subsequent successful feed', () => {
    mount();
    act(() => mocks.fail({ code: 'unavailable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir avisos' }));
    expect(screen.getByText(/No fue posible cargar los avisos/)).toBeVisible();
    expect(
      screen.queryByText('No hay avisos activos para tu rol y turno.')
    ).not.toBeInTheDocument();
    emit([]);
    expect(screen.getByText('No hay avisos activos para tu rol y turno.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Abrir avisos' })).toHaveAttribute(
      'data-reminder-center-available',
      'true'
    );
    emit([reminder]);
    expect(screen.getByText(reminder.title)).toBeVisible();
  });

  it('preserves a confirmed urgent reminder in the bell when a partial cached snapshot omits it', async () => {
    const urgentReminder: Reminder = {
      ...reminder,
      id: 'synthetic-urgent',
      title: 'Aviso urgente confirmado',
      type: 'urgent',
    };
    const otherRoleReminder: Reminder = {
      ...reminder,
      id: 'synthetic-other',
      title: 'Aviso otro rol',
      targetRoles: ['admin'],
    };

    const { ReminderReadService } = await import('@/services/reminders/ReminderReadService');
    vi.mocked(ReminderReadService.getUserShiftReadState).mockResolvedValue({ status: 'unread' });

    mount();
    emit([urgentReminder, otherRoleReminder]);

    await waitFor(() => expect(screen.getByTestId('reminder-badge-count')).toHaveTextContent('1'));

    act(() =>
      mocks.next({
        metadata: { fromCache: true, hasPendingWrites: false },
        docs: [{ id: otherRoleReminder.id, data: () => otherRoleReminder }],
      })
    );

    expect(screen.getByTestId('reminder-badge-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir avisos' }));
    expect(screen.getByText(urgentReminder.title)).toBeVisible();
    expect(
      screen.queryByText('No hay avisos activos para tu rol y turno.')
    ).not.toBeInTheDocument();
  });

  it('resolves read receipts across shift rollover and remount while Firestore delivers cached snapshots', async () => {
    vi.useFakeTimers();
    try {
      const bothShiftsReminder: Reminder = {
        ...reminder,
        id: 'synthetic-both-shifts',
        title: 'Aviso urgente ambos turnos',
        type: 'urgent',
        targetShifts: ['day', 'night'],
      };

      const { ReminderReadService } = await import('@/services/reminders/ReminderReadService');
      vi.mocked(ReminderReadService.getUserShiftReadState).mockImplementation(
        async (_reminderId, _userId, shift) => ({
          status: shift === 'day' ? 'read' : 'unread',
        })
      );

      // Remount during cached snapshot in the same shift must still recognize the cached read receipt (count 0).
      const firstMount = mount();
      act(() =>
        mocks.next({
          metadata: { fromCache: true, hasPendingWrites: false },
          docs: [{ id: bothShiftsReminder.id, data: () => bothShiftsReminder }],
        })
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTestId('reminder-badge-count')).toHaveTextContent('0');

      // Shift rolls over to night while still on cached snapshot -> unread count must become 1.
      mocks.shift = 'night';
      await act(async () => {
        vi.advanceTimersByTime(60_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTestId('reminder-badge-count')).toHaveTextContent('1');
      firstMount.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

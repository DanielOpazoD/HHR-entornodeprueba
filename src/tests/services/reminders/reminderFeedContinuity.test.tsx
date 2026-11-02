import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderCenterProvider } from '@/context/ReminderCenterContext';
import { ReminderBadge } from '@/components/reminders/ReminderBadge';
import { ReminderModal } from '@/components/reminders/ReminderModal';
import type { Reminder } from '@/types/reminders';

const mocks = vi.hoisted(() => ({
  next: (_snapshot: { docs: { id: string; data: () => Reminder }[] }) => {},
  fail: (_error: unknown) => {},
  recordEvent: vi.fn(),
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  query: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn((_query, next, fail) => {
    mocks.next = next;
    mocks.fail = fail;
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
vi.mock('@/services/admin/attributionService', () => ({ getCurrentShift: () => 'day' }));
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
  beforeEach(() => vi.clearAllMocks());

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
});

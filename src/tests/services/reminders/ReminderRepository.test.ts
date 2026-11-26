// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reminder } from '@/types/reminders';

const mocks = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  onSnapshot: mocks.onSnapshot,
  orderBy: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/services/reminders/reminderShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/reminders/reminderShared')>()),
  getRemindersCollectionRef: vi.fn(() => 'reminders-col'),
}));

vi.mock('@/services/reminders/reminderObservability', () => ({
  reminderObservability: {
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    recordEvent: mocks.recordEvent,
  },
}));

import { createReminderRepository } from '@/services/reminders/ReminderRepository';

const sampleReminder: Reminder = {
  id: 'rem-1',
  title: 'Aviso vigente',
  message: 'Detalle sintético',
  type: 'info',
  targetRoles: ['nurse_hospital'],
  targetShifts: ['day'],
  startDate: '2026-03-01',
  endDate: '2026-03-31',
  priority: 2,
  isActive: true,
  createdBy: 'admin-1',
  createdByName: 'Jefatura',
  createdAt: '2026-03-10T08:00:00.000Z',
  updatedAt: '2026-03-10T08:00:00.000Z',
};

describe('ReminderRepository subscription cache honesty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes with includeMetadataChanges and rejects empty fromCache snapshots as unconfirmed', () => {
    const capture: { next: ((snapshot: unknown) => void) | null } = { next: null };
    mocks.onSnapshot.mockImplementation((_query, options, next) => {
      expect(options).toEqual({ includeMetadataChanges: true });
      capture.next = next;
      return vi.fn();
    });

    const callback = vi.fn();
    const onError = vi.fn();
    createReminderRepository().subscribe(callback, { onError });

    capture.next?.({ metadata: { fromCache: true }, docs: [] });

    expect(callback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'unconfirmed_cache');

    capture.next?.({ metadata: { fromCache: false }, docs: [] });

    expect(callback).toHaveBeenCalledWith([]);
  });

  it('delivers cached non-empty reminders for continuity and updates on server snapshot', () => {
    const capture: { next: ((snapshot: unknown) => void) | null } = { next: null };
    mocks.onSnapshot.mockImplementation((_query, _options, next) => {
      capture.next = next;
      return vi.fn();
    });

    const callback = vi.fn();
    const onError = vi.fn();
    createReminderRepository().subscribe(callback, { onError });

    capture.next?.({
      metadata: { fromCache: true },
      docs: [{ id: sampleReminder.id, data: () => sampleReminder }],
    });

    expect(onError).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith([sampleReminder]);
  });
});

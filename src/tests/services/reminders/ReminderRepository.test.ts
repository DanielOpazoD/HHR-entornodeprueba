// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reminder } from '@/types/reminders';

const mocks = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  getDocsFromServer: vi.fn(),
  waitForPendingWrites: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  onSnapshot: mocks.onSnapshot,
  getDocsFromServer: mocks.getDocsFromServer,
  waitForPendingWrites: mocks.waitForPendingWrites,
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

const createLiveRuntime = () =>
  ({
    firestore: { type: 'firestore' },
    collection: vi.fn(),
    doc: vi.fn(),
  }) as unknown as NonNullable<Parameters<typeof createReminderRepository>[0]>['runtime'];

describe('ReminderRepository subscription cache, schema, and pending-write honesty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waitForPendingWrites.mockResolvedValue(undefined);
    mocks.getDocsFromServer.mockResolvedValue({
      metadata: { fromCache: false, hasPendingWrites: false },
      docs: [],
    });
  });

  it('subscribes with includeMetadataChanges and rejects empty fromCache snapshots as unconfirmed', async () => {
    const capture: { next: ((snapshot: unknown) => void) | null } = { next: null };
    mocks.onSnapshot.mockImplementation((_query, options, next) => {
      expect(options).toEqual({ includeMetadataChanges: true });
      capture.next = next;
      return vi.fn();
    });

    const callback = vi.fn();
    const onError = vi.fn();
    createReminderRepository({ runtime: createLiveRuntime() }).subscribe(callback, { onError });

    capture.next?.({ metadata: { fromCache: true, hasPendingWrites: false }, docs: [] });

    expect(callback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'unconfirmed_cache');

    capture.next?.({ metadata: { fromCache: false, hasPendingWrites: false }, docs: [] });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith([]));
  });

  it('routes non-empty cached snapshots to onCachedSnapshot instead of confirmed callback', () => {
    const capture: { next: ((snapshot: unknown) => void) | null } = { next: null };
    mocks.onSnapshot.mockImplementation((_query, _options, next) => {
      capture.next = next;
      return vi.fn();
    });

    const callback = vi.fn();
    const onCachedSnapshot = vi.fn();
    const onError = vi.fn();
    createReminderRepository({ runtime: createLiveRuntime() }).subscribe(callback, {
      onError,
      onCachedSnapshot,
    });

    capture.next?.({
      metadata: { fromCache: true, hasPendingWrites: false },
      docs: [{ id: sampleReminder.id, data: () => sampleReminder }],
    });

    expect(onError).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(onCachedSnapshot).toHaveBeenCalledWith([sampleReminder]);
  });

  it('fails closed with invalid_record when a reminder document fails schema validation', () => {
    const capture: { next: ((snapshot: unknown) => void) | null } = { next: null };
    mocks.onSnapshot.mockImplementation((_query, _options, next) => {
      capture.next = next;
      return vi.fn();
    });

    const callback = vi.fn();
    const onError = vi.fn();
    createReminderRepository({ runtime: createLiveRuntime() }).subscribe(callback, { onError });

    capture.next?.({
      metadata: { fromCache: false, hasPendingWrites: false },
      docs: [
        {
          id: sampleReminder.id,
          data: () => ({ ...sampleReminder, title: 'T'.repeat(101) }),
        },
      ],
    });

    expect(callback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'invalid_record');
  });

  it('waits for pending local deletions to settle before ever announcing an empty feed', async () => {
    const capture: { next: ((snapshot: unknown) => void) | null } = { next: null };
    mocks.onSnapshot.mockImplementation((_query, _options, next) => {
      capture.next = next;
      return vi.fn();
    });

    let resolvePendingWrites!: () => void;
    mocks.waitForPendingWrites.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolvePendingWrites = resolve;
        })
    );

    const callback = vi.fn();
    const onError = vi.fn();
    createReminderRepository({ runtime: createLiveRuntime() }).subscribe(callback, { onError });

    // Simulates reconnect after a local deleteDoc before server rejection rolls it back:
    // Firestore reports fromCache=false, hasPendingWrites=false, docs=[] while delete is in flight.
    capture.next?.({ metadata: { fromCache: false, hasPendingWrites: false }, docs: [] });
    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();

    // Server rejects the pending deletion and Firestore restores the reminder.
    mocks.waitForPendingWrites.mockResolvedValue(undefined);
    capture.next?.({
      metadata: { fromCache: false, hasPendingWrites: false },
      docs: [{ id: sampleReminder.id, data: () => sampleReminder }],
    });

    resolvePendingWrites();

    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(callback).toHaveBeenCalledWith([sampleReminder]);
  });
});

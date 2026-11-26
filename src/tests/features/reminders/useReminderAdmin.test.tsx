import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { Reminder, ReminderReadReceipt } from '@/types/reminders';

const mocks = vi.hoisted(() => ({
  currentUser: { uid: 'admin-a', email: 'admin-a@hospital.cl', displayName: 'Jefatura A' } as {
    uid: string;
    email: string;
    displayName: string;
  } | null,
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  confirm: vi.fn(),
  getReminderReadReceipts: vi.fn(),
  deleteReminder: vi.fn(),
  deleteReminderImage: vi.fn(),
  feedCallback: null as ((outcome: ApplicationOutcome<Reminder[]>) => void) | null,
  subscribeCount: 0,
  sessionListeners: new Set<(generation: string | null) => void>(),
  sessionIsCurrent: true,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: mocks.currentUser, role: 'admin' }),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: mocks.notifySuccess, error: mocks.notifyError }),
  useConfirmDialog: () => ({ confirm: mocks.confirm }),
}));

vi.mock('@/application/reminders/reminderUseCases', () => ({
  createReminderUseCases: () => ({
    subscribeToReminderFeed: ({
      onOutcome,
    }: {
      onOutcome: (outcome: ApplicationOutcome<Reminder[]>) => void;
    }) => {
      mocks.subscribeCount += 1;
      mocks.feedCallback = onOutcome;
      return vi.fn();
    },
    getReminderReadReceipts: (reminderId: string) => mocks.getReminderReadReceipts(reminderId),
    deleteReminder: (reminderId: string) => mocks.deleteReminder(reminderId),
    deleteReminderImage: (imagePath?: string) => mocks.deleteReminderImage(imagePath),
  }),
}));

vi.mock('@/services/session/authoringSession', () => ({
  guardAuthoringSession: () => ({
    session: { ownerKey: mocks.currentUser?.uid ?? null, generation: 'gen-1' },
    isCurrent: () => mocks.sessionIsCurrent,
    check: () => {
      if (!mocks.sessionIsCurrent) throw new Error('La sesión cambió.');
    },
  }),
}));

vi.mock('@/services/session/sessionStorageTransition', () => ({
  onSessionChange: (listener: (generation: string | null) => void) => {
    mocks.sessionListeners.add(listener);
    return () => {
      mocks.sessionListeners.delete(listener);
    };
  },
}));

import { useReminderAdmin } from '@/features/reminders/hooks/useReminderAdmin';

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const buildReminder = (id: string, title: string): Reminder => ({
  id,
  title,
  message: `Mensaje ${title}`,
  type: 'info',
  targetRoles: ['nurse_hospital'],
  targetShifts: ['day'],
  startDate: '2026-03-01',
  endDate: '2026-03-31',
  priority: 2,
  isActive: true,
  createdBy: 'admin-a',
  createdByName: 'Jefatura A',
  createdAt: '2026-03-10T08:00:00.000Z',
  updatedAt: '2026-03-10T08:00:00.000Z',
});

const buildReceipt = (userId: string, userName: string): ReminderReadReceipt => ({
  userId,
  userName,
  shift: 'day',
  dateKey: '2026-03-22',
  readAt: '2026-03-22T10:00:00.000Z',
});

const successOutcome = (
  data: ReminderReadReceipt[]
): ApplicationOutcome<ReminderReadReceipt[]> => ({
  status: 'success',
  data,
  issues: [],
});

const failedOutcome = (message: string): ApplicationOutcome<ReminderReadReceipt[]> => ({
  status: 'failed',
  data: [],
  issues: [{ kind: 'unknown', message, userSafeMessage: message }],
  userSafeMessage: message,
});

describe('useReminderAdmin read status race, error and session safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = {
      uid: 'admin-a',
      email: 'admin-a@hospital.cl',
      displayName: 'Jefatura A',
    };
    mocks.sessionIsCurrent = true;
    mocks.sessionListeners.clear();
    mocks.feedCallback = null;
    mocks.subscribeCount = 0;
  });

  afterEach(() => {
    mocks.sessionListeners.clear();
  });

  it('ignores out-of-order receipt responses from reminder A after switching to reminder B', async () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    const reminderB = buildReminder('rem-b', 'Aviso B');
    const deferredA = createDeferred<ApplicationOutcome<ReminderReadReceipt[]>>();
    const deferredB = createDeferred<ApplicationOutcome<ReminderReadReceipt[]>>();

    mocks.getReminderReadReceipts.mockImplementation((id: string) =>
      id === 'rem-a' ? deferredA.promise : deferredB.promise
    );

    const { result } = renderHook(() => useReminderAdmin());

    act(() => {
      void result.current.openReadStatus(reminderA);
    });
    expect(result.current.receiptsReminder?.id).toBe('rem-a');
    expect(result.current.receiptsLoading).toBe(true);

    act(() => {
      void result.current.openReadStatus(reminderB);
    });
    expect(result.current.receiptsReminder?.id).toBe('rem-b');
    expect(result.current.readReceipts).toEqual([]);

    await act(async () => {
      deferredB.resolve(successOutcome([buildReceipt('u-b', 'Enfermera B')]));
      await deferredB.promise;
    });

    expect(result.current.receiptsLoading).toBe(false);
    expect(result.current.receiptsReminder?.id).toBe('rem-b');
    expect(result.current.readReceipts.map(item => item.userName)).toEqual(['Enfermera B']);

    await act(async () => {
      deferredA.resolve(successOutcome([buildReceipt('u-a', 'Enfermera A')]));
      await deferredA.promise;
    });

    expect(result.current.receiptsReminder?.id).toBe('rem-b');
    expect(result.current.readReceipts.map(item => item.userName)).toEqual(['Enfermera B']);
    expect(result.current.receiptsError).toBeNull();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('ignores a late failure from reminder A after reminder B already loaded', async () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    const reminderB = buildReminder('rem-b', 'Aviso B');
    const deferredA = createDeferred<ApplicationOutcome<ReminderReadReceipt[]>>();
    const deferredB = createDeferred<ApplicationOutcome<ReminderReadReceipt[]>>();

    mocks.getReminderReadReceipts.mockImplementation((id: string) =>
      id === 'rem-a' ? deferredA.promise : deferredB.promise
    );

    const { result } = renderHook(() => useReminderAdmin());

    act(() => {
      void result.current.openReadStatus(reminderA);
      void result.current.openReadStatus(reminderB);
    });

    await act(async () => {
      deferredB.resolve(successOutcome([buildReceipt('u-b', 'Enfermera B')]));
      await deferredB.promise;
    });

    await act(async () => {
      deferredA.resolve(failedOutcome('Error tardío de A'));
      await deferredA.promise;
    });

    expect(result.current.receiptsReminder?.id).toBe('rem-b');
    expect(result.current.readReceipts.map(item => item.userName)).toEqual(['Enfermera B']);
    expect(result.current.receiptsError).toBeNull();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('clears previous receipts immediately when opening another reminder', async () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    const reminderB = buildReminder('rem-b', 'Aviso B');
    const deferredB = createDeferred<ApplicationOutcome<ReminderReadReceipt[]>>();

    mocks.getReminderReadReceipts
      .mockResolvedValueOnce(successOutcome([buildReceipt('u-a', 'Enfermera A')]))
      .mockReturnValueOnce(deferredB.promise);

    const { result } = renderHook(() => useReminderAdmin());

    await act(async () => {
      await result.current.openReadStatus(reminderA);
    });
    expect(result.current.readReceipts).toHaveLength(1);

    act(() => {
      void result.current.openReadStatus(reminderB);
    });

    expect(result.current.receiptsReminder?.id).toBe('rem-b');
    expect(result.current.receiptsLoading).toBe(true);
    expect(result.current.readReceipts).toEqual([]);
  });

  it('discards late responses and error notifications after the modal is closed', async () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    const deferredA = createDeferred<ApplicationOutcome<ReminderReadReceipt[]>>();
    mocks.getReminderReadReceipts.mockReturnValue(deferredA.promise);

    const { result } = renderHook(() => useReminderAdmin());

    act(() => {
      void result.current.openReadStatus(reminderA);
    });
    act(() => {
      result.current.closeReadStatus();
    });

    await act(async () => {
      deferredA.resolve(failedOutcome('Fallo tras cerrar'));
      await deferredA.promise;
    });

    expect(result.current.receiptsReminder).toBeNull();
    expect(result.current.readReceipts).toEqual([]);
    expect(result.current.receiptsError).toBeNull();
    expect(result.current.receiptsLoading).toBe(false);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('exposes receiptsError on failure or rejection and recovers on retryReadStatus', async () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    mocks.getReminderReadReceipts
      .mockResolvedValueOnce(
        failedOutcome('No fue posible cargar el detalle de lecturas del aviso.')
      )
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(successOutcome([buildReceipt('u-1', 'Enfermera Recuperada')]));

    const { result } = renderHook(() => useReminderAdmin());

    await act(async () => {
      await result.current.openReadStatus(reminderA);
    });
    expect(result.current.receiptsError).toBe(
      'No fue posible cargar el detalle de lecturas del aviso.'
    );
    expect(result.current.readReceipts).toEqual([]);
    expect(result.current.receiptsLoading).toBe(false);

    await act(async () => {
      result.current.retryReadStatus();
    });
    await waitFor(() => expect(result.current.receiptsLoading).toBe(false));
    expect(result.current.receiptsError).toBeTruthy();
    expect(result.current.readReceipts).toEqual([]);

    await act(async () => {
      result.current.retryReadStatus();
    });
    await waitFor(() => expect(result.current.receiptsLoading).toBe(false));
    expect(result.current.receiptsError).toBeNull();
    expect(result.current.readReceipts.map(item => item.userName)).toEqual([
      'Enfermera Recuperada',
    ]);
  });

  it('closes silently and discards pending receipts when the authoring session ends', async () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    const deferredA = createDeferred<ApplicationOutcome<ReminderReadReceipt[]>>();
    mocks.getReminderReadReceipts.mockReturnValue(deferredA.promise);

    const { result } = renderHook(() => useReminderAdmin());

    act(() => {
      void result.current.openReadStatus(reminderA);
    });
    expect(result.current.receiptsReminder?.id).toBe('rem-a');

    act(() => {
      mocks.sessionIsCurrent = false;
      mocks.sessionListeners.forEach(listener => listener(null));
    });

    expect(result.current.receiptsReminder).toBeNull();
    expect(result.current.receiptsLoading).toBe(false);

    await act(async () => {
      deferredA.resolve(successOutcome([buildReceipt('u-a', 'Enfermera A')]));
      await deferredA.promise;
    });

    expect(result.current.receiptsReminder).toBeNull();
    expect(result.current.readReceipts).toEqual([]);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('closes the open read modal silently when the active user changes', async () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    mocks.getReminderReadReceipts.mockResolvedValue(
      successOutcome([buildReceipt('u-a', 'Enfermera A')])
    );

    const { result, rerender } = renderHook(() => useReminderAdmin());

    await act(async () => {
      await result.current.openReadStatus(reminderA);
    });
    expect(result.current.receiptsReminder?.id).toBe('rem-a');

    mocks.currentUser = {
      uid: 'admin-b',
      email: 'admin-b@hospital.cl',
      displayName: 'Jefatura B',
    };
    rerender();

    expect(result.current.receiptsReminder).toBeNull();
    expect(result.current.readReceipts).toEqual([]);
    expect(result.current.receiptsError).toBeNull();
  });

  it('clears feed loadError once a subsequent subscription update succeeds', () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    const { result } = renderHook(() => useReminderAdmin());

    act(() => {
      mocks.feedCallback?.({
        status: 'degraded',
        data: [],
        reason: 'unconfirmed_cache',
        issues: [{ kind: 'unknown', message: 'offline', userSafeMessage: 'Sin conexión.' }],
        userSafeMessage: 'Sin conexión.',
      });
    });
    expect(result.current.loadError).toBe('Sin conexión.');

    act(() => {
      mocks.feedCallback?.({
        status: 'success',
        data: [reminderA],
        issues: [],
      });
    });
    expect(result.current.loadError).toBeNull();
    expect(result.current.reminders).toEqual([reminderA]);
  });

  it('closes the open read modal and discards late receipts when the reminder is deleted remotely', async () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    const reminderB = buildReminder('rem-b', 'Aviso B');
    const deferredA = createDeferred<ApplicationOutcome<ReminderReadReceipt[]>>();
    mocks.getReminderReadReceipts.mockReturnValue(deferredA.promise);

    const { result } = renderHook(() => useReminderAdmin());

    act(() => {
      mocks.feedCallback?.({ status: 'success', data: [reminderA, reminderB], issues: [] });
    });

    act(() => {
      void result.current.openReadStatus(reminderA);
    });
    expect(result.current.receiptsReminder?.id).toBe('rem-a');

    act(() => {
      mocks.feedCallback?.({ status: 'success', data: [reminderB], issues: [] });
    });

    expect(result.current.receiptsReminder).toBeNull();
    expect(result.current.readReceipts).toEqual([]);
    expect(result.current.receiptsLoading).toBe(false);

    await act(async () => {
      deferredA.resolve(successOutcome([buildReceipt('u-a', 'Enfermera Tardía')]));
      await deferredA.promise;
    });

    expect(result.current.receiptsReminder).toBeNull();
    expect(result.current.readReceipts).toEqual([]);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('preserves reminders across permission-denied and recovers automatically and via retryLoadReminders', () => {
    vi.useFakeTimers();
    try {
      const reminderV1 = buildReminder('rem-a', 'Título inicial');
      const reminderV2 = buildReminder('rem-a', 'Título actualizado');
      const { result } = renderHook(() => useReminderAdmin());

      expect(mocks.subscribeCount).toBe(1);

      act(() => {
        mocks.feedCallback?.({ status: 'success', data: [reminderV1], issues: [] });
      });
      expect(result.current.reminders[0]?.title).toBe('Título inicial');

      act(() => {
        mocks.feedCallback?.({
          status: 'degraded',
          data: [reminderV1],
          reason: 'permission_denied',
          issues: [
            {
              kind: 'permission',
              message: 'permission-denied',
              userSafeMessage: 'No fue posible suscribirse a los avisos.',
            },
          ],
          userSafeMessage: 'No fue posible suscribirse a los avisos.',
        });
      });

      expect(result.current.reminders[0]?.title).toBe('Título inicial');
      expect(result.current.loadError).toBe('No fue posible suscribirse a los avisos.');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mocks.subscribeCount).toBe(2);

      // Even if a retry also fails with empty data, preserved reminders stay intact.
      act(() => {
        mocks.feedCallback?.({
          status: 'degraded',
          data: [],
          reason: 'permission_denied',
          issues: [
            {
              kind: 'permission',
              message: 'permission-denied',
              userSafeMessage: 'No fue posible suscribirse a los avisos.',
            },
          ],
          userSafeMessage: 'No fue posible suscribirse a los avisos.',
        });
      });
      expect(result.current.reminders[0]?.title).toBe('Título inicial');

      act(() => {
        result.current.retryLoadReminders();
      });
      expect(mocks.subscribeCount).toBe(3);

      act(() => {
        mocks.feedCallback?.({ status: 'success', data: [reminderV2], issues: [] });
      });

      expect(result.current.loadError).toBeNull();
      expect(result.current.reminders[0]?.title).toBe('Título actualizado');
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps automatic permission-denied retries at five even with populated cache and ignores unrelated storage events', () => {
    vi.useFakeTimers();
    try {
      const cachedReminder = buildReminder('rem-cached', 'Aviso en caché');
      renderHook(() => useReminderAdmin());
      expect(mocks.subscribeCount).toBe(1);

      const failWithCachedReplay = () => {
        act(() => {
          mocks.feedCallback?.({
            status: 'degraded',
            data: [cachedReminder],
            reason: 'cached_snapshot',
            issues: [],
          });
          mocks.feedCallback?.({
            status: 'degraded',
            data: [cachedReminder],
            reason: 'permission_denied',
            issues: [
              {
                kind: 'permission',
                message: 'permission-denied',
                userSafeMessage: 'No fue posible suscribirse a los avisos.',
              },
            ],
            userSafeMessage: 'No fue posible suscribirse a los avisos.',
          });
        });
      };

      failWithCachedReplay();

      // Ordinary cross-tab storage activity must not trigger an early retry before 1000ms.
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'hhr_last_activity' }));
      });
      expect(mocks.subscribeCount).toBe(1);

      // Step through all 5 backoff delays (1s, 2.5s, 5s, 10s, 20s) + extra time.
      for (const delay of [1000, 2500, 5000, 10000, 20000]) {
        act(() => {
          vi.advanceTimersByTime(delay);
        });
        failWithCachedReplay();
      }

      // 1 initial + 5 automatic retries = 6 subscriptions max.
      expect(mocks.subscribeCount).toBe(6);

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(mocks.subscribeCount).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the open read modal open on partial cached snapshots and invalid_record warnings', async () => {
    const reminderA = buildReminder('rem-a', 'Aviso A');
    const reminderB = buildReminder('rem-b', 'Aviso B');
    mocks.getReminderReadReceipts.mockResolvedValue(
      successOutcome([buildReceipt('u-a', 'Enfermera A')])
    );

    const { result } = renderHook(() => useReminderAdmin());

    act(() => {
      mocks.feedCallback?.({ status: 'success', data: [reminderA, reminderB], issues: [] });
    });

    await act(async () => {
      await result.current.openReadStatus(reminderA);
    });
    expect(result.current.receiptsReminder?.id).toBe('rem-a');

    // Partial cached snapshot omitting reminderA must not close reminderA's detail.
    act(() => {
      mocks.feedCallback?.({
        status: 'degraded',
        data: [reminderB],
        reason: 'cached_snapshot',
        issues: [],
      });
    });
    expect(result.current.receiptsReminder?.id).toBe('rem-a');
    expect(result.current.readReceipts.map(item => item.userName)).toEqual(['Enfermera A']);

    // Malformed document warning must not close reminderA's detail or claim empty state.
    act(() => {
      mocks.feedCallback?.({
        status: 'degraded',
        data: [reminderA, reminderB],
        reason: 'invalid_record',
        issues: [
          {
            kind: 'unknown',
            message: 'formato inválido',
            userSafeMessage: 'No fue posible leer todos los avisos por un formato inválido.',
          },
        ],
        userSafeMessage: 'No fue posible leer todos los avisos por un formato inválido.',
      });
    });
    expect(result.current.receiptsReminder?.id).toBe('rem-a');
    expect(result.current.loadError).toBe(
      'No fue posible leer todos los avisos por un formato inválido.'
    );
  });
});

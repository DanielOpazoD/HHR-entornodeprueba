import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldAlertOperationalTelemetry } from '@/services/observability/operationalTelemetryIngestPolicy';

const mocks = vi.hoisted(() => ({
  recordEvent: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  onSnapshot: mocks.onSnapshot,
  orderBy: vi.fn(),
  query: vi.fn(),
}));
vi.mock('@/services/reminders/reminderShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/reminders/reminderShared')>()),
  getRemindersCollectionRef: vi.fn(),
}));
vi.mock('@/services/reminders/reminderObservability', () => ({
  reminderObservability: {
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    recordEvent: mocks.recordEvent,
  },
}));

const failSubscription = async (error: unknown) => {
  const { ReminderRepository } = await import('@/services/reminders/ReminderRepository');
  mocks.onSnapshot.mockImplementation((_query, _next, onError) => {
    onError(error);
    return vi.fn();
  });
  const callback = vi.fn();
  const onError = vi.fn();
  ReminderRepository.subscribe(callback, { onError });
  return { status: mocks.recordEvent.mock.calls[0][1] as 'failed' | 'degraded', onError };
};

describe('reminder listener alerts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mails nobody when the listener ends because the session lost its permission', async () => {
    const { status, onError } = await failSubscription({ code: 'permission-denied' });
    expect(shouldAlertOperationalTelemetry({ status, operation: 'subscribe_reminders' })).toBe(
      false
    );
    expect(onError).toHaveBeenCalledWith(expect.anything(), 'permission_denied');
  });

  it('still mails an unexpected listener failure', async () => {
    const { status, onError } = await failSubscription(new Error('sintético'));
    expect(shouldAlertOperationalTelemetry({ status, operation: 'subscribe_reminders' })).toBe(
      true
    );
    expect(onError).toHaveBeenCalledWith(expect.anything(), 'unknown');
  });
});

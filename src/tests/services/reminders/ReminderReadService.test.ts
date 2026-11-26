// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocsFromServer: vi.fn(),
  setDoc: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getDoc: mocks.getDoc,
  getDocsFromServer: mocks.getDocsFromServer,
  setDoc: mocks.setDoc,
}));

vi.mock('@/services/firebase-runtime/reminderRuntime', () => ({
  defaultReminderFirestoreRuntime: {},
}));

vi.mock('@/services/reminders/reminderShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/reminders/reminderShared')>()),
  getReminderReadReceiptsCollectionRef: vi.fn((reminderId: string) => `collection:${reminderId}`),
}));

vi.mock('@/services/reminders/reminderObservability', () => ({
  reminderObservability: {
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    recordEvent: mocks.recordEvent,
  },
}));

import { createReminderReadService } from '@/services/reminders/ReminderReadService';

describe('ReminderReadService read receipts server verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads from the server and sorts receipts newest first across offsets', async () => {
    mocks.getDocsFromServer.mockResolvedValue({
      metadata: { fromCache: false },
      docs: [
        {
          data: () => ({
            userId: 'user-older',
            userName: 'Enfermera A',
            shift: 'day',
            dateKey: '2026-03-22',
            readAt: '2026-03-22T10:00:00.000Z',
          }),
        },
        {
          data: () => ({
            userId: 'user-newer',
            userName: 'Enfermera B',
            shift: 'day',
            dateKey: '2026-03-22',
            readAt: '2026-03-22T07:30:00-05:00',
          }),
        },
      ],
    });

    const service = createReminderReadService();
    const result = await service.getReadReceiptsWithResult('rem-1');

    expect(mocks.getDocsFromServer).toHaveBeenCalledWith('collection:rem-1');
    expect(result.status).toBe('success');
    expect(result.receipts.map(item => item.userId)).toEqual(['user-newer', 'user-older']);
  });

  it('rejects cached snapshots instead of reporting an empty or stale receipt list', async () => {
    mocks.getDocsFromServer.mockResolvedValue({
      metadata: { fromCache: true },
      docs: [],
    });

    const service = createReminderReadService();
    const result = await service.getReadReceiptsWithResult('rem-cache');

    expect(result.status).toBe('unknown');
    expect(result.receipts).toEqual([]);
    await expect(service.getReadReceipts('rem-cache')).rejects.toThrow(/servidor/i);
  });

  it('fails closed when any receipt document in Firestore is malformed', async () => {
    mocks.getDocsFromServer.mockResolvedValue({
      metadata: { fromCache: false },
      docs: [
        {
          data: () => ({
            userId: 'user-valid',
            userName: 'Enfermera Válida',
            shift: 'day',
            dateKey: '2026-03-22',
            readAt: '2026-03-22T10:00:00.000Z',
          }),
        },
        {
          data: () => ({
            userId: '',
            shift: 'invalid',
          }),
        },
      ],
    });

    const service = createReminderReadService();
    const result = await service.getReadReceiptsWithResult('rem-bad');

    expect(result.status).toBe('unknown');
    expect(result.receipts).toEqual([]);
    expect(mocks.recordEvent).toHaveBeenCalledWith(
      'list_reminder_receipts',
      'failed',
      expect.anything()
    );
  });

  it('classifies permission-denied failures explicitly', async () => {
    mocks.getDocsFromServer.mockRejectedValue({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    });

    const service = createReminderReadService();
    const result = await service.getReadReceiptsWithResult('rem-denied');

    expect(result.status).toBe('permission_denied');
    expect(result.receipts).toEqual([]);
    await expect(service.getReadReceipts('rem-denied')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});

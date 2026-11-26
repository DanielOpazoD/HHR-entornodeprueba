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
      metadata: { fromCache: true, hasPendingWrites: false },
      docs: [],
    });

    const service = createReminderReadService();
    const result = await service.getReadReceiptsWithResult('rem-cache');

    expect(result.status).toBe('unknown');
    expect(result.receipts).toEqual([]);
    await expect(service.getReadReceipts('rem-cache')).rejects.toThrow(/servidor/i);
  });

  it('rejects snapshots with pending local writes at snapshot or document level', async () => {
    const validDoc = {
      metadata: { hasPendingWrites: false },
      data: () => ({
        userId: 'user-1',
        userName: 'Enfermera Pendiente',
        shift: 'day',
        dateKey: '2026-03-22',
        readAt: '2026-03-22T10:00:00.000Z',
      }),
    };

    mocks.getDocsFromServer.mockResolvedValueOnce({
      metadata: { fromCache: false, hasPendingWrites: true },
      docs: [validDoc],
    });

    const service = createReminderReadService();
    const snapshotPending = await service.getReadReceiptsWithResult('rem-pending-snap');
    expect(snapshotPending.status).toBe('unknown');
    expect(snapshotPending.receipts).toEqual([]);

    mocks.getDocsFromServer.mockResolvedValueOnce({
      metadata: { fromCache: false, hasPendingWrites: false },
      docs: [{ ...validDoc, metadata: { hasPendingWrites: true } }],
    });

    const docPending = await service.getReadReceiptsWithResult('rem-pending-doc');
    expect(docPending.status).toBe('unknown');
    expect(docPending.receipts).toEqual([]);
  });

  it.each([
    {
      label: 'non-date readAt text',
      readAt: 'sin-fecha',
      dateKey: '2026-03-22',
    },
    {
      label: 'impossible calendar dateKey (Feb 31)',
      readAt: '2026-03-22T10:00:00.000Z',
      dateKey: '2026-02-31',
    },
    {
      label: 'non-leap Feb 29 dateKey',
      readAt: '2026-03-22T10:00:00.000Z',
      dateKey: '2026-02-29',
    },
    {
      label: 'impossible calendar date inside readAt',
      readAt: '2026-02-31T10:00:00.000Z',
      dateKey: '2026-03-22',
    },
  ])('fails closed when a receipt contains $label', async ({ readAt, dateKey }) => {
    mocks.getDocsFromServer.mockResolvedValue({
      metadata: { fromCache: false, hasPendingWrites: false },
      docs: [
        {
          metadata: { hasPendingWrites: false },
          data: () => ({
            userId: 'user-invalid',
            userName: 'Enfermera Sintética',
            shift: 'day',
            dateKey,
            readAt,
          }),
        },
      ],
    });

    const service = createReminderReadService();
    const result = await service.getReadReceiptsWithResult('rem-invalid-date');

    expect(result.status).toBe('unknown');
    expect(result.receipts).toEqual([]);
  });

  it('accepts a valid leap-day receipt dateKey and timestamp', async () => {
    mocks.getDocsFromServer.mockResolvedValue({
      metadata: { fromCache: false, hasPendingWrites: false },
      docs: [
        {
          metadata: { hasPendingWrites: false },
          data: () => ({
            userId: 'user-leap',
            userName: 'Enfermera Bisiesta',
            shift: 'night',
            dateKey: '2024-02-29',
            readAt: '2024-02-29T23:45:00Z',
          }),
        },
      ],
    });

    const service = createReminderReadService();
    const result = await service.getReadReceiptsWithResult('rem-leap');

    expect(result.status).toBe('success');
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]?.dateKey).toBe('2024-02-29');
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

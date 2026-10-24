// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { setDoc } from 'firebase/firestore';
import { createReminderReadService } from '@/services/reminders/ReminderReadService';

vi.mock('firebase/firestore', () => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/firebase-runtime/reminderRuntime', () => ({
  defaultReminderFirestoreRuntime: {},
}));
vi.mock('@/services/reminders/reminderShared', () => ({
  buildReminderReadReceiptId: (user: string, shift: string, day: string) =>
    `${user}_${shift}_${day}`,
  getReminderReadReceiptDocRef: (_reminder: string, id: string) => id,
  getReminderReadReceiptsCollectionRef: vi.fn(),
  normalizeReminderReadReceipt: vi.fn(),
}));

describe('legacy reminder read receipts', () => {
  it('stores a receipt without dateKey under the hospital day of its read instant', async () => {
    const receipt = {
      userId: 'synthetic-clock',
      userName: 'SINTETICO',
      shift: 'night' as const,
      readAt: '2026-10-25T02:30:00Z',
    };
    expect(
      await createReminderReadService().markAsReadWithResult('synthetic-reminder', receipt)
    ).toEqual({ status: 'success' });
    expect(setDoc).toHaveBeenCalledWith('synthetic-clock_night_2026-10-24', receipt);
  });
});

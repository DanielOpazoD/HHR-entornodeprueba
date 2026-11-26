// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildReminderReadReceiptId } from '@/services/reminders/reminderShared';

describe('buildReminderReadReceiptId', () => {
  it('distingue receipts por turno en el mismo dia', () => {
    expect(buildReminderReadReceiptId('user-1', 'day', '2026-03-15')).not.toBe(
      buildReminderReadReceiptId('user-1', 'night', '2026-03-15')
    );
  });

  it('distingue receipts por fecha aunque el turno sea el mismo', () => {
    expect(buildReminderReadReceiptId('user-1', 'day', '2026-03-15')).not.toBe(
      buildReminderReadReceiptId('user-1', 'day', '2026-03-16')
    );
  });
});

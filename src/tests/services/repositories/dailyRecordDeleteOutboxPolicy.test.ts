import { describe, expect, it } from 'vitest';
import {
  DAILY_RECORD_DELETE_OUTBOX_POLICY,
  shouldQueueDailyRecordDeleteOutbox,
} from '@/services/repositories/dailyRecordDeleteOutboxPolicy';

describe('dailyRecordDeleteOutboxPolicy', () => {
  it('codifies delete/moveToTrash as non-outbox lifecycle cleanup until offline delete is required', () => {
    expect(shouldQueueDailyRecordDeleteOutbox()).toBe(false);
    expect(DAILY_RECORD_DELETE_OUTBOX_POLICY.requiresTransactionalOutbox).toBe(false);
    expect(DAILY_RECORD_DELETE_OUTBOX_POLICY.remoteMode).toBe('best_effort_soft_delete');
    expect(DAILY_RECORD_DELETE_OUTBOX_POLICY.reviewTriggers).toContain('offline_delete_required');
  });
});

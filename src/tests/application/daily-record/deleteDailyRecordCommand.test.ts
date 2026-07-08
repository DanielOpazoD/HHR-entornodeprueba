import { describe, expect, it, vi } from 'vitest';
import { executeDeleteDailyRecord } from '@/application/daily-record/commands/deleteDailyRecordCommand';

describe('executeDeleteDailyRecord (fail-closed)', () => {
  it('audits BEFORE deleting and succeeds when the audit succeeds', async () => {
    const deleteRecord = vi.fn(async () => undefined);
    const writeAuditEvent = vi.fn(async () => ({
      status: 'success' as const,
      data: null,
      issues: [],
    }));

    const outcome = await executeDeleteDailyRecord(
      { date: '2026-06-29', deletedBy: 'admin@h.cl', deleteRecord },
      { writeAuditEvent }
    );

    expect(outcome.status).toBe('success');
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin@h.cl',
        action: 'DAILY_RECORD_DELETED',
        entityType: 'dailyRecord',
        entityId: '2026-06-29',
      })
    );
    expect(deleteRecord).toHaveBeenCalledWith('2026-06-29');
    // Audit-first: the audit was invoked before the delete.
    expect(writeAuditEvent.mock.invocationCallOrder[0]).toBeLessThan(
      deleteRecord.mock.invocationCallOrder[0]
    );
  });

  it('fails closed: a failed audit was attempted and aborts before deleting', async () => {
    const deleteRecord = vi.fn(async () => undefined);
    const writeAuditEvent = vi.fn(async () => ({
      status: 'failed' as const,
      data: null,
      issues: [],
    }));

    const outcome = await executeDeleteDailyRecord(
      { date: '2026-06-29', deletedBy: 'admin@h.cl', deleteRecord },
      { writeAuditEvent }
    );

    expect(outcome.status).toBe('failed');
    expect(writeAuditEvent).toHaveBeenCalledTimes(1); // the audit WAS attempted (first)
    expect(deleteRecord).not.toHaveBeenCalled(); // ...and the delete never happened
  });
});

import { describe, expect, it } from 'vitest';
import { resolveLatestConflictSnapshotRecoveryFromAuditLogs } from '@/application/ports/dailyRecordConflictRecoveryPort';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const baseLog = (overrides: Partial<AuditLogEntry>): AuditLogEntry =>
  ({
    id: 'audit-1',
    timestamp: '2026-07-01T19:34:18.000Z',
    userId: 'system',
    action: 'CONFLICT_AUTO_MERGED',
    entityType: 'dailyRecord',
    entityId: '2026-07-01',
    details: {},
    recordDate: '2026-07-01',
    ...overrides,
  }) as AuditLogEntry;

describe('dailyRecordConflictRecoveryPort', () => {
  it('resolves latest conflict snapshot recovery evidence for a daily record date', () => {
    const recovery = {
      status: 'saved' as const,
      snapshotIds: ['cid__remote_premerge', 'cid__incoming_premerge'],
      origins: ['remote_premerge', 'incoming_premerge'],
      ttlMs: 172800000,
    };

    expect(
      resolveLatestConflictSnapshotRecoveryFromAuditLogs(
        [
          baseLog({ id: 'other-day', entityId: '2026-06-30', recordDate: '2026-06-30' }),
          baseLog({ id: 'target-day', details: { snapshotRecovery: recovery } }),
        ],
        '2026-07-01'
      )
    ).toEqual(recovery);
  });

  it('ignores conflict audit entries without usable snapshot recovery evidence', () => {
    expect(
      resolveLatestConflictSnapshotRecoveryFromAuditLogs(
        [
          baseLog({ details: { snapshotRecovery: { status: 'unknown' } } }),
          baseLog({ action: 'PATIENT_DISCHARGED', details: {} }),
        ],
        '2026-07-01'
      )
    ).toBeNull();
  });
});

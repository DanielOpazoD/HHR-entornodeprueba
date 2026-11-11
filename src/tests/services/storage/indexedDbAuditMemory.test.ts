import { describe, expect, it, vi } from 'vitest';
import {
  saveAuditLog,
  getAuditLogs,
  getAuditLogsForDate,
  getAuditLogsInRange,
} from '@/services/storage/indexeddb/indexedDbAuditLogService';
vi.mock('@/services/storage/indexeddb/indexedDbCore', async () => {
  const { createMockDatabase } = await import('@/services/storage/indexeddb/indexedDbMockFactory');
  return {
    hospitalDB: createMockDatabase(),
    ensureDbReady: async () => {},
    isDatabaseInFallbackMode: () => true,
  };
});
describe('audit memory fallback compatibility', () => {
  it('preserves empty general, date and unsupported range reads', async () => {
    expect(await getAuditLogs()).toEqual([]);
    expect(await getAuditLogsForDate('2026-07-01')).toEqual([]);
    expect(
      await getAuditLogsInRange({
        fromIso: '2026-07-01T00:00:00Z',
        toIso: '2026-07-02T00:00:00Z',
        limit: 100,
      })
    ).toEqual([]);
  });
  it('preserves populated general/date reads and the unsupported memory range', async () => {
    const entry = {
      id: 'memory-event',
      timestamp: '2026-07-01T12:00:00Z',
      recordDate: '2026-07-01',
      userId: 'synthetic@hospital.test',
      action: 'USER_LOGIN' as const,
      entityType: 'user' as const,
      entityId: 'synthetic',
      details: {},
    };
    await saveAuditLog(entry);
    expect(await getAuditLogs()).toEqual([entry]);
    expect(await getAuditLogsForDate('2026-07-01')).toEqual([entry]);
    expect(
      await getAuditLogsInRange({
        fromIso: '2026-07-01T00:00:00Z',
        toIso: '2026-07-02T00:00:00Z',
        limit: 100,
      })
    ).toEqual([]);
  });
});

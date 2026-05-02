import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeFetchAuditLogs } from '@/application/audit/fetchAuditLogsUseCase';
import * as auditService from '@/services/admin/auditService';
import type { AuditLogEntry } from '@/types/auditLogTypes';

vi.mock('@/services/admin/auditService', () => ({
  getAuditLogs: vi.fn(),
}));

describe('executeFetchAuditLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns fetched logs on success', async () => {
    const logs: AuditLogEntry[] = [
      {
        id: '1',
        timestamp: '2026-03-14T10:00:00.000Z',
        userId: 'doctor@test.com',
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: 'doctor@test.com',
        details: {},
      },
    ];
    vi.mocked(auditService.getAuditLogs).mockResolvedValueOnce(logs);

    const result = await executeFetchAuditLogs({ limit: 25 });

    expect(result.status).toBe('success');
    expect(result.data).toEqual(logs);
    expect(auditService.getAuditLogs).toHaveBeenCalledWith(25);
  });

  it('fetches the full historical audit log when no limit is requested', async () => {
    vi.mocked(auditService.getAuditLogs).mockResolvedValueOnce([]);

    const result = await executeFetchAuditLogs();

    expect(result.status).toBe('success');
    expect(auditService.getAuditLogs).toHaveBeenCalledWith(undefined);
  });

  it('returns failed outcome on error', async () => {
    vi.mocked(auditService.getAuditLogs).mockRejectedValueOnce(new Error('fetch failed'));

    const result = await executeFetchAuditLogs();

    expect(result.status).toBe('failed');
    expect(result.issues[0]?.message).toBe('fetch failed');
    expect(result.data).toEqual([]);
  });
});

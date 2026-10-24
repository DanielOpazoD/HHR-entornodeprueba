import { beforeEach, describe, expect, it, vi } from 'vitest';

const repository = vi.hoisted(() => ({ save: vi.fn(), readLocal: vi.fn() }));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: repository.save,
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: repository.readLocal,
}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));

import { importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  IDENTITY_REVIEW_DATE as DATE,
  storedDayWithPlantedReviews,
} from '@/tests/fixtures/identityReviewDayFixture';

beforeEach(() => {
  vi.clearAllMocks();
  repository.readLocal.mockResolvedValue(null);
  repository.save.mockResolvedValue({ outcome: 'clean' });
});

describe('restoring a monthly backup', () => {
  it('restores a day that carries identity reviews without any of them', async () => {
    const result = await importRecordsFromBackup({
      version: '1',
      exportDate: DATE,
      year: 2026,
      month: 10,
      recordCount: 1,
      records: [storedDayWithPlantedReviews() as unknown as DailyRecord],
    });

    expect(result).toMatchObject({ success: 1, failed: 0 });
    const restored: DailyRecord = repository.save.mock.calls[0][0];
    expect(JSON.stringify(restored)).not.toContain('identityReview');
    expect(restored.transfers[0].originalData?.patientName).toBe('PACIENTE UNO');
  });
});

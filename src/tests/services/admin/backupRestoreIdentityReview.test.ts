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
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import {
  IDENTITY_REVIEW_DATE as DATE,
  storedDay,
  storedDayWithPlantedReviews,
} from '@/tests/fixtures/identityReviewDayFixture';

beforeEach(() => {
  vi.clearAllMocks();
  repository.readLocal.mockResolvedValue(null);
  repository.save.mockResolvedValue({ outcome: 'clean' });
});

const backupOf = (record: unknown) =>
  JSON.parse(
    JSON.stringify({
      version: '1',
      exportDate: DATE,
      year: 2026,
      month: 10,
      recordCount: 1,
      records: [record],
    })
  );

describe('restoring a monthly backup', () => {
  it('restores a day read under review with the RUT storage held, not the text it showed', async () => {
    const read = docToRecord(storedDay({ documentType: 'RUT', rut: 12345678 }), DATE);

    const result = await importRecordsFromBackup(backupOf(read));

    expect(result).toMatchObject({ success: 1, failed: 0 });
    const restored: DailyRecord = repository.save.mock.calls[0][0];
    expect(restored.beds.R1.identityReview).toMatchObject({
      fields: ['rut'],
      stored: { rut: 12345678 },
    });
    expect(restored.beds.R2.identityReview).toBeUndefined();
  });

  it('refuses a day whose identity reviews do not hold what storage held', async () => {
    const result = await importRecordsFromBackup(backupOf(storedDayWithPlantedReviews()));

    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(repository.save).not.toHaveBeenCalled();
  });
});

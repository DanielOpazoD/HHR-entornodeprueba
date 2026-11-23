import { vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createUnavailableDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';

export const createMockDailyRecordRepositoryPort = (
  overrides: Partial<DailyRecordRepositoryPort> = {}
): DailyRecordRepositoryPort => ({
  getPreviousDay: vi.fn<DailyRecordRepositoryPort['getPreviousDay']>().mockResolvedValue(null),
  getAvailableDates: vi.fn<DailyRecordRepositoryPort['getAvailableDates']>().mockResolvedValue([]),
  getMonthRecords: vi.fn<DailyRecordRepositoryPort['getMonthRecords']>().mockResolvedValue([]),
  getForDate: vi.fn<DailyRecordRepositoryPort['getForDate']>().mockResolvedValue(null),
  getForDateWithMeta: vi
    .fn<DailyRecordRepositoryPort['getForDateWithMeta']>()
    .mockResolvedValue(createUnavailableDailyRecordReadResult('2026-01-01')),
  getAuthoritativeForDate: vi
    .fn<DailyRecordRepositoryPort['getAuthoritativeForDate']>()
    .mockResolvedValue(null),
  getLocalForDate: vi.fn<DailyRecordRepositoryPort['getLocalForDate']>().mockResolvedValue(null),
  getLocalForDateWithMeta: vi
    .fn<DailyRecordRepositoryPort['getLocalForDateWithMeta']>()
    .mockResolvedValue({
      record: null,
      hasPendingWrites: false,
      hasPendingWritesForDate: false,
      writeState: 'none',
    }),
  initializeDay: vi.fn<DailyRecordRepositoryPort['initializeDay']>(),
  getPreviousDayWithMeta: vi
    .fn<DailyRecordRepositoryPort['getPreviousDayWithMeta']>()
    .mockResolvedValue(createUnavailableDailyRecordReadResult('2026-01-01')),
  updatePartial: vi.fn<DailyRecordRepositoryPort['updatePartial']>(),
  save: vi.fn<DailyRecordRepositoryPort['save']>(),
  delete: vi.fn<DailyRecordRepositoryPort['delete']>().mockResolvedValue(undefined),
  adoptAuthoritativeRecord: vi
    .fn<DailyRecordRepositoryPort['adoptAuthoritativeRecord']>()
    .mockImplementation(async record => record),
  saveDetailed: vi.fn<DailyRecordRepositoryPort['saveDetailed']>(),
  updatePartialDetailed: vi.fn<DailyRecordRepositoryPort['updatePartialDetailed']>(),
  subscribeDetailed: vi
    .fn<DailyRecordRepositoryPort['subscribeDetailed']>()
    .mockReturnValue(() => undefined),
  deleteDay: vi.fn<DailyRecordRepositoryPort['deleteDay']>().mockResolvedValue(undefined),
  copyPatientToDateDetailed: vi.fn<DailyRecordRepositoryPort['copyPatientToDateDetailed']>(),
  ...overrides,
});

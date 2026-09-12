import { vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';

/**
 * Shared so that adding a method to the port is a one-line change here instead of
 * an identical edit in every hook test that needs a repository double.
 */
export const buildMockDailyRecordRepository = (): DailyRecordRepositoryPort => ({
  getForDate: vi.fn(),
  getForDateWithMeta: vi.fn(),
  getAuthoritativeForDate: vi.fn(),
  getLocalForDate: vi.fn(),
  getLocalForDateWithMeta: vi.fn(),
  getPreviousDay: vi.fn(),
  getPreviousDayWithMeta: vi.fn(),
  getAvailableDates: vi.fn(),
  getRecentAvailableDates: vi.fn(),
  getMonthRecords: vi.fn(),
  initializeDay: vi.fn(),
  save: vi.fn(),
  saveDetailed: vi.fn(),
  updatePartial: vi.fn(),
  updatePartialDetailed: vi.fn(),
  syncWithFirestoreDetailed: vi.fn(),
  adoptAuthoritativeRecord: vi.fn(async record => record),
  subscribe: vi.fn(() => vi.fn()),
  subscribeDetailed: vi.fn(() => vi.fn()),
  delete: vi.fn(),
  deleteDay: vi.fn(),
  copyPatientToDateDetailed: vi.fn(),
});

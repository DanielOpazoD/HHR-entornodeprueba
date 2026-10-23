import { describe, expect, it, vi } from 'vitest';
import { recoverIndexedDbInitialOpenFailure } from '@/services/storage/indexeddb/indexedDbInitialOpenRecoveryController';

interface FakeDatabase {
  id: string;
}

const createOptions = (error: unknown, mockDatabase: FakeDatabase) => ({
  error,
  activateMockFallback: vi.fn(() => mockDatabase),
  recordRecoveryNotice: vi.fn(),
  recordFallbackMode: vi.fn(),
  getBudgetSnapshot: vi.fn(() => ({ maxAttempts: 6 })),
});

describe('indexedDbInitialOpenRecoveryController', () => {
  it.each([
    ['UnknownError', 'Temporary open failure'],
    ['VersionError', 'The requested version is less than the existing version'],
    ['UnknownError', 'Internal error opening backing store for indexedDB.open.'],
  ])(
    'keeps HangaRoaDB on %s and works in memory with background recovery',
    async (name, message) => {
      const mockDatabase = { id: 'in-memory' };
      const options = createOptions({ name, message }, mockDatabase);

      const outcome = await recoverIndexedDbInitialOpenFailure(options);

      expect(options.recordRecoveryNotice).toHaveBeenCalledWith(
        'indexeddb_initial_open_failed',
        expect.stringContaining('sin borrar la base local'),
        expect.objectContaining({ errorName: name, errorMessage: message, maxAttempts: 6 })
      );
      expect(options.recordFallbackMode).toHaveBeenCalledWith(
        name,
        message,
        expect.objectContaining({ maxAttempts: 6 })
      );
      expect(options.activateMockFallback).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({
        database: mockDatabase,
        fallbackMode: true,
        stickyFallbackMode: false,
        shouldScheduleBackgroundRecovery: true,
      });
    }
  );

  it('keeps the sticky fallback decision of the recovery policy', async () => {
    const outcome = await recoverIndexedDbInitialOpenFailure({
      ...createOptions({ name: 'UnknownError', message: 'boom' }, { id: 'in-memory' }),
      shouldUseStickyFallback: () => true,
    });

    expect(outcome.stickyFallbackMode).toBe(true);
  });
});

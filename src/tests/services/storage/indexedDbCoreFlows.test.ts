import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  restoreIndexedDbFromMockFallbackMock,
  recoverIndexedDbInitialOpenRuntimeFailureMock,
  openIndexedDbWithRetriesMock,
  waitForIndexedDbOpenResolutionMock,
  resolveIndexedDbOpenWaitActionMock,
  createIndexedDbDatabaseOrFallbackMock,
} = vi.hoisted(() => ({
  restoreIndexedDbFromMockFallbackMock: vi.fn(),
  recoverIndexedDbInitialOpenRuntimeFailureMock: vi.fn(),
  openIndexedDbWithRetriesMock: vi.fn(),
  waitForIndexedDbOpenResolutionMock: vi.fn(),
  resolveIndexedDbOpenWaitActionMock: vi.fn(),
  createIndexedDbDatabaseOrFallbackMock: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbCoreRecovery', () => ({
  restoreIndexedDbFromMockFallback: restoreIndexedDbFromMockFallbackMock,
  recoverIndexedDbInitialOpenRuntimeFailure: recoverIndexedDbInitialOpenRuntimeFailureMock,
}));

vi.mock('@/services/storage/indexeddb/indexedDbCoreSupport', () => ({
  openIndexedDbWithRetries: openIndexedDbWithRetriesMock,
  runIndexedDbOperationWithTimeout: vi.fn((fn: () => Promise<unknown>) => fn()),
  waitForIndexedDbOpenResolution: waitForIndexedDbOpenResolutionMock,
}));

vi.mock('@/services/storage/indexeddb/indexedDbOpenWaitController', () => ({
  resolveIndexedDbOpenWaitAction: resolveIndexedDbOpenWaitActionMock,
}));

vi.mock('@/services/storage/indexeddb/indexedDbDatabaseLifecycle', () => ({
  assignIndexedDbMockTables: vi.fn(),
  createIndexedDbDatabaseOrFallback: createIndexedDbDatabaseOrFallbackMock,
}));

vi.mock('@/services/storage/indexeddb/indexedDbMockFactory', () => ({
  createMockDatabase: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbRecoveryController', () => ({
  recordIndexedDbRecoveryFailure: vi.fn(),
}));

import {
  initializeIndexedDbDatabase,
  runFreshOpenAttempt,
  runMockFallbackRecovery,
  runOpeningWaitFlow,
} from '@/services/storage/indexeddb/indexedDbCoreFlows';

const fakeDatabase = (overrides?: { isOpen?: () => boolean }) =>
  ({
    isOpen: overrides?.isOpen ?? (() => true),
    open: vi.fn(),
  }) as unknown as Parameters<typeof runFreshOpenAttempt>[0]['database'];

describe('initializeIndexedDbDatabase', () => {
  beforeEach(() => {
    createIndexedDbDatabaseOrFallbackMock.mockReset();
  });

  it('forwards plumbing to createIndexedDbDatabaseOrFallback and returns its outcome', () => {
    const database = fakeDatabase();
    createIndexedDbDatabaseOrFallbackMock.mockReturnValueOnce({
      database,
      fallbackMode: false,
    });
    const attach = vi.fn();
    const create = vi.fn();

    const result = initializeIndexedDbDatabase({
      createDatabase: create,
      attachDatabaseEvents: attach,
    });

    expect(result.database).toBe(database);
    expect(result.fallbackMode).toBe(false);
    expect(createIndexedDbDatabaseOrFallbackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        createDatabase: create,
        attachDatabaseEvents: attach,
      })
    );
  });

  it('reports fallbackMode=true when the factory falls back to the mock', () => {
    const database = fakeDatabase();
    createIndexedDbDatabaseOrFallbackMock.mockReturnValueOnce({
      database,
      fallbackMode: true,
    });
    const result = initializeIndexedDbDatabase({
      createDatabase: vi.fn(),
      attachDatabaseEvents: vi.fn(),
    });
    expect(result.fallbackMode).toBe(true);
  });
});

describe('runMockFallbackRecovery', () => {
  beforeEach(() => {
    restoreIndexedDbFromMockFallbackMock.mockReset();
  });

  it('returns the recovered real database on a successful restore', () => {
    const database = fakeDatabase();
    restoreIndexedDbFromMockFallbackMock.mockReturnValueOnce({
      database,
      fallbackMode: false,
    });

    const result = runMockFallbackRecovery({
      currentDatabase: fakeDatabase(),
      createDatabase: vi.fn(),
      attachDatabaseEvents: vi.fn(),
      resetRecoveryTracking: vi.fn(),
    });

    expect(result.database).toBe(database);
    expect(result.fallbackMode).toBe(false);
  });

  it('keeps fallbackMode=true when the restore fails', () => {
    const database = fakeDatabase();
    restoreIndexedDbFromMockFallbackMock.mockReturnValueOnce({
      database,
      fallbackMode: true,
    });

    const result = runMockFallbackRecovery({
      currentDatabase: fakeDatabase(),
      createDatabase: vi.fn(),
      attachDatabaseEvents: vi.fn(),
      resetRecoveryTracking: vi.fn(),
    });

    expect(result.fallbackMode).toBe(true);
  });
});

describe('runOpeningWaitFlow', () => {
  beforeEach(() => {
    waitForIndexedDbOpenResolutionMock.mockReset();
    resolveIndexedDbOpenWaitActionMock.mockReset();
  });

  it.each(['return', 'fallback', 'continue'] as const)(
    'propagates the %s decision',
    async decision => {
      waitForIndexedDbOpenResolutionMock.mockResolvedValueOnce({});
      resolveIndexedDbOpenWaitActionMock.mockReturnValueOnce(decision);

      const result = await runOpeningWaitFlow({
        isOpening: () => true,
        isDbOpen: () => false,
        isUsingMock: () => false,
      });

      expect(result).toBe(decision);
    }
  );
});

describe('runFreshOpenAttempt', () => {
  beforeEach(() => {
    openIndexedDbWithRetriesMock.mockReset();
    recoverIndexedDbInitialOpenRuntimeFailureMock.mockReset();
  });

  it('reports a clean success when the open path resolves and skips the recovery pipeline', async () => {
    const database = fakeDatabase();
    openIndexedDbWithRetriesMock.mockResolvedValueOnce(undefined);

    const result = await runFreshOpenAttempt({
      database,
      attachDatabaseEvents: vi.fn(),
    });

    expect(result.database).toBe(database);
    expect(result.fallbackMode).toBe(false);
    expect(result.shouldResetRecoveryTracking).toBe(true);
    expect(result.shouldNotifyDatabaseRecreated).toBe(false);
    expect(result.shouldScheduleBackgroundRecovery).toBe(false);
    expect(recoverIndexedDbInitialOpenRuntimeFailureMock).not.toHaveBeenCalled();
  });

  it('hands off to the recovery pipeline when open throws and forwards every flag', async () => {
    const database = fakeDatabase();
    const recoveredDatabase = fakeDatabase();
    openIndexedDbWithRetriesMock.mockRejectedValueOnce(new Error('boom'));
    recoverIndexedDbInitialOpenRuntimeFailureMock.mockResolvedValueOnce({
      database: recoveredDatabase,
      fallbackMode: true,
      stickyFallbackMode: true,
      shouldResetRecoveryTracking: false,
      shouldNotifyDatabaseRecreated: true,
      shouldScheduleBackgroundRecovery: true,
    });

    const result = await runFreshOpenAttempt({
      database,
      attachDatabaseEvents: vi.fn(),
    });

    expect(result).toEqual({
      database: recoveredDatabase,
      fallbackMode: true,
      stickyFallbackMode: true,
      shouldResetRecoveryTracking: false,
      shouldNotifyDatabaseRecreated: true,
      shouldScheduleBackgroundRecovery: true,
    });
  });
});

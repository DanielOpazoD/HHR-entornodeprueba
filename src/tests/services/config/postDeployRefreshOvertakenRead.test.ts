/* Synthetic only: the post-deploy refresh through the real sync path and the real local stores. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const recordOperationalTelemetry = vi.hoisted(() => vi.fn());
const loadRemoteRecordWithFallback = vi.hoisted(() => vi.fn());
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry,
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => true,
}));
vi.mock('@/services/repositories/dailyRecordRemoteLoader', () => ({
  loadRemoteRecordWithFallback,
}));

import { executeSyncDailyRecord } from '@/application/daily-record/syncDailyRecordUseCase';
import type { DailyRecordSyncPort } from '@/application/ports/dailyRecordPort';
import { executePostDeployRecentRecordRefresh } from '@/services/config/postDeployRecentRecordRefresh';
import { syncWithFirestoreDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { DataFactory } from '@/tests/factories/DataFactory';

const today = '2026-10-29';
const yesterday = '2026-10-28';
const marker = {
  version: 1 as const,
  reason: 'version-change' as const,
  fromVersion: 'synthetic-old',
  toVersion: 'synthetic-new',
  createdAt: '2026-10-29T03:00:00.000Z',
};
const serverDay = (date: string, lastUpdated: string) => ({
  ...DataFactory.createMockDailyRecord(date, { beds: {} }),
  lastUpdated,
});
const run = (clearMarker = vi.fn()) =>
  executePostDeployRecentRecordRefresh({
    todayDateString: today,
    readMarker: () => marker,
    clearMarker,
    // The real use case over the real repository service; the shared test setup replaces the port.
    syncRemoteRecord: date =>
      executeSyncDailyRecord({
        date,
        repository: { syncWithFirestoreDetailed } as unknown as DailyRecordSyncPort,
      }),
  }).then(result => ({ result, clearMarker }));

beforeEach(async () => {
  localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-current');
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  recordOperationalTelemetry.mockReset();
  loadRemoteRecordWithFallback.mockReset();
});
afterEach(() => localStorage.clear());

it('completes when the live subscription brings a newer copy of today before the refresh read lands', async () => {
  loadRemoteRecordWithFallback.mockImplementation(async (date: string) => {
    // What the open census does on its own while this read is on its way.
    if (date === today) {
      await hospitalDB.dailyRecords.put(serverDay(today, '2026-10-29T12:00:05.000Z'));
    }
    return { record: serverDay(date, '2026-10-29T12:00:00.000Z'), serverConfirmed: true };
  });

  const { result, clearMarker } = await run();

  expect(result.status).toBe('completed');
  expect(clearMarker).toHaveBeenCalledOnce();
  expect((await hospitalDB.dailyRecords.get(today))?.lastUpdated).toBe('2026-10-29T12:00:05.000Z');
  expect(await hospitalDB.dailyRecords.get(yesterday)).toBeDefined();
});

it('keeps the marker and reports a retry, not a failure, when the server cannot be read', async () => {
  loadRemoteRecordWithFallback.mockRejectedValue(new Error('synthetic offline'));

  const { result, clearMarker } = await run();

  expect(result.status).toBe('failed');
  expect(clearMarker).not.toHaveBeenCalled();
  expect(recordOperationalTelemetry).toHaveBeenCalledOnce();
  expect(recordOperationalTelemetry.mock.calls[0]?.[0]).toMatchObject({
    operation: 'post_deploy_recent_record_refresh',
    status: 'degraded',
    issues: ['failed'],
  });
});

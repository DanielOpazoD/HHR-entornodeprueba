import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const telemetry = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: telemetry.record,
}));

import {
  checkStorageHeadroom,
  resetStorageHeadroomCheckForTests,
} from '@/services/storage/indexeddb/storageHeadroom';
import { recordIndexedDbRecoveryNotice } from '@/services/storage/indexeddb/indexedDbRecoveryController';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';

const MB = 1_048_576;
const browserReports = (quotaMb: number, usageMb = 12) =>
  vi.stubGlobal('navigator', {
    storage: { estimate: vi.fn(async () => ({ quota: quotaMb * MB, usage: usageMb * MB })) },
  });

describe('warning about a nearly full disk before it breaks local saves', () => {
  beforeEach(() => {
    telemetry.record.mockReset();
    resetStorageHeadroomCheckForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports a nearly full disk with the space the browser still allows', async () => {
    browserReports(140);
    await checkStorageHeadroom();

    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'indexeddb',
        operation: 'storage_headroom_low',
        status: 'degraded',
        context: { storageQuotaMb: 140, storageUsedMb: 12 },
      })
    );
  });

  it('stays silent while the disk has room', async () => {
    browserReports(10_700);
    await checkStorageHeadroom();
    expect(telemetry.record).not.toHaveBeenCalled();
  });

  it('checks at most once every ten minutes', async () => {
    browserReports(140);
    await checkStorageHeadroom(0);
    await checkStorageHeadroom(9 * 60 * 1000);
    await checkStorageHeadroom(10 * 60 * 1000);
    expect(telemetry.record).toHaveBeenCalledTimes(2);
  });

  it('never fails when the browser cannot estimate', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    await expect(checkStorageHeadroom()).resolves.toBeUndefined();
    vi.stubGlobal('navigator', {});
    resetStorageHeadroomCheckForTests();
    await expect(checkStorageHeadroom()).resolves.toBeUndefined();
    expect(telemetry.record).not.toHaveBeenCalled();
  });

  it('checks the disk when IndexedDB closes unexpectedly', async () => {
    browserReports(140);
    recordIndexedDbRecoveryNotice('indexeddb_unexpected_close', 'cerrada');
    await vi.waitFor(() =>
      expect(telemetry.record).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'storage_headroom_low' })
      )
    );
  });

  it('keeps the IndexedDB failure names and the disk figures when sent to the server', () => {
    for (const operation of [
      'indexeddb_unexpected_close',
      'indexeddb_open_stalled',
      'indexeddb_database_closed',
      'storage_headroom_low',
    ]) {
      const event = sanitizeOperationalTelemetryEvent({
        category: 'indexeddb',
        status: 'degraded',
        operation,
        timestamp: '2026-11-07T08:00:00.000Z',
        context: { storageQuotaMb: 140, storageUsedMb: 12 },
      });
      expect(event).toMatchObject({
        operation,
        context: { storageQuotaMb: 140, storageUsedMb: 12 },
      });
    }
  });
});

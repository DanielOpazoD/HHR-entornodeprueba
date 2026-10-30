import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ unavailable: false }));

vi.mock('@/services/storage/indexeddb/indexedDbCore', async () => {
  const { HangaRoaDatabase } = await import('@/services/storage/indexeddb/indexedDbDatabase');
  const hospitalDB = new HangaRoaDatabase();
  return {
    hospitalDB,
    ensureDbReady: async () => {
      if (state.unavailable) throw new Error('Synthetic local log store unavailable');
      await hospitalDB.open();
    },
  };
});
vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalErrorTelemetry: vi.fn(),
}));

import { clearErrorLogs, fetchErrorLogs } from '@/services/errorLogService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';

describe('a local error log store that cannot be reached', () => {
  beforeEach(async () => {
    state.unavailable = false;
    await hospitalDB.open();
    await hospitalDB.errorLogs.clear();
  });

  afterAll(async () => {
    await hospitalDB.delete();
  });

  it('reads as empty only when the read succeeded', async () => {
    await expect(fetchErrorLogs()).resolves.toEqual([]);
  });

  it('fails the read instead of reporting no errors', async () => {
    state.unavailable = true;
    await expect(fetchErrorLogs()).rejects.toThrow('Synthetic local log store unavailable');
  });

  it('fails the clear instead of reporting it done', async () => {
    state.unavailable = true;
    await expect(clearErrorLogs()).rejects.toThrow('Synthetic local log store unavailable');
  });
});

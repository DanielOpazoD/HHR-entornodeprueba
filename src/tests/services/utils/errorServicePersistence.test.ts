import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const external = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: external,
}));

import { errorService } from '@/services/utils/errorService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { HangaRoaDatabase } from '@/services/storage/indexeddb/indexedDbDatabase';

const rejectAndReopen = async (reason: unknown) => {
  window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
  // This sink runs after the real IndexedDB write has settled, including a failed write.
  await vi.waitFor(() =>
    expect(external.mock.calls.some(([event]) => event.operation === 'error_service_log')).toBe(
      true
    )
  );
  hospitalDB.close();
  const reopened = new HangaRoaDatabase();
  try {
    await reopened.open();
    return await reopened.errorLogs.toArray();
  } finally {
    reopened.close();
  }
};

describe('local rejection history across a database reopen', () => {
  beforeEach(async () => {
    external.mockClear();
    errorService.clearErrors();
    await hospitalDB.open();
    await hospitalDB.errorLogs.clear();
  });
  afterEach(() => hospitalDB.close());

  it('persists an Error with its diagnostic code', async () => {
    const logs = await rejectAndReopen(
      Object.assign(new Error('Synthetic failure'), { code: 'synthetic_code' })
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].context?.reason).toEqual({
      name: 'Error',
      message: 'Synthetic failure',
      code: 'synthetic_code',
    });
  });

  it('still persists a literal reason', async () => {
    const logs = await rejectAndReopen('Synthetic literal');
    expect(logs).toHaveLength(1);
    expect(logs[0].context?.reason).toBe('Synthetic literal');
  });

  it('persists diagnostic fields even when the original object cannot be cloned', async () => {
    const logs = await rejectAndReopen({
      name: 'SyntheticError',
      message: 'Synthetic object',
      code: 'synthetic_code',
      callback: () => undefined,
      password: 'synthetic-secret',
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].context?.reason).toEqual({
      name: 'SyntheticError',
      message: 'Synthetic object',
      code: 'synthetic_code',
    });
  });
});

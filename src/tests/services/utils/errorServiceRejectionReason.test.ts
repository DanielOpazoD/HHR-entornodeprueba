import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorLog } from '@/services/logging/errorLogTypes';

const mocks = vi.hoisted(() => ({ save: vi.fn(), external: vi.fn() }));

vi.mock('@/services/storage/indexeddb/indexedDbErrorLogService', () => ({
  saveErrorLog: mocks.save,
}));
vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: mocks.external,
}));

import { errorService } from '@/services/utils/errorService';

const reject = (reason: unknown) =>
  window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));

const savedReason = async () => {
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
  const log = mocks.save.mock.calls[0][0] as ErrorLog;
  // What the viewer shows, and what a structured clone keeps.
  return JSON.parse(JSON.stringify(log.context?.reason)) as unknown;
};

describe('the cause of an uncaught rejection', () => {
  beforeEach(() => {
    expect(errorService).toBeDefined();
    mocks.save.mockClear();
    mocks.external.mockClear();
  });

  it('keeps the name and message of an Error in the local history', async () => {
    class SyntheticGateError extends Error {
      override name = 'SyntheticGateError';
    }
    reject(new SyntheticGateError('Estamos verificando los últimos datos.'));

    expect(await savedReason()).toEqual({
      name: 'SyntheticGateError',
      message: 'Estamos verificando los últimos datos.',
    });
  });

  it('keeps any other reason as it came', async () => {
    reject({ code: 'synthetic_code' });

    expect(await savedReason()).toEqual({ code: 'synthetic_code' });
  });

  it('does not send the cause outside this browser', async () => {
    reject(new Error('Detalle sintético'));

    await vi.waitFor(() => expect(mocks.external).toHaveBeenCalled());
    expect(mocks.external.mock.calls[0][0].context).not.toHaveProperty('reason');
  });
});

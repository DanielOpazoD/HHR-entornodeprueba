import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorLog } from '@/services/logging/errorLogTypes';

const mocks = vi.hoisted(() => ({ save: vi.fn(), external: vi.fn() }));

vi.mock('@/services/storage/indexeddb/indexedDbErrorLogService', () => ({
  saveErrorLog: mocks.save,
}));
vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: mocks.external,
}));

import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';
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

  it('keeps diagnostic fields of an object reason', async () => {
    reject({ code: 'synthetic_code' });

    expect(await savedReason()).toEqual({ code: 'synthetic_code' });
  });

  it('does not send the cause outside this browser', async () => {
    reject(
      Object.assign(new Error('Detalle sintético'), {
        code: 'synthetic_code',
        password: 'synthetic-secret',
        callback: () => undefined,
      })
    );

    await vi.waitFor(() => expect(mocks.external).toHaveBeenCalled());
    // The adapter sends only what the privacy gate returns.
    const sent = sanitizeOperationalTelemetryEvent(mocks.external.mock.calls[0][0]);
    expect(sent.context).not.toHaveProperty('reason');
    expect(JSON.stringify(sent)).not.toContain('Detalle sintético');
    expect(JSON.stringify(sent)).not.toContain('synthetic-secret');
    expect(JSON.stringify(sent)).not.toContain('synthetic_code');
  });
});

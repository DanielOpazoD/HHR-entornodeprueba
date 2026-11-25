// @vitest-environment node
import { createProviderError, credentialMarkers } from './providerErrorFixture';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('invokeWithTelemetry', () => {
  it('redacts provider errors in structured stderr and stdout logs', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { invokeWithTelemetry } = await import('../../../netlify/functions/lib/observability');
    const original = createProviderError();
    await expect(
      invokeWithTelemetry({
        service: 'synthetic',
        operation: 'read',
        timeoutMs: 1000,
        maxAttempts: 1,
        hospitalId: 'synthetic',
        fn: async () => {
          throw original;
        },
      })
    ).rejects.toBe(original);
    expect(logs).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logs.mock.calls[0]?.[0]))).toMatchObject({
      service: 'synthetic',
      operation: 'read',
      hospitalId: 'synthetic',
      status: 'failure',
      errorMessage: expect.stringContaining('HTTP 503'),
    });
    const outputs = JSON.stringify([logs.mock.calls, stdout.mock.calls]);
    for (const marker of credentialMarkers) expect(outputs).not.toContain(marker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('retries transient exceptions and preserves their failure metadata', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const error = Object.assign(new Error('synthetic connection reset'), { code: 'ECONNRESET' });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('recovered');
    const { invokeWithTelemetry } = await import('../../../netlify/functions/lib/observability');
    await expect(
      invokeWithTelemetry({
        service: 'test',
        operation: 'read',
        timeoutMs: 1000,
        maxAttempts: 2,
        backoffBaseMs: 1,
        fn,
      })
    ).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toMatchObject({
      status: 'failure',
      errorCode: 'ECONNRESET',
      errorMessage: error.message,
      attempt: 1,
      totalAttempts: 2,
      willRetry: true,
      level: 'warn',
    });
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"status":"success"'));
  });

  it('keeps telemetry deadlines as timeout and retries up to the configured limit', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = vi.fn(() => new Promise<never>(() => {}));
    const { invokeWithTelemetry } = await import('../../../netlify/functions/lib/observability');
    const outcome = expect(
      invokeWithTelemetry({
        service: 'test',
        operation: 'read',
        timeoutMs: 10,
        maxAttempts: 2,
        backoffBaseMs: 1,
        fn,
      })
    ).rejects.toThrow('Operation timed out after 10ms');
    await vi.runAllTimersAsync();
    await outcome;
    expect(fn).toHaveBeenCalledTimes(2);
    expect(errors.mock.calls.map(call => JSON.parse(String(call[0])))).toMatchObject([
      { status: 'timeout', errorCode: 'ETIMEDOUT', attempt: 1, willRetry: true },
      { status: 'timeout', errorCode: 'ETIMEDOUT', attempt: 2, willRetry: false },
    ]);
  });

  it.each([true, false])(
    'returns the same result without retries (classification enabled: %s)',
    async enabled => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const result = { statusCode: 502, body: 'synthetic-private-body' };
      const fn = vi.fn().mockResolvedValue(result);
      const { invokeWithTelemetry } = await import('../../../netlify/functions/lib/observability');
      await expect(
        invokeWithTelemetry({
          service: 'test',
          operation: 'read',
          timeoutMs: 1000,
          maxAttempts: 3,
          fn,
          ...(enabled
            ? { isFailureResult: (value: typeof result) => value.statusCode >= 500 }
            : {}),
        })
      ).resolves.toBe(result);
      expect(fn).toHaveBeenCalledTimes(1);
      if (enabled) {
        expect(stdout).not.toHaveBeenCalled();
        expect(errors).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toMatchObject({
          status: 'failure',
          errorCode: 'FAILURE_RESULT',
          willRetry: false,
          totalAttempts: 3,
        });
        expect(JSON.stringify(errors.mock.calls)).not.toContain(result.body);
      } else {
        expect(errors).not.toHaveBeenCalled();
        expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"status":"success"'));
      }
    }
  );
});

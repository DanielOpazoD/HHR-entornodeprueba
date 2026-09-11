import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dispatchOperationalTelemetryExternally,
  resolveOperationalTelemetryExternalConfig,
} from '@/services/observability/operationalTelemetryExternalAdapter';

const event = {
  category: 'sync' as const,
  status: 'failed' as const,
  operation: 'refresh_daily_record',
  timestamp: '2026-03-07T10:00:00.000Z',
};

describe('operationalTelemetryExternalAdapter', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves disabled config without endpoint', () => {
    expect(resolveOperationalTelemetryExternalConfig()).toEqual({
      enabled: false,
      endpoint: undefined,
      sampleRate: 1,
    });
  });

  it('sends payload through beacon when configured', async () => {
    vi.stubEnv('VITE_OPERATIONAL_TELEMETRY_ENDPOINT', 'https://example.test/ops');
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(globalThis, 'navigator', {
      value: { sendBeacon },
      configurable: true,
    });

    const sent = await dispatchOperationalTelemetryExternally(event);

    expect(sent).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith('https://example.test/ops', expect.any(Blob));
  });

  it('falls back to fetch when beacon is unavailable', async () => {
    vi.stubEnv('VITE_OPERATIONAL_TELEMETRY_ENDPOINT', 'https://example.test/ops');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });

    const sent = await dispatchOperationalTelemetryExternally(event);

    expect(sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.test/ops',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
      })
    );
  });
  it('does not claim success when the durable receiver rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    expect(
      await dispatchOperationalTelemetryExternally(event, {
        enabled: true,
        endpoint: '/telemetry',
        sampleRate: 1,
      })
    ).toBe(false);
  });
  it('sanitizes sensitive free text before it reaches fetch, including unknown operation names', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    await dispatchOperationalTelemetryExternally(
      {
        ...event,
        operation: 'Juan Perez',
        issues: ['Juan Perez 12.345.678-9'],
        context: { runId: 'Juan Perez', patientCount: 3 },
      },
      { enabled: true, endpoint: '/telemetry', sampleRate: 1 }
    );
    const body = fetchSpy.mock.calls[0][1].body;
    expect(body).not.toContain('Juan');
    expect(body).not.toContain('12.345.678');
    expect(JSON.parse(body).event).toMatchObject({
      operation: 'other_operation',
      context: { patientCount: 3 },
    });
  });
});

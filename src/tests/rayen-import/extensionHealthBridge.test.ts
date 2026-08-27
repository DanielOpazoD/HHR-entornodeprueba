import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_EXTENSION_HEALTH_REQUEST_TYPE,
  RAYEN_EXTENSION_HEALTH_RESULT_TYPE,
  RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
  isRayenExtensionHealthReport,
  requestRayenExtensionHealth,
  supportsPatientFlowReport,
  type RayenExtensionHealthReport,
} from '@/features/rayen-import/bridge/extensionHealthBridge';

const report: RayenExtensionHealthReport = {
  version: '0.5.0',
  protocolVersion: 1,
  capabilities: ['patient-flow-report'],
  checkedAt: '2026-07-14T05:00:00.000Z',
  fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
  gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
};

describe('extensionHealthBridge', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('validates a complete capability report', () => {
    expect(isRayenExtensionHealthReport(report)).toBe(true);
    expect(isRayenExtensionHealthReport({ ...report, fichaMedico: { status: 'unknown' } })).toBe(
      false
    );
    expect(isRayenExtensionHealthReport({ ...report, protocolVersion: '1' })).toBe(false);
    expect(isRayenExtensionHealthReport({ ...report, capabilities: [false] })).toBe(false);
    expect(supportsPatientFlowReport(report)).toBe(true);
    expect(supportsPatientFlowReport({ ...report, capabilities: undefined })).toBe(false);
  });

  it('correlates the health response and returns the extension report', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const request = requestRayenExtensionHealth(1000);
    const payload = postMessageSpy.mock.calls[0]?.[0] as { reqId: string; type: string };

    expect(payload.type).toBe(RAYEN_EXTENSION_HEALTH_REQUEST_TYPE);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: RAYEN_EXTENSION_HEALTH_RESULT_TYPE, reqId: payload.reqId, report },
      })
    );

    await expect(request).resolves.toEqual({ report });
  });

  it('accepts a valid synchronization preflight response after five seconds', async () => {
    vi.useFakeTimers();
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const request = requestRayenExtensionHealth(RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS);
    const payload = postMessageSpy.mock.calls[0]?.[0] as { reqId: string };

    setTimeout(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: RAYEN_EXTENSION_HEALTH_RESULT_TYPE, reqId: payload.reqId, report },
        })
      );
    }, 5_000);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(request).resolves.toEqual({ report });
  });

  it('ignores a late response whose reqId belongs to an earlier request', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const request = requestRayenExtensionHealth(1_000);
    const payload = postMessageSpy.mock.calls[0]?.[0] as { reqId: string };
    let settled = false;
    void request.then(() => {
      settled = true;
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_EXTENSION_HEALTH_RESULT_TYPE,
          reqId: `${payload.reqId}-anterior`,
          report,
        },
      })
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: RAYEN_EXTENSION_HEALTH_RESULT_TYPE, reqId: payload.reqId, report },
      })
    );
    await expect(request).resolves.toEqual({ report });
  });

  it('ends a synchronization preflight at its explicit bounded timeout', async () => {
    vi.useFakeTimers();
    const request = requestRayenExtensionHealth(RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS);

    await vi.advanceTimersByTimeAsync(RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS + 1);

    await expect(request).resolves.toEqual({
      report: null,
      error: 'La extensión Eloísa no respondió. Recárgala desde Chrome y vuelve a comprobar.',
    });
  });
});

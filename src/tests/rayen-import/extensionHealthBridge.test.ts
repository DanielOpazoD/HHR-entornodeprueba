import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_EXTENSION_HEALTH_REQUEST_TYPE,
  RAYEN_EXTENSION_HEALTH_RESULT_TYPE,
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

  it('returns an actionable error without a long synchronization timeout', async () => {
    vi.useFakeTimers();
    const request = requestRayenExtensionHealth(50);

    await vi.advanceTimersByTimeAsync(51);

    await expect(request).resolves.toEqual({
      report: null,
      error: 'La extensión Eloísa no respondió. Recárgala desde Chrome y vuelve a comprobar.',
    });
  });
});

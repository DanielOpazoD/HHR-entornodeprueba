import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_CONNECTION_REPAIR_REQUEST_TYPE,
  RAYEN_CONNECTION_REPAIR_RESULT_TYPE,
  requestRayenConnectionRepair,
} from '@/features/rayen-import/bridge/connectionRepairChannel';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';

const healthReport = {
  version: '0.48.12',
  protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
  checkedAt: new Date().toISOString(),
  fichaMedico: { status: 'ready' as const, message: 'Ficha vigente.' },
  gestionCamas: { status: 'ready' as const, message: 'Camas vigente.' },
};

describe('connectionRepairChannel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('correlaciona la respuesta y conserva solo un reporte de salud válido', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const request = requestRayenConnectionRepair();
    const payload = postMessageSpy.mock.calls[0]?.[0] as { type: string; reqId: string };

    expect(payload.type).toBe(RAYEN_CONNECTION_REPAIR_REQUEST_TYPE);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_CONNECTION_REPAIR_RESULT_TYPE,
          reqId: `${payload.reqId}-antiguo`,
          ok: false,
        },
      })
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_CONNECTION_REPAIR_RESULT_TYPE,
          reqId: payload.reqId,
          ok: true,
          state: 'ready',
          message: 'Conexión verificada.',
          report: healthReport,
        },
      })
    );

    await expect(request).resolves.toEqual({
      ok: true,
      state: 'ready',
      message: 'Conexión verificada.',
      report: healthReport,
    });
  });

  it('informa autenticación manual y termina de forma acotada si no hay respuesta', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const login = requestRayenConnectionRepair();
    const payload = postMessageSpy.mock.calls[0]?.[0] as { reqId: string };
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_CONNECTION_REPAIR_RESULT_TYPE,
          reqId: payload.reqId,
          ok: false,
          requiresLogin: true,
          error: 'Sesión vencida.',
          report: { unexpected: true },
        },
      })
    );
    await expect(login).resolves.toEqual({
      ok: false,
      requiresLogin: true,
      error: 'Sesión vencida.',
    });

    vi.useFakeTimers();
    const timedOut = requestRayenConnectionRepair(5_000);
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(timedOut).resolves.toEqual({
      ok: false,
      error: 'La extensión no terminó de reparar la conexión. Revisa las pestañas nuevas.',
    });
  });
});

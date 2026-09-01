import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_GC_CONNECT_REQUEST_TYPE,
  RAYEN_GC_CONNECT_RESULT_TYPE,
  requestGestionCamasConnect,
} from '@/features/rayen-import/bridge/gestionCamasConnectChannel';

describe('gestionCamasConnectChannel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('correlaciona la respuesta por reqId y entrega el resultado de apertura', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const request = requestGestionCamasConnect({ renew: true });
    const payload = postMessageSpy.mock.calls[0]?.[0] as {
      type: string;
      reqId: string;
      renew: boolean;
    };

    expect(payload.type).toBe(RAYEN_GC_CONNECT_REQUEST_TYPE);
    expect(payload.renew).toBe(true);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: RAYEN_GC_CONNECT_RESULT_TYPE, reqId: `${payload.reqId}-otro`, ok: false },
      })
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: RAYEN_GC_CONNECT_RESULT_TYPE, reqId: payload.reqId, ok: true },
      })
    );

    await expect(request).resolves.toEqual({ ok: true });
  });

  it('propaga el error de la extensión y degrada con timeout acotado', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const failing = requestGestionCamasConnect();
    const payload = postMessageSpy.mock.calls[0]?.[0] as { reqId: string };
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_GC_CONNECT_RESULT_TYPE,
          reqId: payload.reqId,
          ok: false,
          error: 'No se pudo abrir Gestión de Camas.',
        },
      })
    );
    await expect(failing).resolves.toEqual({
      ok: false,
      error: 'No se pudo abrir Gestión de Camas.',
    });

    vi.useFakeTimers();
    const timedOut = requestGestionCamasConnect({}, 5_000);
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(timedOut).resolves.toEqual({
      ok: false,
      error: 'La extensión no respondió al abrir Gestión de Camas. Vuelve a comprobar.',
    });
  });
});

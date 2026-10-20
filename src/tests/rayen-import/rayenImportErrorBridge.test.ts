import { describe, expect, it, vi } from 'vitest';
import {
  requestRayenSyncBundle,
  RAYEN_IMPORT_ERROR_MESSAGE_TYPE,
  subscribeToRayenImportErrors,
} from '@/features/rayen-import/bridge/rayenImportBridge';

describe('Rayen import error bridge', () => {
  it('delivers only the error correlated to the active sync request', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToRayenImportErrors(handler);
    const requestId = requestRayenSyncBundle('2026-07-24', '2026-07-25');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_IMPORT_ERROR_MESSAGE_TYPE,
          error: 'Error legado sin correlación.',
        },
      })
    );
    expect(handler).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_IMPORT_ERROR_MESSAGE_TYPE,
          requestId,
          error: 'No hay una pestaña de Ficha Médico abierta.',
        },
      })
    );

    expect(handler).toHaveBeenCalledWith(
      'No hay una pestaña de Ficha Médico abierta.',
      requestId,
      undefined,
      undefined
    );
    const nextRequestId = requestRayenSyncBundle('2026-07-24', '2026-07-25');
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_IMPORT_ERROR_MESSAGE_TYPE,
          requestId: nextRequestId,
          error: 'Tiempo de espera agotado.',
          timeoutStage: 'ficha_main_relay',
          captureRetries: 1,
        },
      })
    );
    expect(handler).toHaveBeenLastCalledWith(
      'Tiempo de espera agotado.',
      nextRequestId,
      'ficha_main_relay',
      1
    );
    unsubscribe();
  });
});

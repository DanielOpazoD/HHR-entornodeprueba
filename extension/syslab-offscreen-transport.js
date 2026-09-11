/** Correlated, cancellable relay to Syslab's real iframe. Never replays a dispatched operation. */
(function (root) {
  'use strict';

  const FRAME_ORIGIN = 'http://10.4.69.90';
  const FRAME_REQUEST = 'HHR_SYSLAB_FRAME_REQUEST';
  const FRAME_RESULT = 'HHR_SYSLAB_FRAME_RESULT';
  const TYPES = new Set([
    'RAYEN_SYSLAB_STATUS', 'RAYEN_SYSLAB_LOGIN', 'RAYEN_SYSLAB_PREPARE_SEARCH',
    'RAYEN_SYSLAB_SUBMIT_SEARCH', 'RAYEN_SYSLAB_READ_RESULTS',
    'RAYEN_SYSLAB_READ_DETAILS', 'RAYEN_SYSLAB_VALIDATE_REPORT',
  ]);

  const create = ({ frame, window: windowApi, crypto: cryptoApi = root.crypto }) => {
    const pending = new Map();
    let disposed = false;
    const fail = (code, message) => Object.assign(new Error(message), { code });
    const clear = (code, message) => {
      for (const entry of [...pending.values()]) entry.finish(fail(code, message));
    };
    const receive = event => {
      if (event.source !== frame?.contentWindow || event.origin !== FRAME_ORIGIN) return;
      const data = event.data;
      if (!data || data.type !== FRAME_RESULT || typeof data.reqId !== 'string') return;
      const entry = pending.get(data.reqId);
      if (entry) entry.finish(null, data.response || { error: 'Syslab no respondió a la solicitud.' });
    };
    const navigated = () => clear('SYSLAB_FRAME_NAVIGATED', 'La sesión interna de Syslab cambió de página.');
    windowApi.addEventListener('message', receive);
    frame?.addEventListener('load', navigated);

    const request = (message, { signal, timeoutMs = 601_000 } = {}) => new Promise((resolve, reject) => {
      if (disposed || !frame?.contentWindow) {
        reject(fail('SYSLAB_FRAME_UNAVAILABLE', 'No se pudo cargar la sesión interna de Syslab.'));
        return;
      }
      if (!TYPES.has(message?.type)) {
        reject(fail('SYSLAB_OPERATION_UNSUPPORTED', 'La operación de Syslab no es válida.'));
        return;
      }
      if (signal?.aborted) {
        reject(fail('SYSLAB_REQUEST_CANCELLED', 'La solicitud de Syslab fue cancelada.'));
        return;
      }
      if (pending.size >= 32) {
        reject(fail('SYSLAB_REQUEST_LIMIT', 'Hay demasiadas solicitudes de Syslab en curso.'));
        return;
      }
      const reqId = cryptoApi.randomUUID();
      let timer;
      const finish = (error, response) => {
        if (!pending.delete(reqId)) return;
        windowApi.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(response);
      };
      const abort = () => finish(fail('SYSLAB_REQUEST_CANCELLED', 'La solicitud de Syslab fue cancelada.'));
      pending.set(reqId, { finish });
      timer = windowApi.setTimeout(() => {
        finish(fail('SYSLAB_REQUEST_TIMEOUT', 'La sesión interna de Syslab todavía no responde.'));
      }, Math.min(601_000, Math.max(250, Number(timeoutMs) || 35_000)));
      signal?.addEventListener('abort', abort, { once: true });
      try {
        frame.contentWindow.postMessage({ type: FRAME_REQUEST, reqId, message }, FRAME_ORIGIN);
      } catch (_error) {
        finish(fail('SYSLAB_FRAME_UNAVAILABLE', 'No se pudo enviar la solicitud a Syslab.'));
      }
    });

    return Object.freeze({
      request,
      getDiagnostics: () => ({ pending: pending.size, disposed }),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        windowApi.removeEventListener('message', receive);
        frame?.removeEventListener('load', navigated);
        clear('SYSLAB_FRAME_DISPOSED', 'El documento interno de Syslab se cerró.');
      },
    });
  };

  root.HhrSyslabOffscreenTransport = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);

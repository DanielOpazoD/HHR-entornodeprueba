/** Bounded session checks and transient network recovery for the MAIN-world reader. */
(function (root) {
  'use strict';

  // Chrome «Failed to fetch», Firefox «NetworkError when attempting to fetch resource.»,
  // Safari «Load failed». Message-based on purpose: `instanceof TypeError` breaks across realms.
  const NETWORK_FAILURE_RE = /failed to fetch|networkerror|load failed/i;

  const errorMessage = error => String((error && error.message) || error);

  const isNetworkFailure = error => NETWORK_FAILURE_RE.test(errorMessage(error));

  /**
   * Keeps the original message (HHR classifies on it) and names the endpoint without its query
   * and with numeric path segments anonymised: an encounter id in `/encounter/<id>/...` must
   * never cross out of the MAIN world inside an error string.
   */
  const describeNetworkFailure = (error, url) =>
    new Error(
      errorMessage(error) +
        ' al consultar ' +
        String(url)
          .replace(/\?.*/, '')
          .replace(/\/\d+(?=\/|$)/g, '/{id}')
    );

  const READ_BLOCKED_MESSAGE =
    'Ficha Médico no puede leer datos desde esta pestaña (fallo de red al consultar Eloísa). ' +
    'Recarga la pestaña (Cmd+R).';
  const SESSION_READY_MESSAGE = 'Ficha Médico disponible. Sesión clínica vigente.';
  const SESSION_MISSING_MESSAGE = 'La sesión clínica de Ficha Médico no está disponible.';

  // A transient network failure expires after two minutes or a successful read.
  // Waiting exclusively for success would deadlock the disabled sync button.
  const READ_BLOCK_TTL_MS = 2 * 60 * 1000;

  // Retry only a changed network binding; HTTP failures are not retried.
  // A failed read blocks health temporarily, avoiding a permanent retry deadlock.
  const createSelfHealingReader = ({ readOnce, rebind, now, blockTtlMs }) => {
    const clock = typeof now === 'function' ? now : () => Date.now();
    const ttl = Number.isFinite(blockTtlMs) && blockTtlMs > 0 ? blockTtlMs : READ_BLOCK_TTL_MS;
    let lastFailure = null;

    const rememberAndThrow = error => {
      if (isNetworkFailure(error)) lastFailure = { at: clock(), message: errorMessage(error) };
      throw error;
    };

    const read = async () => {
      try {
        const snapshot = await readOnce();
        lastFailure = null;
        return snapshot;
      } catch (error) {
        if (!isNetworkFailure(error)) throw error;
        if (rebind() !== true) return rememberAndThrow(error);
        try {
          const snapshot = await readOnce();
          lastFailure = null;
          return snapshot;
        } catch (retryError) {
          return rememberAndThrow(retryError);
        }
      }
    };

    return {
      read,
      isReadBlocked: () => lastFailure !== null && clock() - lastFailure.at < ttl,
      getLastFailure: () => lastFailure,
    };
  };

  // Bound both response headers and body. A hung session check must not poison
  // the shared in-flight promise for the remaining lifetime of the page.
  const readSession = async (read, timeoutMs = 3000) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => read(controller?.signal)),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('La comprobación de sesión de Eloísa agotó el tiempo de espera.'));
            controller?.abort();
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const describeSessionStatus = ({ sessionReady, readBlocked, failureReason }) => {
    if (failureReason === 'session_expired') return { ready: false, message: 'La sesión de Ficha Médico venció. Vuelve a iniciar sesión en Eloísa.' };
    if (sessionReady && readBlocked) return { ready: false, message: READ_BLOCKED_MESSAGE };
    if (sessionReady) return { ready: true, message: SESSION_READY_MESSAGE };
    return { ready: false, message: SESSION_MISSING_MESSAGE };
  };

  root.HhrFichaMedicoReadResilience = {
    READ_BLOCK_TTL_MS,
    readSession,
    isNetworkFailure,
    describeNetworkFailure,
    createSelfHealingReader,
    describeSessionStatus,
  };
})(typeof self !== 'undefined' ? self : globalThis);

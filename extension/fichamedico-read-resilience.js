/**
 * fichamedico-read-resilience.js (MAIN world helper, loaded before inject-fichamedico.js)
 *
 * Pure helpers for reading Ficha Médico when the tab's network layer misbehaves. Seen live on
 * 02-09: a tab left open overnight still answered the health probe (same-origin session
 * endpoint) while every cross-origin API read died with a bare `TypeError('Failed to fetch')`
 * until the tab was reloaded. HHR kept offering a sync that failed in one second.
 *
 * No DOM, no fetch: the reader receives `readOnce` and `rebind` callbacks, so the policy is
 * unit-testable outside the page.
 */
(function (root) {
  'use strict';

  // Chrome «Failed to fetch», Firefox «NetworkError when attempting to fetch resource.»,
  // Safari «Load failed». Message-based on purpose: `instanceof TypeError` breaks across realms.
  const NETWORK_FAILURE_RE = /failed to fetch|networkerror|load failed/i;

  const errorMessage = error => String((error && error.message) || error);

  const isNetworkFailure = error => NETWORK_FAILURE_RE.test(errorMessage(error));

  /** Keeps the original message (HHR classifies on it) and names the endpoint without its query. */
  const describeNetworkFailure = (error, url) =>
    new Error(errorMessage(error) + ' al consultar ' + String(url).replace(/\?.*/, ''));

  const READ_BLOCKED_MESSAGE =
    'Ficha Médico no puede leer datos desde esta pestaña (fallo de red al consultar Eloísa). ' +
    'Recarga la pestaña (Cmd+R).';
  const SESSION_READY_MESSAGE = 'Ficha Médico disponible. Sesión clínica vigente.';
  const SESSION_MISSING_MESSAGE = 'La sesión clínica de Ficha Médico no está disponible.';

  /**
   * One self-heal attempt on a network failure: `rebind` drops the captured list URL / API
   * origin so the retry runs against the default backend with a freshly verified context. If
   * the retry also fails at network level the failure is remembered, and `isReadBlocked()` lets
   * the health probe stop reporting the tab as ready until a read succeeds again. HTTP errors
   * (4xx/5xx) never retry: they are answers, not a broken tab.
   */
  const createSelfHealingReader = ({ readOnce, rebind, now }) => {
    const clock = typeof now === 'function' ? now : () => Date.now();
    let lastFailure = null;

    const read = async () => {
      try {
        const snapshot = await readOnce();
        lastFailure = null;
        return snapshot;
      } catch (error) {
        if (!isNetworkFailure(error)) throw error;
        rebind();
        try {
          const snapshot = await readOnce();
          lastFailure = null;
          return snapshot;
        } catch (retryError) {
          if (isNetworkFailure(retryError)) {
            lastFailure = { at: clock(), message: errorMessage(retryError) };
          }
          throw retryError;
        }
      }
    };

    return {
      read,
      isReadBlocked: () => lastFailure !== null,
      getLastFailure: () => lastFailure,
    };
  };

  /** Honest health: a verified session whose reads fail at network level is NOT ready. */
  const describeSessionStatus = ({ sessionReady, readBlocked }) => {
    if (sessionReady && readBlocked) return { ready: false, message: READ_BLOCKED_MESSAGE };
    if (sessionReady) return { ready: true, message: SESSION_READY_MESSAGE };
    return { ready: false, message: SESSION_MISSING_MESSAGE };
  };

  root.HhrFichaMedicoReadResilience = {
    isNetworkFailure,
    describeNetworkFailure,
    createSelfHealingReader,
    describeSessionStatus,
  };
})(typeof self !== 'undefined' ? self : globalThis);

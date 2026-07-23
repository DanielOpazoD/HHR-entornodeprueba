/**
 * Resolves the safest available Syslab browsing context for the extension.
 *
 * A clinician may already have an authenticated Syslab tab open. Prefer that
 * first-party session and fall back to the extension offscreen context when no
 * connected tab exists. No cookies or credentials cross this boundary.
 */
(function (root) {
  'use strict';

  const SYSLAB_TAB_PATTERN = 'http://10.4.69.90/syslab/*';
  const STATUS_MESSAGE = Object.freeze({ type: 'RAYEN_SYSLAB_STATUS' });
  const TAB_MISSING = /no tab with id/i;
  const RECEIVER_MISSING = /could not establish connection|receiving end does not exist/i;
  const FALLBACK_ERROR_CODES = new Set([
    'SYSLAB_VISIBLE_TAB_UNAVAILABLE',
    'SYSLAB_VISIBLE_RECEIVER_UNAVAILABLE',
  ]);

  const create = dependencies => {
    const { chrome: chromeApi, withTimeout, sendToOffscreen, delay } = dependencies || {};
    if (
      !chromeApi || typeof withTimeout !== 'function' ||
      typeof sendToOffscreen !== 'function' || typeof delay !== 'function'
    ) {
      throw new Error('No se pudo inicializar el transporte de sesión Syslab.');
    }

    const sendToTab = (tabId, message, timeoutMs) => withTimeout(
      chromeApi.tabs.sendMessage(tabId, message),
      timeoutMs,
      'La pestaña de Syslab demoró demasiado en responder.'
    );

    const visibleSessions = async () => {
      if (typeof chromeApi.tabs.query !== 'function' || typeof chromeApi.tabs.sendMessage !== 'function') {
        return [];
      }
      let tabs;
      try {
        tabs = await chromeApi.tabs.query({ url: SYSLAB_TAB_PATTERN });
      } catch (_error) {
        return [];
      }
      const sessions = await Promise.all((Array.isArray(tabs) ? tabs : []).map(async tab => {
        if (!Number.isInteger(tab && tab.id)) return null;
        try {
          const status = await sendToTab(tab.id, STATUS_MESSAGE, 1_500);
          return status && status.bridgeId ? { tabId: tab.id, status } : null;
        } catch (_error) {
          // A tab may be navigating or may predate the current extension version.
          return null;
        }
      }));
      return sessions.filter(Boolean);
    };

    const resolveOffscreen = async ({ timeoutMs = 8_000 } = {}) => {
      const deadline = Date.now() + timeoutMs;
      let status;
      let lastError = 'La sesión interna de Syslab todavía no está disponible.';
      while (Date.now() < deadline) {
        try {
          status = await sendToOffscreen(
            STATUS_MESSAGE,
            Math.min(4_000, Math.max(250, deadline - Date.now()))
          );
          if (status && status.bridgeId && !status.error) break;
          lastError = String(status && status.error || lastError);
        } catch (error) {
          lastError = String((error && error.message) || error);
        }
        await delay(350);
      }
      if (!status || !status.bridgeId || status.error) throw new Error(lastError);
      return { kind: 'offscreen', status };
    };

    const resolve = async ({ offscreenTimeoutMs = 8_000 } = {}) => {
      const connectedVisible = (await visibleSessions()).filter(
        session => !session.status.error && session.status.loginRequired === false
      );
      const visible = connectedVisible.find(session =>
        /\/(?:aplicacion|parbusqueRut)\.php(?:[?#]|$)/i.test(String(session.status.url || ''))
      ) || connectedVisible[0];
      if (visible) {
        return {
          kind: 'visible-tab',
          tabId: visible.tabId,
          status: visible.status,
        };
      }
      return resolveOffscreen({ timeoutMs: offscreenTimeoutMs });
    };

    const unavailableTabError = error => {
      const failure = new Error(String((error && error.message) || error));
      failure.code = TAB_MISSING.test(failure.message)
        ? 'SYSLAB_VISIBLE_TAB_UNAVAILABLE'
        : 'SYSLAB_VISIBLE_RECEIVER_UNAVAILABLE';
      return failure;
    };

    const send = async (session, message, timeoutMs) => {
      if (session.kind !== 'visible-tab') return sendToOffscreen(message, timeoutMs);
      try {
        return await sendToTab(session.tabId, message, timeoutMs);
      } catch (error) {
        const messageText = String((error && error.message) || error);
        if (!TAB_MISSING.test(messageText) && !RECEIVER_MISSING.test(messageText)) throw error;
        throw unavailableTabError(error);
      }
    };

    const withVisibleFallback = async (session, operation, { timeoutMs = 8_000 } = {}) => {
      try {
        return await operation(session);
      } catch (error) {
        if (session.kind !== 'visible-tab' || !FALLBACK_ERROR_CODES.has(error && error.code)) {
          throw error;
        }
        return operation(await resolveOffscreen({ timeoutMs }));
      }
    };

    const sendWithVisibleFallback = (session, message, timeoutMs) => withVisibleFallback(
      session,
      current => send(current, message, timeoutMs),
      { timeoutMs }
    );

    const waitAfterNavigation = async (session, previousBridgeId, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      let lastError = 'La sesión de Syslab todavía no está disponible.';
      let lastFailure = null;
      while (Date.now() < deadline) {
        try {
          const status = await send(session, STATUS_MESSAGE, 4_000);
          if (status && status.bridgeId && status.bridgeId !== previousBridgeId) {
            return { ...session, status };
          }
        } catch (error) {
          if (error && error.code === 'SYSLAB_VISIBLE_TAB_UNAVAILABLE') throw error;
          if (error && error.code === 'SYSLAB_VISIBLE_RECEIVER_UNAVAILABLE') {
            lastFailure = error;
          }
          lastError = String((error && error.message) || error);
        }
        await delay(350);
      }
      if (lastFailure) throw lastFailure;
      throw new Error(lastError);
    };

    const currentSession = async () => {
      try {
        const session = await resolve();
        const bridge = session.status;
        if (!bridge || bridge.error) {
          return {
            ok: true,
            status: 'unavailable',
            connected: false,
            message: String(bridge && bridge.error || 'La sesión interna de Syslab no responde.'),
          };
        }
        const connected = !bridge.loginRequired;
        return {
          ok: true,
          status: connected ? 'ready' : 'login-required',
          connected,
          loginRequired: !connected,
          message: connected
            ? session.kind === 'visible-tab'
              ? 'Sesión de Syslab activa en Chrome.'
              : 'Sesión de Syslab activa.'
            : 'Syslab requiere iniciar sesión.',
        };
      } catch (_error) {
        return {
          ok: true,
          status: 'unavailable',
          connected: false,
          message: 'No se pudo conectar con Syslab en la red local.',
        };
      }
    };

    return Object.freeze({
      resolve,
      resolveOffscreen,
      send,
      sendWithVisibleFallback,
      withVisibleFallback,
      waitAfterNavigation,
      currentSession,
    });
  };

  root.HhrSyslabSessionTransport = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);

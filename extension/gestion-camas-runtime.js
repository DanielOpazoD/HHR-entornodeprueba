/** Gestión de Camas session lifecycle; message routing remains in background.js. */
(function (root) {
  'use strict';

  const MATCH_PATTERN = 'https://hospitalizado.rayensalud.cl/*';
  const LOGIN_URL = 'https://hospitalizado.rayensalud.cl/';
  const SESSION_PROBE_RUN = '000000000';

  const create = dependencies => {
    const {
      chrome: chromeApi,
      session,
      extensionHealth,
      withTimeout,
      fetchWithTimeout,
      backendRequestTimeoutMs,
      tabMessageTimeoutMs,
      healthProbeTimeoutMs,
    } = dependencies || {};

    if (
      !chromeApi || !session || !extensionHealth ||
      typeof withTimeout !== 'function' || typeof fetchWithTimeout !== 'function' ||
      !Number.isFinite(backendRequestTimeoutMs) || !Number.isFinite(tabMessageTimeoutMs) ||
      !Number.isFinite(healthProbeTimeoutMs)
    ) {
      throw new Error('No se pudo inicializar el runtime de Gestión de Camas.');
    }

    const readGestionCamasSession = async () => {
      const result = await chromeApi.storage.session.get(session.SESSION_STORAGE_KEY);
      return result && result[session.SESSION_STORAGE_KEY] || null;
    };

    const readPendingGestionCamasConnection = async () => {
      const result = await chromeApi.storage.session.get(
        session.PENDING_WINDOW_STORAGE_KEY
      );
      return (result && result[session.PENDING_WINDOW_STORAGE_KEY]) || null;
    };

    const readGestionCamasConnectionControl = async () => {
      const result = await chromeApi.storage.session.get(
        session.CONNECTION_CONTROL_STORAGE_KEY
      );
      return (result && result[session.CONNECTION_CONTROL_STORAGE_KEY]) || null;
    };

    const readClosingGestionCamasWindow = async () => {
      const result = await chromeApi.storage.session.get(
        session.CLOSING_WINDOW_STORAGE_KEY
      );
      return (result && result[session.CLOSING_WINDOW_STORAGE_KEY]) || null;
    };

    const isClosingGestionCamasWindow = (record, windowId, now = Date.now()) =>
      Boolean(
        record &&
          Number(record.windowId) === Number(windowId) &&
          Number(record.authorizedAt) > now - 60_000
      );

    const sameGestionCamasSession = (left, right) => Boolean(
      left && right &&
      left.token === right.token &&
      left.apiBase === right.apiBase &&
      left.facId === right.facId &&
      Number(left.sourceTabId) === Number(right.sourceTabId) &&
      String(left.connectionAttemptId || '') === String(right.connectionAttemptId || '')
    );

    let sessionMutation = Promise.resolve();
    const mutateGestionCamasSession = task => {
      const operation = sessionMutation.then(task, task);
      sessionMutation = operation.catch(() => {});
      return operation;
    };

    const clearGestionCamasSession = async expectedRecord => mutateGestionCamasSession(async () => {
      if (expectedRecord) {
        const current = await readGestionCamasSession();
        if (!sameGestionCamasSession(current, expectedRecord)) return false;
      }
      await chromeApi.storage.session.remove(session.SESSION_STORAGE_KEY);
      return true;
    });

    const clearUnusableGestionCamasSession = async () =>
      mutateGestionCamasSession(async () => {
        const current = await readGestionCamasSession();
        if (!current || session.isUsable(current)) return current;
        await chromeApi.storage.session.remove(session.SESSION_STORAGE_KEY);
        return null;
      });

    const persistGestionCamasSession = async (info, { sourceTabId } = {}) =>
      mutateGestionCamasSession(async () => {
        const record = session.buildSessionRecord(info);
        if (!record || !record.facId) {
          throw new Error('Gestión de Camas entregó una sesión sin establecimiento verificable.');
        }
        const normalizedSourceTabId = Number(sourceTabId);
        if (!Number.isInteger(normalizedSourceTabId) || normalizedSourceTabId < 0) {
          throw new Error('Gestión de Camas entregó una sesión sin pestaña de origen verificable.');
        }
        const current = await readGestionCamasSession();
        const pending = await readPendingGestionCamasConnection();
        const control = await readGestionCamasConnectionControl();
        const suppliedAttemptId = String(info && info.connectionAttemptId || '');
        const matchesPendingAttempt = Boolean(
          pending &&
          Number(pending.tabId) === normalizedSourceTabId &&
          String(pending.attemptId) === suppliedAttemptId
        );
        const matchesCurrentBinding = Boolean(
          current &&
          Number(current.sourceTabId) === normalizedSourceTabId &&
          String(current.connectionAttemptId || '') === suppliedAttemptId
        );
        const acceptsInitialUnscopedCapture = Boolean(
          !current && !pending && !suppliedAttemptId && !(control && control.blocked)
        );
        if (!matchesPendingAttempt && !matchesCurrentBinding && !acceptsInitialUnscopedCapture) {
          throw new Error('La captura pertenece a un intento de conexión anterior.');
        }

        record.sourceTabId = normalizedSourceTabId;
        record.connectionAttemptId = suppliedAttemptId;
        await chromeApi.storage.session.set({ [session.SESSION_STORAGE_KEY]: record });
        return record;
      });

    const markGestionCamasSessionVerified = async record => {
      let completedPopup = null;
      const verified = await mutateGestionCamasSession(async () => {
        const current = await readGestionCamasSession();
        if (!sameGestionCamasSession(current, record)) return null;
        const next = { ...current, lastVerifiedAt: Date.now() };
        await chromeApi.storage.session.set({ [session.SESSION_STORAGE_KEY]: next });
        const pending = await readPendingGestionCamasConnection();
        if (
          pending &&
          next.connectionAttemptId &&
          String(pending.attemptId) === String(next.connectionAttemptId) &&
          Number(pending.tabId) === Number(next.sourceTabId)
        ) {
          await chromeApi.storage.session.remove(session.PENDING_WINDOW_STORAGE_KEY);
          if (pending.closeOnVerify) {
            completedPopup = {
              windowId: Number(pending.windowId),
              attemptId: String(pending.attemptId),
            };
            await chromeApi.storage.session.set({
              [session.CLOSING_WINDOW_STORAGE_KEY]: {
                ...completedPopup,
                authorizedAt: Date.now(),
              },
            });
          }
        }
        return next;
      });
      if (completedPopup && Number.isInteger(completedPopup.windowId)) {
        setTimeout(() => {
          mutateGestionCamasSession(async () => {
            const closing = await readClosingGestionCamasWindow();
            if (
              !closing ||
              Number(closing.windowId) !== completedPopup.windowId ||
              String(closing.attemptId) !== completedPopup.attemptId
            ) {
              return false;
            }
            const pending = await readPendingGestionCamasConnection();
            return !(
              pending &&
              Number(pending.windowId) === completedPopup.windowId &&
              String(pending.attemptId) !== completedPopup.attemptId
            );
          }).then(canClose => {
            if (canClose) chromeApi.windows.remove(completedPopup.windowId).catch(() => {});
          });
        }, 450);
        setTimeout(() => {
          mutateGestionCamasSession(async () => {
            const closing = await readClosingGestionCamasWindow();
            if (
              closing &&
              Number(closing.windowId) === completedPopup.windowId &&
              String(closing.attemptId) === completedPopup.attemptId
            ) {
              await chromeApi.storage.session.remove(session.CLOSING_WINDOW_STORAGE_KEY);
            }
          });
        }, 60_000);
      }
      return verified;
    };

    const captureGestionCamasSession = async (info, sender) => {
      const record = await persistGestionCamasSession(info, { sourceTabId: sender?.tab?.id });
      return { ok: true, connection: session.publicStatus(record) };
    };

    const handleGestionCamasDocumentReady = async sender => {
      const sourceTabId = Number(sender?.tab?.id);
      if (!Number.isInteger(sourceTabId)) return { connectionAttemptId: '' };
      const control = await readGestionCamasConnectionControl();
      if (control && control.blocked) return { connectionAttemptId: '' };
      const pending = await readPendingGestionCamasConnection();
      if (pending && Number(pending.tabId) === sourceTabId) {
        return { connectionAttemptId: String(pending.attemptId || '') };
      }
      const current = await readGestionCamasSession();
      if (current && Number(current.sourceTabId) === sourceTabId) {
        return { connectionAttemptId: String(current.connectionAttemptId || '') };
      }
      return { connectionAttemptId: '' };
    };

    const requestLiveGestionCamasSession = async ({
      verificationTimeoutMs = backendRequestTimeoutMs,
      tabTimeoutMs = tabMessageTimeoutMs,
    } = {}) => {
      const tabs = extensionHealth.orderTabs(
        await chromeApi.tabs.query({ url: MATCH_PATTERN })
      );
      if (!tabs.length) return { error: 'Gestión de Camas no está abierta.' };
      const pending = await readPendingGestionCamasConnection();
      const current = await readGestionCamasSession();
      let lastError = 'Gestión de Camas está abierta, pero su sesión todavía no está disponible.';
      for (const tab of tabs) {
        try {
          const connectionAttemptId =
            pending && Number(pending.tabId) === Number(tab.id)
              ? String(pending.attemptId || '')
              : current && Number(current.sourceTabId) === Number(tab.id)
                ? String(current.connectionAttemptId || '')
                : '';
          const response = await withTimeout(
            chromeApi.tabs.sendMessage(tab.id, {
              type: 'RAYEN_GC_GET_FETCH_INFO',
              connectionAttemptId,
            }),
            tabTimeoutMs,
            'La pestaña de Gestión de Camas no respondió dentro del tiempo esperado.'
          );
          if (response && response.info) {
            const candidate = await persistGestionCamasSession(response.info, {
              sourceTabId: tab.id,
            });
            const verified = await verifyGestionCamasSession(candidate, verificationTimeoutMs);
            if (verified.record) return { record: verified.record };
            if (verified.changed) {
              const replacement = await readGestionCamasSession();
              if (session.isUsable(replacement)) return { record: replacement };
            }
            await clearGestionCamasSession(candidate);
            lastError = verified.error || 'La credencial capturada no pudo verificarse.';
            continue;
          }
          if (response && response.error) lastError = String(response.error);
        } catch (error) {
          lastError = String((error && error.message) || error);
        }
      }
      return { error: lastError };
    };

    const resolveGestionCamasSession = async ({ allowLive = true } = {}) => {
      let record = await readGestionCamasSession();
      if (!session.isUsable(record)) {
        if (record) await clearGestionCamasSession(record);
        if (!allowLive) return { error: 'Gestión de Camas no está conectada.' };
        const live = await requestLiveGestionCamasSession();
        if (!live.record) return live;
        record = live.record;
      }
      if (session.isVerificationFresh(record)) return { record };
      const verified = await verifyGestionCamasSession(record);
      if (verified.record) return verified;
      if (verified.changed) {
        return { error: 'La sesión cambió durante la comprobación. Reintenta la operación.' };
      }
      return { error: verified.error || 'No se pudo comprobar la sesión de Gestión de Camas.' };
    };

    const classifyGestionCamasRejection = async (response, record) => {
      if (!response) return '';
      if (response.status === 401) {
        return await clearGestionCamasSession(record) ? 'expired' : 'changed';
      }
      if (response.status === 403) return 'forbidden';
      return '';
    };

    const verifyGestionCamasSession = async (
      record,
      timeoutMs = backendRequestTimeoutMs
    ) => {
      if (!record || !record.facId) return { error: 'La sesión no informa el establecimiento.' };
      const url =
        `${record.apiBase}/facility/${record.facId}/encounter` +
        `?facId=0&prefferedIdentifierCode=${SESSION_PROBE_RUN}&prefferedPeridentId=2`;
      try {
        const response = await fetchWithTimeout(
          url,
          { headers: { Authorization: record.token } },
          timeoutMs
        );
        if (response.ok) {
          const verified = await markGestionCamasSessionVerified(record);
          return verified ? { record: verified } : { changed: true };
        }
        const rejection = await classifyGestionCamasRejection(response, record);
        if (rejection === 'changed') return { changed: true };
        if (rejection === 'expired') return { error: 'La sesión de Gestión de Camas venció.' };
        if (rejection === 'forbidden') {
          return { error: 'Rayen rechazó la comprobación por permisos; la sesión no se marcó como vigente.' };
        }
        return { error: 'Rayen respondió HTTP ' + response.status + ' al comprobar la sesión.' };
      } catch (error) {
        return { error: 'No se pudo comprobar la sesión: ' + String((error && error.message) || error) };
      }
    };

    const handleGestionCamasHealth = async () => {
      let record = await readGestionCamasSession();
      if (!session.isUsable(record)) {
        record = await clearUnusableGestionCamasSession();
        if (!session.isUsable(record)) {
          const live = await requestLiveGestionCamasSession({
            verificationTimeoutMs: healthProbeTimeoutMs,
            tabTimeoutMs: healthProbeTimeoutMs,
          });
          if (!live.record) {
            return {
              ...session.publicStatus(null),
              message: live.error || 'Gestión de Camas no está conectada.',
            };
          }
          record = live.record;
        }
      }
      if (session.isVerificationFresh(record)) {
        return session.publicStatus(record);
      }
      const verified = await verifyGestionCamasSession(record, healthProbeTimeoutMs);
      if (verified.record) return session.publicStatus(verified.record);
      if (verified.changed) return session.publicStatus(await readGestionCamasSession());
      const status = session.publicStatus(record);
      return {
        ...status,
        status: 'stale',
        message: verified.error || status.message,
      };
    };

    const setGestionCamasConnectionAttempt = async (
      tabId,
      connectionAttemptId,
      { rehydrated = false } = {}
    ) => {
      let lastError = 'La pestaña de Gestión de Camas no confirmó el intento de conexión.';
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const result = await mutateGestionCamasSession(async () => {
          const pending = await readPendingGestionCamasConnection();
          if (
            !pending ||
            Number(pending.tabId) !== Number(tabId) ||
            String(pending.attemptId || '') !== String(connectionAttemptId || '')
          ) {
            return { replaced: true };
          }
          try {
            const response = await withTimeout(
              chromeApi.tabs.sendMessage(tabId, {
                type: 'RAYEN_GC_SET_CONNECTION_ATTEMPT',
                connectionAttemptId,
                rehydrated,
              }),
              healthProbeTimeoutMs,
              'La pestaña no respondió al preparar la conexión.'
            );
            return { ok: Boolean(response && response.ok) };
          } catch (error) {
            return { error: String((error && error.message) || error) };
          }
        });
        if (result.replaced) {
          throw new Error('El intento de conexión fue reemplazado por uno más reciente.');
        }
        if (result.ok) return;
        if (result.error) lastError = result.error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error(lastError);
    };

    const beginGestionCamasConnectionAttempt = async ({ windowId, tabId, closeOnVerify, renew }) => {
      const pending = {
        windowId,
        tabId,
        closeOnVerify: Boolean(closeOnVerify),
        attemptId: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      const accepted = await mutateGestionCamasSession(async () => {
        const closing = await readClosingGestionCamasWindow();
        if (isClosingGestionCamasWindow(closing, windowId)) return false;
        if (closing && Number(closing.authorizedAt) <= Date.now() - 60_000) {
          await chromeApi.storage.session.remove(session.CLOSING_WINDOW_STORAGE_KEY);
        }
        await chromeApi.storage.session.set({
          [session.PENDING_WINDOW_STORAGE_KEY]: pending,
          [session.CONNECTION_CONTROL_STORAGE_KEY]: {
            blocked: false,
            updatedAt: Date.now(),
          },
        });
        if (renew) await chromeApi.storage.session.remove(session.SESSION_STORAGE_KEY);
        return true;
      });
      if (!accepted) return null;
      await setGestionCamasConnectionAttempt(tabId, pending.attemptId, {
        rehydrated: Boolean(closeOnVerify),
      });
      return pending;
    };

    const handleConnectGestionCamas = async ({ renew = false } = {}) => {
      const tabs = await chromeApi.tabs.query({ url: MATCH_PATTERN });
      const existing = extensionHealth.orderTabs(tabs)[0];
      if (existing && existing.id != null) {
        const pending = await beginGestionCamasConnectionAttempt({
          windowId: existing.windowId,
          tabId: existing.id,
          closeOnVerify: false,
          renew,
        });
        if (pending) {
          await chromeApi.tabs.update(existing.id, { active: true });
          if (existing.windowId != null) await chromeApi.windows.update(existing.windowId, { focused: true });
          return { ok: true, reused: true, message: 'Completa el acceso en la ventana oficial de Gestión de Camas.' };
        }
      }
      const popup = await chromeApi.windows.create({
        url: LOGIN_URL,
        type: 'popup',
        focused: true,
        width: 520,
        height: 720,
      });
      const popupTab = popup && Array.isArray(popup.tabs) ? popup.tabs[0] : null;
      if (popup && popup.id != null && popupTab && popupTab.id != null) {
        await beginGestionCamasConnectionAttempt({
          windowId: popup.id,
          tabId: popupTab.id,
          closeOnVerify: true,
          renew,
        });
      } else if (renew) {
        await clearGestionCamasSession();
      }
      return { ok: true, reused: false, message: 'Inicia sesión en la ventana oficial de Gestión de Camas.' };
    };

    const handleDisconnectGestionCamas = async () => {
      await mutateGestionCamasSession(async () => {
        await chromeApi.storage.session.remove([
          session.SESSION_STORAGE_KEY,
          session.PENDING_WINDOW_STORAGE_KEY,
        ]);
        await chromeApi.storage.session.set({
          [session.CONNECTION_CONTROL_STORAGE_KEY]: {
            blocked: true,
            updatedAt: Date.now(),
          },
        });
      });
      return { ok: true, connection: session.publicStatus(null) };
    };

    return Object.freeze({
      markSessionVerified: markGestionCamasSessionVerified,
      captureSession: captureGestionCamasSession,
      handleDocumentReady: handleGestionCamasDocumentReady,
      resolveSession: resolveGestionCamasSession,
      classifyRejection: classifyGestionCamasRejection,
      health: handleGestionCamasHealth,
      connect: handleConnectGestionCamas,
      disconnect: handleDisconnectGestionCamas,
    });
  };

  root.HhrGestionCamasRuntime = Object.freeze({ create });
})(typeof globalThis !== 'undefined' ? globalThis : self);

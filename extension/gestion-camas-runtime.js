/** Gestión de Camas session lifecycle; message routing remains in background.js. */
(function (root) {
  'use strict';

  const reasonOf = value => value && value.reason || 'session_unverified';
  const verificationFailure = (error, reason = 'session_unverified') => ({ error, reason });

  const MATCH_PATTERN = 'https://hospitalizado.rayensalud.cl/*';
  const LOGIN_URL = 'https://hospitalizado.rayensalud.cl/';
  const SESSION_PROBE_RUN = '000000000';
  const prioritizeTab = (tabs, pending, current) => {
    const tabId = pending?.tabId ?? current?.sourceTabId;
    return tabId == null ? tabs : tabs.slice().sort((left, right) =>
      Number(Number(right?.id) === Number(tabId)) - Number(Number(left?.id) === Number(tabId)));
  };
  const responsiveTabs = async (tabs, probe, confirmedIds) => {
    if (Array.isArray(confirmedIds) && confirmedIds.length) {
      return tabs.filter(tab => confirmedIds.some(id => Number(id) === Number(tab?.id)));
    }
    const outcomes = await Promise.allSettled(tabs.map(probe));
    const ready = tabs.filter((_tab, index) =>
      outcomes[index]?.status === 'fulfilled' && outcomes[index].value?.ready === true
    );
    return ready.length ? ready : tabs;
  };

  const create = dependencies => {
    const {
      chrome: chromeApi,
      session,
      extensionHealth,
      withTimeout,
      fetchWithTimeout,
      backendRequestTimeoutMs,
      tabMessageTimeoutMs,
      healthProbeTimeoutMs, recoverMissingReceiver,
    } = dependencies || {};

    if (
      !chromeApi || !session || !extensionHealth ||
      !root.HhrGestionCamasHealth ||
      typeof root.HhrGestionCamasHealth.create !== 'function' ||
      typeof extensionHealth.orderTabs !== 'function' ||
      typeof extensionHealth.probeTabs !== 'function' ||
      typeof withTimeout !== 'function' || typeof fetchWithTimeout !== 'function' ||
      !Number.isFinite(backendRequestTimeoutMs) || !Number.isFinite(tabMessageTimeoutMs) ||
      !Number.isFinite(healthProbeTimeoutMs)
    ) {
      throw new Error('No se pudo inicializar el runtime de Gestión de Camas.');
    }

    const readStored = async key => (await chromeApi.storage.session.get(key))?.[key] || null;
    const readGestionCamasSession = () => readStored(session.SESSION_STORAGE_KEY);
    const readPendingGestionCamasConnection = () => readStored(session.PENDING_WINDOW_STORAGE_KEY);
    const readGestionCamasConnectionControl = () => readStored(session.CONNECTION_CONTROL_STORAGE_KEY);
    const readClosingGestionCamasWindow = () => readStored(session.CLOSING_WINDOW_STORAGE_KEY);

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

    const isGestionCamasTabOpen = async tabId => {
      const normalized = Number(tabId);
      if (!Number.isInteger(normalized)) return false;
      const tabs = await chromeApi.tabs.query({ url: MATCH_PATTERN });
      return tabs.some(tab => Number(tab && tab.id) === normalized);
    };

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
        // The authenticated bootstrap may precede the attempt-id handshake on its bound tab.
        const matchesPendingAttempt = Boolean(
          pending &&
          Number(pending.tabId) === normalizedSourceTabId &&
          (String(pending.attemptId) === suppliedAttemptId || !suppliedAttemptId)
        );
        const matchesCurrentBinding = Boolean(
          current &&
          Number(current.sourceTabId) === normalizedSourceTabId &&
          String(current.connectionAttemptId || '') === suppliedAttemptId
        );
        // A dead source tab must not block a live authenticated replacement.
        const currentSourceTabAlive = current
          ? await isGestionCamasTabOpen(current.sourceTabId)
          : false;
        const acceptsUnscopedCapture = Boolean(
          (!current || !currentSourceTabAlive) &&
          !pending &&
          !suppliedAttemptId &&
          !(control && control.blocked)
        );
        if (!matchesPendingAttempt && !matchesCurrentBinding && !acceptsUnscopedCapture) {
          throw new Error('La captura pertenece a un intento de conexión anterior.');
        }

        record.sourceTabId = normalizedSourceTabId;
        record.connectionAttemptId =
          matchesPendingAttempt && pending ? String(pending.attemptId || '') : suppliedAttemptId;
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
      tabTimeoutMs = tabMessageTimeoutMs, targetTabIds, confirmedTabIds,
    } = {}) => {
      let tabs = extensionHealth.orderTabs(
        await extensionHealth.resolveTabs(chromeApi.tabs, MATCH_PATTERN, targetTabIds)
      );
      if (!tabs.length) return { error: 'Gestión de Camas no está abierta.' };
      const pending = await readPendingGestionCamasConnection();
      const current = await readGestionCamasSession();
      tabs = prioritizeTab(tabs, pending, current);
      tabs = await responsiveTabs(tabs, tab =>
        withTimeout(
          chromeApi.tabs.sendMessage(tab.id, { type: 'RAYEN_EXTENSION_HEALTH_PING' }),
          healthProbeTimeoutMs,
          'La pestaña de Gestión de Camas no respondió a la comprobación.'
        ), confirmedTabIds);
      let lastError = 'Gestión de Camas está abierta, pero su sesión todavía no está disponible.';
      let lastReason = 'session_unverified';
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
            await clearGestionCamasSession(candidate);
            lastError = verified.error || 'La credencial capturada no pudo verificarse.';
            lastReason = reasonOf(verified);
            continue;
          }
          if (response && response.error) lastError = String(response.error);
        } catch (error) {
          lastError = String((error && error.message) || error);
        }
      }
      return { error: lastError, reason: lastReason };
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
      if (verified.changed) return { error: 'La sesión cambió durante la comprobación.' };
      if (verified.reason === 'session_expired' && allowLive) {
        const live = await requestLiveGestionCamasSession();
        if (live.record) return live;
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

    const reverifyChangedGestionCamasSession = async timeoutMs => {
      const replacement = await readGestionCamasSession();
      if (session.isVerificationFresh(replacement)) return { record: replacement };
      if (!session.isUsable(replacement)) return { changed: true };
      return verifyGestionCamasSession(replacement, timeoutMs, false);
    };

    const verifyGestionCamasSession = async (
      record,
      timeoutMs = backendRequestTimeoutMs,
      retryChanged = true
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
          return verified ? { record: verified } : retryChanged
            ? reverifyChangedGestionCamasSession(timeoutMs) : { changed: true };
        }
        const rejection = await classifyGestionCamasRejection(response, record);
        if (rejection === 'changed') return retryChanged
          ? reverifyChangedGestionCamasSession(timeoutMs)
          : { changed: true };
        if (rejection === 'expired') {
          return verificationFailure('La sesión de Gestión de Camas venció.', 'session_expired');
        }
        if (rejection === 'forbidden') {
          return verificationFailure(
            'Rayen rechazó la comprobación por permisos; la sesión no se marcó como vigente.'
          );
        }
        return verificationFailure(
          'Rayen respondió HTTP ' + response.status + ' al comprobar la sesión.'
        );
      } catch (error) {
        return verificationFailure(
          'No se pudo comprobar la sesión: ' + String((error && error.message) || error)
        );
      }
    };

    const handleGestionCamasHealth = root.HhrGestionCamasHealth.create({
      chromeApi,
      extensionHealth,
      session,
      withTimeout,
      healthProbeTimeoutMs, recoverMissingReceiver,
      matchPattern: MATCH_PATTERN,
      readSession: readGestionCamasSession,
      clearUnusableSession: clearUnusableGestionCamasSession,
      requestLiveSession: requestLiveGestionCamasSession,
      verifySession: verifyGestionCamasSession,
    });

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
          closeOnVerify: false, // Health requires a live source, including newly opened tabs.
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

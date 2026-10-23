/** Session readiness and action verification, independent of the live-tab bridge probe. */
(function (root) {
  'use strict';

  const reasonOf = (value, fallback = 'session_unverified') => {
    if (value && value.reason) return value.reason;
    return value && value.status === 'ready' ? 'connected' : fallback;
  };

  const create = ({ session, readSession, clearUnusableSession, requestLiveSession,
    verifySession, healthProbeTimeoutMs }) => {
    const finish = status => {
      return { ...status, reason: reasonOf(status) };
    };

    const resolveRecord = async (matchingTabs, liveOptions) => {
      let record = await readSession();
      if (session.isUsable(record) &&
          !matchingTabs.some(tab => Number(tab?.id) === Number(record.sourceTabId))) {
        const live = await requestLiveSession(liveOptions);
        return { status: live.record ? session.publicStatus(live.record) : {
          status: 'stale',
          reason: reasonOf(live),
          message: live.error ||
            'La sesión guardada pertenece a una pestaña cerrada. Vuelve a conectar Gestión de Camas.',
        } };
      }
      if (!session.isUsable(record)) {
        record = await clearUnusableSession();
        if (!session.isUsable(record)) {
          const live = await requestLiveSession(liveOptions);
          if (!live.record) return { status: {
            ...session.publicStatus(null),
            reason: reasonOf(live),
            message: live.error || 'Gestión de Camas no está conectada.',
          } };
          record = live.record;
        }
      }
      return { record };
    };

    const verifyRecord = async (record, liveOptions) => {
      const verified = await verifySession(record, healthProbeTimeoutMs);
      if (verified.record) return finish(session.publicStatus(verified.record));
      if (verified.reason === 'session_expired') {
        const live = await requestLiveSession(liveOptions);
        if (live.record) return finish(session.publicStatus(live.record));
      }
      const status = session.publicStatus(record);
      return finish({
        ...status,
        status: 'stale',
        reason: reasonOf(verified, reasonOf(status)),
        message: verified.error || status.message,
      });
    };

    return async ({ matchingTabs, liveOptions, verifySessions = false }) => {
      const resolved = await resolveRecord(matchingTabs, liveOptions);
      if (resolved.status) return finish(resolved.status);
      if (!verifySessions && session.isVerificationFresh(resolved.record)) {
        return finish(session.publicStatus(resolved.record));
      }
      return verifyRecord(resolved.record, liveOptions);
    };
  };

  root.HhrGestionCamasSessionHealth = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);

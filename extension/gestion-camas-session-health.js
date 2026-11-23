/** Session readiness and action verification, independent of the live-tab bridge probe. */
(function (root) {
  'use strict';

  const reasonOf = (value, fallback = 'session_unverified') => {
    if (value && value.reason) return value.reason;
    return value && value.status === 'ready' ? 'connected' : fallback;
  };

  const create = ({ session, readSession, clearUnusableSession, requestLiveSession,
    verifySession, readFichaScope, pairWithFicha, healthProbeTimeoutMs }) => {
    const finish = status => {
      return { ...status, reason: reasonOf(status) };
    };

    const resolveRecord = async (matchingTabs, liveOptions) => {
      let record = await readSession();
      if (session.isUsable(record) &&
          !matchingTabs.some(tab => Number(tab?.id) === Number(record.sourceTabId))) {
        const live = await requestLiveSession(liveOptions);
        if (live.record) return { record: live.record };
        return { status: {
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

    const verifyRecord = async (record, liveOptions, background) => {
      const verified = await verifySession(record, healthProbeTimeoutMs);
      if (verified.record) return { record: verified.record };
      if (!background && verified.reason === 'session_expired') {
        const live = await requestLiveSession(liveOptions);
        if (live.record) return { record: live.record };
      }
      const status = session.publicStatus(record);
      return { status: finish({
        ...status,
        status: 'stale',
        reason: reasonOf(verified, reasonOf(status)),
        message: verified.error || status.message,
      }) };
    };

    return async ({ matchingTabs, liveOptions, verifySessions = false, background = false, bindScope = true }) => {
      const resolved = background ? { record: await readSession() } : await resolveRecord(matchingTabs, liveOptions);
      if (resolved.status) return finish(resolved.status);
      let { record } = resolved;
      if (background && matchingTabs.some(tab => Number(tab?.id) === Number(record?.sourceTabId))) return null;
      if (background && !session.isUsable(record)) return matchingTabs.length ? null : session.publicStatus(record);
      // A background session has no Camas tab to vouch for it: only its paired Ficha access can.
      const scope = await readFichaScope();
      const pairing = { scope, sourceAlive: !background, bind: bindScope && !background };
      const reconnect = (candidate, message) => ({
        ...session.publicStatus(candidate), status: 'stale', reason: 'session_unverified', message,
      });
      // Settle the pairing before verifying, so a session of another access never reaches Rayen.
      const unverified = await pairWithFicha(record, { ...pairing, bind: false });
      if (unverified.error) return reconnect(record, unverified.error);
      if (verifySessions || !session.isVerificationFresh(record)) {
        const verified = await verifyRecord(record, liveOptions, background);
        if (verified.status) return verified.status;
        record = verified.record;
      }
      const paired = await pairWithFicha(record, pairing);
      if (paired.error) return reconnect(record, paired.error);
      return session.publicStatus(paired.record);
    };
  };

  root.HhrGestionCamasSessionHealth = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);

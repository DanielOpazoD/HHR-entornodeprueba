/** Authenticated GC probes use a stored verification epoch to reject obsolete completions. */
(function (root) {
  'use strict';
  const epochOf = record => Number.isSafeInteger(record?.verificationEpoch)
    ? record.verificationEpoch : 0;
  const sameEpoch = (left, right) => epochOf(left) === epochOf(right);
  const begin = record => ({ ...record, lastVerifiedAt: null, verificationEpoch: epochOf(record) + 1 });
  const revoke = record => ({ ...record, lastVerifiedAt: null });
  const failure = (error, reason = 'session_unverified') => ({ error, reason });
  const errorMessage = error => String(error?.message || error);

  const create = ({ fetchWithTimeout, backendRequestTimeoutMs, beginVerification,
    revokeVerification, markVerified, classifyRejection, reverifyChanged }) => {
    const changed = (timeoutMs, retryChanged) => retryChanged
      ? reverifyChanged(timeoutMs) : { changed: true };
    return async (record, timeoutMs = backendRequestTimeoutMs, retryChanged = true) => {
      if (!record || !record.facId) return { error: 'La sesión no informa el establecimiento.' };
      const pending = await beginVerification(record);
      if (!pending) return changed(timeoutMs, retryChanged);
      const url = `${pending.apiBase}/facility/${pending.facId}/encounter` +
        '?facId=0&prefferedIdentifierCode=000000000&prefferedPeridentId=2';
      try {
        const response = await fetchWithTimeout(url,
          { headers: { Authorization: pending.token } }, timeoutMs);
        if (response.ok) {
          const verified = await markVerified(pending);
          return verified ? { record: verified } : changed(timeoutMs, retryChanged);
        }
        if (!await revokeVerification(pending)) return changed(timeoutMs, retryChanged);
        const rejection = await classifyRejection(response, pending);
        if (rejection === 'changed') return changed(timeoutMs, retryChanged);
        if (rejection === 'expired') {
          return failure('La sesión de Gestión de Camas venció.', 'session_expired');
        }
        if (rejection === 'forbidden') {
          return failure('Rayen rechazó la comprobación por permisos; la sesión no se marcó como vigente.');
        }
        return failure('Rayen respondió HTTP ' + response.status + ' al comprobar la sesión.');
      } catch (error) {
        if (!await revokeVerification(pending)) return changed(timeoutMs, retryChanged);
        return failure('No se pudo comprobar la sesión: ' + errorMessage(error));
      }
    };
  };

  root.HhrGestionCamasSessionVerification = Object.freeze({ create, sameEpoch, begin, revoke });
})(typeof self !== 'undefined' ? self : globalThis);

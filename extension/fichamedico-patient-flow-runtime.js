/** Read-only runtime for the official Ficha Médico patient-flow PDF. */
(function (root) {
  'use strict';
  const assertFunction = (value, name) => {
    if (typeof value !== 'function') throw new Error(`Falta la dependencia ${name}.`);
    return value;
  };
  const create = dependencies => {
    const clinicalClient = dependencies && dependencies.clinicalClient;
    const resolveSession = assertFunction(clinicalClient && clinicalClient.resolveSession, 'resolveSession');
    const readBuffer = assertFunction(clinicalClient && clinicalClient.readBuffer, 'readBuffer');
    const bufferToBase64 = assertFunction(dependencies && dependencies.bufferToBase64, 'bufferToBase64');
    const authorizedByTab = new Map();
    const snapshotGenerationByTab = new Map();
    const authorizationTtlMs = 5 * 60 * 1000;
    const trustedOrigins = new Set([
      'http://localhost:3000',
      'http://localhost:3001',
      'https://testinghhr.netlify.app',
    ]);
    const trustedTab = sender => {
      try {
        return Number.isInteger(sender && sender.tab && sender.tab.id) &&
          trustedOrigins.has(new URL(sender.tab.url).origin);
      } catch {
        return false;
      }
    };
    const authorizeSnapshotResponse = async (sender, responsePromise) => {
      const tabId = trustedTab(sender) ? sender.tab.id : null;
      const generation = tabId === null ? null : (snapshotGenerationByTab.get(tabId) || 0) + 1;
      if (tabId !== null) snapshotGenerationByTab.set(tabId, generation);
      const response = await responsePromise;
      const encounters = response && response.snapshot && response.snapshot.encounters;
      if (tabId === null || snapshotGenerationByTab.get(tabId) !== generation) return response;
      if (!Array.isArray(encounters)) {
        authorizedByTab.delete(tabId);
        return response;
      }
      const encounterIds = new Set(
        encounters.map(item => String(item && item.encounterId || '')).filter(id => /^\d+$/.test(id))
      );
      authorizedByTab.set(tabId, {
        encounterIds,
        expiresAt: Date.now() + authorizationTtlMs,
      });
      return response;
    };
    const isAuthorized = (sender, encId) => {
      if (!trustedTab(sender)) return false;
      const authorization = authorizedByTab.get(sender.tab.id);
      if (!authorization || authorization.expiresAt < Date.now()) {
        authorizedByTab.delete(sender.tab.id);
        return false;
      }
      return authorization.encounterIds.has(encId);
    };
    const handle = async (message, sender) => {
      const encId = String(message && message.encId || '');
      if (!/^\d+$/.test(encId)) {
        return { error: 'El episodio clínico no es válido para consultar su trazabilidad.' };
      }
      if (!isAuthorized(sender, encId)) {
        return { error: 'La trazabilidad no fue autorizada por el snapshot de esta pestaña.' };
      }
      const session = await resolveSession();
      if (session.error) return session;
      try {
        const result = await readBuffer({
          info: session.info,
          path: '/api/report/Flujo_del_Paciente.pdf',
          query: { enc_id: encId },
          cache: 'no-store',
        });
        return {
          ok: true,
          length: result.data.byteLength,
          base64: bufferToBase64(result.data),
        };
      } catch (error) {
        if (error && error.kind === 'http') {
          return { error: 'El servidor de Ficha Médico respondió HTTP ' + error.status + '.' };
        }
        const message = String(error && error.message || error || 'error desconocido');
        return { error: 'Falló la descarga de la trazabilidad de camas: ' + message };
      }
    };
    return Object.freeze({
      authorizeSnapshotResponse,
      route: Object.freeze({
        handle,
        fallback: 'No se pudo leer la trazabilidad de camas.',
      }),
    });
  };
  const api = Object.freeze({ create });
  root.HhrFichaMedicoPatientFlowRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);

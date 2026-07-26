/** Read-only runtime for the official Ficha Médico patient-flow PDF. */
(function (root) {
  'use strict';
  const assertFunction = (value, name) => {
    if (typeof value !== 'function') throw new Error(`Falta la dependencia ${name}.`);
    return value;
  };
  const authorizedItems = (response, includeReport) => {
    const encounters = response?.snapshot?.encounters;
    const reportRows = includeReport ? response?.bundle?.egresoRows : [];
    return Array.isArray(encounters) && Array.isArray(reportRows) ? [...encounters, ...reportRows] : null;
  };
  const create = dependencies => {
    const clinicalClient = dependencies && dependencies.clinicalClient;
    const resolveSession = assertFunction(clinicalClient && clinicalClient.resolveSession, 'resolveSession');
    const readBuffer = assertFunction(clinicalClient && clinicalClient.readBuffer, 'readBuffer');
    const bufferToBase64 = assertFunction(dependencies && dependencies.bufferToBase64, 'bufferToBase64');
    const trustedOrigins = new Set(['http://localhost:3000', 'http://localhost:3001',
      'https://testinghhr.netlify.app']);
    const authorization = root.HhrTabEncounterAuthorization.create({ trustedOrigins });
    const authorizeResponse = async (sender, responsePromise, includeReport) => {
      return authorization.authorizeResponse(
        sender,
        responsePromise,
        response => authorizedItems(response, includeReport)
      );
    };
    const authorizeSnapshotResponse = (sender, promise) => authorizeResponse(sender, promise, false);
    const authorizeBundleResponse = (sender, promise) => authorizeResponse(sender, promise, true);
    const isAuthorized = authorization.has;
    const authorizeVerifiedEncounter = authorization.add;
    const handle = async (message, sender) => {
      const encId = String(message && message.encId || '');
      if (!/^\d+$/.test(encId)) return { error: 'El episodio clínico no es válido para consultar su trazabilidad.' };
      if (!isAuthorized(sender, encId)) return { error: 'La trazabilidad no fue autorizada por el snapshot de esta pestaña.' };
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
      authorizeBundleResponse,
      authorizeVerifiedEncounter,
      isAuthorized,
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

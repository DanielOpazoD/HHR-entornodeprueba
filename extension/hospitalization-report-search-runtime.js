/** Query report episodes across patient and maternal/progenitor RUN identifiers. */
(function (root) {
  'use strict';
  const identity = root.HhrEloisaPatientIdentity;
  const buildUrl = ({ info, patientRun, patientDocumentType, identifierType }) => {
    const url = new URL('/api/inpatientReport/getEncounterHistoryReport', info.apiOrigin);
    url.searchParams.set('prefferedPeridentId', String(identifierType));
    url.searchParams.set(
      'prefferedIdentifierCode',
      identity.identityKey(patientRun, patientDocumentType)
    );
    url.searchParams.set('facilityId', String(info.facId));
    url.searchParams.set('dateFrom', '');
    url.searchParams.set('dateTo', '');
    return url.toString();
  };
  const fetchRows = async (request, identifierType) => {
    const { info, patientRun, patientDocumentType, fetchWithTimeout } = request;
    try {
      const response = await fetchWithTimeout(
        buildUrl({
          info,
          patientRun,
          patientDocumentType,
          identifierType,
        }),
        {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        }
      );
      if (response.status === 401 || response.status === 403)
        return { error: 'Eloísa no autorizó la búsqueda de informes para la sesión actual.' };
      if (!response.ok)
        return { error: 'Eloísa respondió HTTP ' + response.status + ' al buscar los informes.' };
      const payload = await response.json();
      return { rows: Array.isArray(payload) ? payload : [] };
    } catch (error) {
      return {
        error:
          'No se pudieron buscar los informes en Eloísa: ' +
          String((error && error.message) || error),
      };
    }
  };
  const resolveRows = async request => {
    const { info } = request;
    if (!info || !info.apiOrigin || !info.token || !/^\d+$/.test(String(info.facId || '')))
      return { error: 'La sesión no permite consultar informes de hospitalización.' };
    return identity.resolveReportRows({ ...request, fetchRows: type => fetchRows(request, type) });
  };
  root.HhrHospitalizationReportSearchRuntime = { resolveRows };
})(typeof globalThis !== 'undefined' ? globalThis : self);

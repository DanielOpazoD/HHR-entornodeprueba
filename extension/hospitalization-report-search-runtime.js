/** Query report episodes across patient and maternal/progenitor RUN identifiers. */
(function (root) {
  'use strict';
  const buildUrl = ({ info, patientRun, identifierType, normalizeRun }) => {
    const url = new URL('/api/inpatientReport/getEncounterHistoryReport', info.apiOrigin);
    url.searchParams.set('prefferedPeridentId', String(identifierType));
    url.searchParams.set('prefferedIdentifierCode', normalizeRun(patientRun));
    url.searchParams.set('facilityId', String(info.facId));
    url.searchParams.set('dateFrom', '');
    url.searchParams.set('dateTo', '');
    return url.toString();
  };
  const fetchRows = async (request, identifierType) => {
    const { info, patientRun, fetchWithTimeout, normalizeRun } = request;
    try {
      const response = await fetchWithTimeout(
        buildUrl({ info, patientRun, identifierType, normalizeRun }),
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
    const { info, patientRun, encId, isEncounter, matchingRows } = request;
    if (!info || !info.apiOrigin || !info.token || !/^\d+$/.test(String(info.facId || '')))
      return { error: 'La sesión no permite consultar informes de hospitalización.' };
    const runRows = await fetchRows(request, 2);
    if (runRows.error) return runRows;
    const requested = isEncounter(encId) ? String(encId) : '';
    if (
      requested &&
      matchingRows(runRows.rows, patientRun).some(row => String(row.encounterId) === requested)
    )
      return runRows;
    const maternalRows = await fetchRows(request, 4);
    if (maternalRows.error) return maternalRows;
    const byEncounter = new Map();
    [...runRows.rows, ...maternalRows.rows].forEach(row => {
      const encounterId = String((row && row.encounterId) || '');
      if (isEncounter(encounterId) && !byEncounter.has(encounterId))
        byEncounter.set(encounterId, row);
    });
    return { rows: [...byEncounter.values()] };
  };
  root.HhrHospitalizationReportSearchRuntime = { resolveRows };
})(typeof globalThis !== 'undefined' ? globalThis : self);

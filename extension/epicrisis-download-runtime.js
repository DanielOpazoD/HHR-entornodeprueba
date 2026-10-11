/** Download an official epicrisis or delegate complete-history navigation for one episode. */
(function (root) {
  'use strict';

  const reports = root.HhrHospitalizationReportsRuntime;

  const resolveDirectEpisode = request => {
    const encId = /^\d+$/.test(String(request.encId || '')) ? String(request.encId) : '';
    if (!encId) return { error: 'El paciente no tiene un episodio clínico válido.' };
    const match = String(request.admissionDate || '').match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
    const startDate = match ? match[1] : '';
    return {
      encId,
      row: { encounterId: encId, startPeriod: startDate, endPeriod: null },
      // The exact episode id is authoritative, but a direct HHR lookup cannot prove whether an
      // old episode is still active. Keep that state unknown instead of labelling it as vigente.
      episode: { encId, startDate, endDate: '' },
    };
  };

  const openDocument = (request, resolved) => {
    const documentType = request.documentType || 'epicrisis';
    if (documentType === 'history')
      return reports.openHistoryReport({ chrome: request.chrome || root.chrome, now: request.now, resolved });
    if (documentType !== 'epicrisis' && documentType !== 'nursing-epicrisis')
      return { error: 'El tipo de informe no es válido.' };
    return root.HhrEpicrisisPdfDownload.download(request, resolved);
  };

  const handleDirectRequest = (request, resolved, operation) => {
    if (operation === 'list') return { ok: true, episodes: [resolved.episode] };
    if (operation !== 'download') return { error: 'La operación de informes no es válida.' };
    return openDocument(request, resolved);
  };

  const handleRunRequest = async (request, operation) => {
    const rowsResult = await reports.resolveRows(request);
    if (rowsResult.error) return rowsResult;
    const listed = reports.listEpisodes({ ...request, rows: rowsResult.rows });
    const direct = resolveDirectEpisode(request);
    // The report index can omit an ongoing hospitalization. Verify the exact episode against
    // Eloisa before supplementing that index; never substitute the patient's latest discharge.
    if (!direct.error && !listed.episodes.some(episode => episode.encId === direct.encId)) {
      const context = await request.getClinicalReportContext(direct.encId, request.info, null, request.sender);
      if (context && context.error) return context;
      if (reports.normalizeRun(context && context.patient && context.patient.run) !== request.patientRun)
        return { error: 'El episodio no corresponde al RUN seleccionado. Actualiza el censo y reintenta.' };
      if (operation === 'list') return { ok: true, episodes: [direct.episode, ...listed.episodes] };
      return handleDirectRequest(request, { ...direct, context }, operation);
    }
    if (operation === 'list') return listed;
    if (operation !== 'download') return { error: 'La operación de informes no es válida.' };
    const resolved = reports.selectEncounter({ ...request, rows: rowsResult.rows });
    return resolved.error ? resolved : openDocument(request, resolved);
  };

  const handleRequest = async request => {
    if (request.delivery !== 'download') return request.printFallback(request);
    const patientRun = reports.normalizeRun(request.patientRun);
    const hasValidRun = reports.isValidRun(patientRun);
    const resolvedDirectEpisode = resolveDirectEpisode(request);
    const hasDirectHistoryRange = request.documentType === 'history' && !resolvedDirectEpisode.error &&
      Boolean(resolvedDirectEpisode.row.startPeriod);
    const directEpisode = hasDirectHistoryRange || !hasValidRun ? resolvedDirectEpisode : null;
    if (directEpisode && directEpisode.error) return directEpisode;
    const infoResult = await request.getFichaFetchInfo(request.sender);
    if (infoResult.error) return infoResult;
    const withSession = { ...request, info: infoResult.info, patientRun };
    const operation = request.operation || 'download';
    return directEpisode
      ? handleDirectRequest(withSession, directEpisode, operation)
      : handleRunRequest(withSession, operation);
  };

  root.HhrEpicrisisDownloadRuntime = { handleRequest };
})(typeof globalThis !== 'undefined' ? globalThis : self);

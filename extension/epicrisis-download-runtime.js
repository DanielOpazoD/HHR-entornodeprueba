/** Download an official epicrisis or delegate complete-history navigation for one episode. */
(function (root) {
  'use strict';

  const reports = root.HhrHospitalizationReportsRuntime;

  const downloadEpicrisis = async (request, resolved) => {
    const reportUrl = new URL('/api/report/Reporte_Epicrisis.pdf', request.info.apiOrigin);
    reportUrl.searchParams.set('enc_id', resolved.encId);
    const report = await request.fetchOfficialPdf({
      url: reportUrl.toString(),
      token: request.info.token,
      label: 'la epicrisis médica',
    });
    if (report.error) return { error: report.error };
    const downloaded = await request.downloadPdfBuffer({
      buffer: report.buffer,
      filename: 'Epicrisis_medica_' + resolved.encId + '.pdf',
    });
    return downloaded.error ? downloaded : { ...downloaded, encId: resolved.encId };
  };

  const handleRequest = async request => {
    if (request.delivery !== 'download') return request.printFallback(request);
    const patientRun = reports.normalizeRun(request.patientRun);
    if (!reports.isValidRun(patientRun)) {
      return { error: 'No se pudo validar el RUN del paciente seleccionado.' };
    }
    const infoResult = await request.getFichaFetchInfo(request.sender);
    if (infoResult.error) return infoResult;
    const withSession = { ...request, info: infoResult.info, patientRun };
    const rowsResult = await reports.resolveRows(withSession);
    if (rowsResult.error) return rowsResult;
    const operation = request.operation || 'download';
    if (operation === 'list') return reports.listEpisodes({ ...withSession, rows: rowsResult.rows });
    if (operation !== 'download') return { error: 'La operación de informes no es válida.' };
    const resolved = reports.selectEncounter({ ...withSession, rows: rowsResult.rows });
    if (resolved.error) return resolved;
    const documentType = request.documentType || 'epicrisis';
    if (documentType === 'history') {
      return reports.openHistoryReport({
        chrome: request.chrome || root.chrome,
        now: request.now,
        resolved,
      });
    }
    if (documentType !== 'epicrisis') return { error: 'El tipo de informe no es válido.' };
    return downloadEpicrisis(withSession, resolved);
  };

  root.HhrEpicrisisDownloadRuntime = { handleRequest };
})(typeof globalThis !== 'undefined' ? globalThis : self);

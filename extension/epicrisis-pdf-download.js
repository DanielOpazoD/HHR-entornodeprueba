/** Retrieve the official medical or nursing epicrisis PDF for an already resolved episode. */
(function (root) {
  'use strict';
  const downloadEpicrisis = async (request, resolved) => {
    const nursing = request.documentType === 'nursing-epicrisis';
    const reportUrl = new URL(nursing
      ? '/api/report/Alta_Enfermeria_Blank_A4.pdf'
      : '/api/report/Reporte_Epicrisis.pdf', request.info.apiOrigin);
    reportUrl.searchParams.set('enc_id', resolved.encId);
    if (nursing) {
      const context = resolved.context || await request.getClinicalReportContext(
        resolved.encId, request.info, null, request.sender
      );
      if (!context || context.error) return context || { error: 'No se pudo identificar al paciente.' };
      const params = {
        pat_id: context.patientId,
        fac_id: resolved.row.facilityId || context.info.facId,
        hcp_id: context.info.practitionerId,
      };
      if (Object.values(params).some(value => !/^\d+$/.test(String(value || ''))))
        return { error: 'Faltan datos del episodio para descargar la epicrisis de enfermería.' };
      Object.entries(params).forEach(([key, value]) => reportUrl.searchParams.set(key, String(value)));
    }
    const report = await request.fetchOfficialPdf({
      url: reportUrl.toString(),
      token: request.info.token,
      label: nursing ? 'la epicrisis de enfermería' : 'la epicrisis médica',
    });
    if (report.error) return { error: report.error };
    const downloaded = await request.downloadPdfBuffer({
      buffer: report.buffer,
      filename: (nursing ? 'Epicrisis_enfermeria_' : 'Epicrisis_medica_') + resolved.encId + '.pdf',
    });
    return downloaded.error ? downloaded : { ...downloaded, encId: resolved.encId };
  };

  root.HhrEpicrisisPdfDownload = { download: downloadEpicrisis };
})(typeof globalThis !== 'undefined' ? globalThis : self);

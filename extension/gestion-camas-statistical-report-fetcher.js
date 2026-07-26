/** Authenticated exact-episode reader shared by statistical-discharge workflows. */
(function (root) {
  'use strict';
  const create = ({ resolveSession, fetchOfficialPdf, markSessionVerified }) => async encId => {
    const encounterId = String(encId || '').trim();
    if (!/^\d+$/.test(encounterId)) return { error: 'El egreso no tiene un episodio válido.' };
    const session = await resolveSession();
    if (!session.record) {
      return { error: session.error || 'Conecta Gestión de Camas para descargar el egreso.' };
    }
    const record = session.record;
    const reportUrl = new URL(
      'report/Informe_Estadistico_Egreso_Hospitalario_CARTA.pdf',
      String(record.apiBase || '').replace(/\/?$/, '/')
    );
    reportUrl.searchParams.set('ENC_ID', encounterId);
    const report = await fetchOfficialPdf({
      ...record,
      url: reportUrl.toString(),
      label: 'el informe estadístico de egreso',
    });
    if (report.error) return { error: report.error };
    if (!(await markSessionVerified(record))) {
      return { error: 'La sesión cambió durante la descarga. Reintenta la operación.' };
    }
    return { buffer: report.buffer };
  };
  root.HhrGestionCamasStatisticalReportFetcher = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);

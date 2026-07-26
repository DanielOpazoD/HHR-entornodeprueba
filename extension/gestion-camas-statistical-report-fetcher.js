/** Authenticated exact-episode reader shared by statistical-discharge workflows. */
(function (root) {
  'use strict';
  const REPORT_PATH = 'report/Informe_Estadistico_Egreso_Hospitalario_CARTA.pdf';
  const CONNECT_ERROR = 'Conecta Gestión de Camas para descargar el egreso.';
  const BASE_ERROR = 'Gestión de Camas no entregó una dirección válida para el egreso.';
  const SESSION_ERROR = 'La sesión cambió durante la descarga. Reintenta la operación.';
  const create = ({ resolveSession, fetchOfficialPdf, markSessionVerified }) => async encId => {
    const encounterId = String(encId || '').trim();
    if (!/^\d+$/.test(encounterId)) return { error: 'El egreso no tiene un episodio válido.' };
    const session = await resolveSession();
    if (!session.record) return { error: session.error || CONNECT_ERROR };
    const record = session.record;
    const apiBase = String(record.apiBase || '').trim();
    if (!apiBase) return { error: CONNECT_ERROR };
    if (!URL.canParse(apiBase) || !/^https?:\/\//i.test(apiBase)) return { error: BASE_ERROR };
    const reportUrl = new URL(REPORT_PATH, apiBase.replace(/\/?$/, '/'));
    reportUrl.searchParams.set('ENC_ID', encounterId);
    const report = await fetchOfficialPdf({
      ...record,
      url: reportUrl.toString(),
      label: 'el informe estadístico de egreso',
    });
    if (report.error) return { error: report.error };
    if (!(await markSessionVerified(record))) return { error: SESSION_ERROR };
    return { buffer: report.buffer };
  };
  root.HhrGestionCamasStatisticalReportFetcher = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);

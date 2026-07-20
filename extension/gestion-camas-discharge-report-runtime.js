/** Exact Gestión de Camas statistical-discharge report workflow. */
(function (root, factory) {
  'use strict';
  root.HhrGestionCamasDischargeReportRuntime = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const create = ({ resolveSession, fetchOfficialPdf, markSessionVerified, downloadPdfBuffer }) => {
    const download = async ({ encId }) => {
      const encounterId = String(encId || '').trim();
      if (!/^\d+$/.test(encounterId)) return { error: 'El egreso no tiene un episodio válido.' };
      const session = await resolveSession();
      if (!session.record) {
        return { error: session.error || 'Conecta Gestión de Camas para descargar el egreso.' };
      }
      const result = session.record;
      const reportUrl = new URL(
        'report/Informe_Estadistico_Egreso_Hospitalario_CARTA.pdf',
        String(result.apiBase || '').replace(/\/?$/, '/')
      );
      reportUrl.searchParams.set('ENC_ID', encounterId);
      const report = await fetchOfficialPdf({
        url: reportUrl.toString(),
        token: result.token,
        label: 'el informe estadístico de egreso',
      });
      if (report.error) return { error: report.error };
      if (!(await markSessionVerified(result))) {
        return { error: 'La sesión cambió durante la descarga. Reintenta la operación.' };
      }
      const downloaded = await downloadPdfBuffer({
        buffer: report.buffer,
        filename: `Egreso_estadistico_${encounterId}.pdf`,
      });
      return downloaded.error ? downloaded : { ...downloaded, ok: true };
    };
    return Object.freeze({ download });
  };

  return Object.freeze({ create });
});

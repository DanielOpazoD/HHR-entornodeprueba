/** Exact Gestión de Camas statistical-discharge report workflow. */
(function (root, factory) {
  'use strict';
  root.HhrGestionCamasDischargeReportRuntime = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const create = ({ fetchReport, downloadPdfBuffer }) => {
    const download = async ({ encId }) => {
      const encounterId = String(encId || '').trim();
      const report = await fetchReport(encounterId);
      if (report.error) return report;
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

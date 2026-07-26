/** Private evidence reader for an exact episode authorized by the current HHR sync. */
(function (root) {
  'use strict';
  const create = ({ fetchReport, bufferToBase64, isAuthorized }) => {
    const read = async ({ encId, sender }) => {
      const encounterId = String(encId || '').trim();
      if (!isAuthorized(sender, encounterId)) {
        return { error: 'El egreso individual no fue autorizado para esta sincronización.' };
      }
      const report = await fetchReport(encounterId);
      if (report.error) return report;
      return { ok: true, base64: bufferToBase64(report.buffer) };
    };
    return Object.freeze({ read });
  };
  root.HhrGestionCamasStatisticalEvidenceRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);

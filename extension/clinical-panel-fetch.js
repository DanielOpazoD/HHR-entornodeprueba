/**
 * Pure fetch orchestration for the live clinical panel. Shared by the MV3 background worker and
 * unit tests so partial-source failures and medication pagination remain fail-closed.
 */
(function (root, factory) {
  const api = factory();
  root.HhrClinicalPanelFetch = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  const errorMessage = reason => String((reason && reason.message) || reason || 'error desconocido');

  const fetchJsonWithTimeout = async ({ url, token, fetchImpl, timeoutMs = 15_000 }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: token, Accept: 'application/json' },
        credentials: 'omit',
        signal: controller.signal,
      });
      if (response.status === 204) return null;
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Tiempo de espera agotado consultando Ficha Médico.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const unwrapRequiredSources = sources => {
    const failed = sources.find(source => source.result.status === 'rejected');
    if (failed) throw new Error(`${failed.label}: ${errorMessage(failed.result.reason)}`);
    return sources.map(source => source.result.value);
  };

  const fetchMedicationPages = async ({ fetchPage, pageSize = 100, maxPages = 50 }) => {
    const medications = [];
    const pageSignatures = new Set();

    for (let page = 0; page < maxPages; page += 1) {
      const payload = await fetchPage(page, pageSize);
      const rows = Array.isArray(payload && payload.Medication) ? payload.Medication : [];
      if (rows.length === 0) return medications;

      const signature = rows.map(row => String((row && row.id) || '')).join('|');
      if (pageSignatures.has(signature)) {
        throw new Error('Ficha Médico repitió una página de medicamentos.');
      }
      pageSignatures.add(signature);
      medications.push(...rows);
      if (rows.length < pageSize) return medications;
    }

    throw new Error(`La consulta de medicamentos superó ${maxPages} páginas.`);
  };

  return { fetchJsonWithTimeout, fetchMedicationPages, unwrapRequiredSources };
});

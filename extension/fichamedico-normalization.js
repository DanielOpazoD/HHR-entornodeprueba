/**
 * Pure Ficha Medico normalization helpers shared by the MAIN-world reader and unit tests.
 * This file never performs network or storage operations.
 */
(function (root, factory) {
  const api = factory();
  root.HhrFichaMedicoNormalization = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  const text = value => (value == null ? '' : String(value).trim());

  const flag = value => {
    if (value === true || value === 1) return true;
    return ['true', '1', 's', 'si', 'sí'].includes(text(value).toLowerCase());
  };

  const isActiveDiagnosis = row =>
    Boolean(row) &&
    !flag(row.archived) &&
    !flag(row.deleted) &&
    text(row.status).toLowerCase() !== 'inactivo';

  /** Select the first active principal diagnosis exactly as ordered by Ficha Medico. */
  const selectPrincipalDiagnosis = (rows, header, listItem) => {
    const diagnoses = Array.isArray(rows) ? rows : [];
    const firstPrincipal = diagnoses.find(row => isActiveDiagnosis(row) && flag(row.isPrincipal));
    const fallbackHeader = header || {};
    const fallbackItem = listItem || {};

    const name = text(
      firstPrincipal &&
        (firstPrincipal.diagnosisName ||
          firstPrincipal.name ||
          firstPrincipal.description ||
          firstPrincipal.freeTextDiagnosis)
    );
    const headerName = text(fallbackHeader.principalDiagName);

    return {
      name: name || headerName || text(fallbackHeader.haoDiagName) || text(fallbackItem.diagnosisName),
      code: text(firstPrincipal && firstPrincipal.internalCode),
      source: firstPrincipal ? 'principal-entry' : headerName ? 'principal-header' : 'admission',
    };
  };

  return { selectPrincipalDiagnosis };
});

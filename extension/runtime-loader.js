/**
 * Verifies runtimes registered during the initial MV3 service-worker evaluation.
 * Chrome forbids importScripts() of new files after installation, so this module must never try
 * to load a dependency lazily from a message handler.
 */
(function (root) {
  'use strict';

  var requireGroup = function (name, ready) {
    if (!ready()) {
      throw new Error(
        'No se pudo inicializar el módulo ' + name + '. Recarga la extensión y vuelve a intentarlo.'
      );
    }
  };

  var ensurePdf = function () {
    requireGroup(
      'PDF',
      function () { return Boolean(root.HhrPrescriptionPdf && root.HhrPdfPrint); }
    );
  };

  var ensureSpreadsheet = function () {
    requireGroup(
      'XLS',
      function () { return Boolean(root.XLSX && root.RayenReportParser); }
    );
  };

  root.HhrExtensionRuntime = {
    ensurePdf: ensurePdf,
    ensureSpreadsheet: ensureSpreadsheet,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.HhrExtensionRuntime;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

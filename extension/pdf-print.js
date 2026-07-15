/**
 * Adds the standard PDF OpenAction /Print instruction before the document is opened in Chrome.
 * Chrome's PDF viewer honors this instruction by showing the browser print dialog.
 */
(function (root) {
  'use strict';

  var preparePdfForBrowserPrint = async function (buffer, PdfLibOverride) {
    var library = PdfLibOverride || root.PDFLib;
    if (!library || !library.PDFDocument || !library.PDFName) {
      throw new Error('pdf-lib no está disponible.');
    }
    var document = await library.PDFDocument.load(buffer);
    var action = document.context.obj({
      S: library.PDFName.of('Named'),
      N: library.PDFName.of('Print'),
    });
    document.catalog.set(library.PDFName.of('OpenAction'), action);
    var bytes = await document.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };

  var mergePdfBuffers = async function (buffers, PdfLibOverride, limitsOverride) {
    var library = PdfLibOverride || root.PDFLib;
    if (!library || !library.PDFDocument) throw new Error('pdf-lib no está disponible.');
    var sources = Array.isArray(buffers) ? buffers.filter(Boolean) : [];
    if (!sources.length) throw new Error('No hay documentos para unir.');
    var limits = limitsOverride || {};
    var maxInputBytes = Number(limits.maxInputBytes) > 0
      ? Number(limits.maxInputBytes)
      : 24 * 1024 * 1024;
    var maxPages = Number(limits.maxPages) > 0 ? Number(limits.maxPages) : 300;
    var inputBytes = sources.reduce(function (total, source) {
      return total + Number(source && source.byteLength || 0);
    }, 0);
    if (inputBytes > maxInputBytes) {
      throw new Error('El lote supera el tamaño seguro de memoria. Selecciona menos pacientes.');
    }
    var document = await library.PDFDocument.create();
    var pageCount = 0;
    for (var i = 0; i < sources.length; i += 1) {
      var source = await library.PDFDocument.load(sources[i]);
      var pageIndices = source.getPageIndices();
      pageCount += pageIndices.length;
      if (pageCount > maxPages) {
        throw new Error('El lote supera el máximo seguro de ' + maxPages + ' páginas. Selecciona menos pacientes.');
      }
      var pages = await document.copyPages(source, pageIndices);
      pages.forEach(function (page) { document.addPage(page); });
    }
    var bytes = await document.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };

  var api = { preparePdfForBrowserPrint: preparePdfForBrowserPrint, mergePdfBuffers: mergePdfBuffers };
  root.HhrPdfPrint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

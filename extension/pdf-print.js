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

  var mergePdfBuffers = async function (buffers, PdfLibOverride) {
    var library = PdfLibOverride || root.PDFLib;
    if (!library || !library.PDFDocument) throw new Error('pdf-lib no está disponible.');
    var sources = Array.isArray(buffers) ? buffers.filter(Boolean) : [];
    if (!sources.length) throw new Error('No hay documentos para unir.');
    var document = await library.PDFDocument.create();
    for (var i = 0; i < sources.length; i += 1) {
      var source = await library.PDFDocument.load(sources[i]);
      var pages = await document.copyPages(source, source.getPageIndices());
      pages.forEach(function (page) { document.addPage(page); });
    }
    var bytes = await document.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };

  var api = { preparePdfForBrowserPrint: preparePdfForBrowserPrint, mergePdfBuffers: mergePdfBuffers };
  root.HhrPdfPrint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

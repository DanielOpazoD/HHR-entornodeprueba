/**
 * Moves the discharge prescription out of the last epicrisis page and onto its own page.
 * The official Jasper PDF remains the source of truth: its patient header and medication rows
 * are read from its own layout coordinates, while only the page title and pagination are redrawn.
 */
(function (root) {
  'use strict';

  var correctedTitle = 'Receta de Alta';

  var drawCenteredTitle = function (page, font, titleItem, title, library) {
    if (!titleItem) return;
    var size = 22;
    var width = page.getWidth();
    page.drawRectangle({ x: 135, y: titleItem.y - 5, width: width - 270, height: 32, color: library.rgb(1, 1, 1) });
    var textWidth = font.widthOfTextAtSize(title, size);
    page.drawText(title, { x: (width - textWidth) / 2, y: titleItem.y - 1, size: size, font: font, color: library.rgb(0, 0, 0) });
  };

  var drawPagination = function (pages, font, library) {
    var total = pages.length;
    pages.forEach(function (page, index) {
      var label = 'Pág. ' + (index + 1) + '   de ' + total;
      page.drawRectangle({ x: page.getWidth() - 190, y: 0, width: 190, height: 58, color: library.rgb(1, 1, 1) });
      page.drawText(label, { x: page.getWidth() - 18 - font.widthOfTextAtSize(label, 8), y: 20, size: 8, font: font, color: library.rgb(0, 0, 0) });
    });
  };

  var drawLayoutItems = function (page, items, lines, font, library, yOffset) {
    var shift = Number(yOffset || 0);
    (Array.isArray(lines) ? lines : []).forEach(function (line) {
      page.drawLine({
        start: { x: line.x0, y: line.y + shift },
        end: { x: line.x1, y: line.y + shift },
        thickness: 0.65,
        color: library.rgb(0, 0, 0),
      });
    });
    (Array.isArray(items) ? items : []).forEach(function (item) {
      var text = String(item && item.text || '');
      if (!text || /^Epicrisis$/i.test(text.trim())) return;
      page.drawText(text, {
        x: Number(item.x || 0),
        y: Number(item.y || 0) + shift,
        size: 10,
        font: font,
        color: library.rgb(0, 0, 0),
      });
    });
  };

  var boundsForLayout = function (items, lines) {
    var ys = [];
    (Array.isArray(items) ? items : []).forEach(function (item) { ys.push(Number(item.y)); });
    (Array.isArray(lines) ? lines : []).forEach(function (line) { ys.push(Number(line.y)); });
    var valid = ys.filter(Number.isFinite);
    return valid.length ? { top: Math.max.apply(null, valid), bottom: Math.min.apply(null, valid) } : null;
  };

  var correctEpicrisisPrescriptionPages = async function (buffer, helper, pdfLibrary) {
    if (!helper || typeof helper.extractOfficialEpicrisisLayout !== 'function') {
      throw new Error('No está disponible el analizador del alta médica.');
    }
    var layout = await helper.extractOfficialEpicrisisLayout(buffer);
    if (!layout) throw new Error('No se encontró una receta de alta separable en el PDF oficial.');
    var library = pdfLibrary || root.PDFLib;
    if (!library || !library.PDFDocument) throw new Error('pdf-lib no está disponible.');
    var sourceBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var sourcePdf = await library.PDFDocument.load(sourceBytes);
    var pdf = await library.PDFDocument.create();
    var skippedUntil = layout.control ? layout.control.pageIndex : layout.recipePageIndex;
    var keptIndexes = sourcePdf.getPageIndices().filter(function (index) {
      return index <= layout.recipePageIndex || index > skippedUntil;
    });
    var copiedPages = await pdf.copyPages(sourcePdf, keptIndexes);
    copiedPages.forEach(function (page) { pdf.addPage(page); });
    var sourcePage = sourcePdf.getPage(layout.recipePageIndex);
    var targetEpicrisisPage = pdf.getPage(layout.recipePageIndex);
    var size = sourcePage.getSize();
    var recipeTop = Math.min(size.height, layout.recipeTitleY + 3);
    if (recipeTop <= 48 || layout.headerBottomY <= recipeTop) {
      throw new Error('La geometría de la receta de alta no es válida.');
    }

    // Remove the recipe from the epicrisis page. Its new page is inserted immediately after it.
    targetEpicrisisPage.drawRectangle({
      x: 0,
      y: 0,
      width: size.width,
      height: Math.max(0, layout.recipeTitleY - 7),
      color: library.rgb(1, 1, 1),
    });
    // The last discharge indication can sit only a few points above the recipe title. Erase
    // the title itself separately instead of extending the full-width mask into that text.
    targetEpicrisisPage.drawRectangle({
      x: 0,
      y: layout.recipeTitleY - 9,
      width: 230,
      height: 28,
      color: library.rgb(1, 1, 1),
    });
    var font = await pdf.embedFont(library.StandardFonts.Helvetica);
    var insertionIndex = layout.recipePageIndex + 1;
    if (layout.control) {
      var controlPage = pdf.insertPage(insertionIndex, [size.width, size.height]);
      drawLayoutItems(controlPage, layout.control.headerItems, [], font, library, 0);
      drawCenteredTitle(controlPage, font, layout.titleItems[layout.recipePageIndex], 'Epicrisis', library);
      var controlBounds = boundsForLayout(layout.control.items, layout.control.lines);
      if (controlBounds) {
        drawLayoutItems(
          controlPage,
          layout.control.items,
          layout.control.lines,
          font,
          library,
          layout.headerBottomY - 30 - controlBounds.top
        );
      }
      insertionIndex += 1;
    }
    var recipePage = pdf.insertPage(insertionIndex, [size.width, size.height]);
    drawLayoutItems(recipePage, layout.headerItems, [], font, library, 0);
    var contentTop = layout.headerBottomY - 22;
    var currentBottom = contentTop;
    (Array.isArray(layout.recipeParts) ? layout.recipeParts : []).forEach(function (part, index) {
      var partBounds = boundsForLayout(part && part.items, part && part.lines);
      if (!partBounds) return;
      var offset = index === 0
        ? contentTop - partBounds.top
        : currentBottom - 10 - partBounds.top;
      drawLayoutItems(recipePage, part.items, part.lines, font, library, offset);
      currentBottom = partBounds.bottom + offset;
    });
    drawCenteredTitle(recipePage, font, layout.titleItems[layout.recipePageIndex], correctedTitle, library);
    drawPagination(pdf.getPages(), font, library);
    return pdf.save();
  };

  var api = { correctEpicrisisPrescriptionPages: correctEpicrisisPrescriptionPages };
  root.HhrEpicrisisPdf = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);

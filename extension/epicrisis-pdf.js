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
    var size = 18;
    var width = page.getWidth();
    page.drawRectangle({ x: 135, y: titleItem.y - 5, width: width - 270, height: 32, color: library.rgb(1, 1, 1) });
    var textWidth = font.widthOfTextAtSize(title, size);
    page.drawText(title, { x: (width - textWidth) / 2, y: titleItem.y - 1, size: size, font: font, color: library.rgb(0, 0, 0) });
  };

  var drawPagination = function (pages, font, library) {
    var total = pages.length;
    pages.forEach(function (page, index) {
      var label = 'Pág. ' + (index + 1) + '   de ' + total;
      // Jasper can place the last clinical line only a few points above its footer. Clear only
      // the original page-number area; a wide mask would erase the end of that clinical line.
      page.drawRectangle({
        x: page.getWidth() - 100,
        y: 32,
        width: 100,
        height: 22,
        color: library.rgb(1, 1, 1),
      });
      page.drawText(label, { x: page.getWidth() - 18 - font.widthOfTextAtSize(label, 8), y: 20, size: 8, font: font, color: library.rgb(0, 0, 0) });
    });
  };

  var drawLayoutItems = function (page, items, lines, font, library, yOffset, options) {
    var shift = Number(yOffset || 0);
    var defaultFontSize = Number(options && options.fontSize) || 10;
    var fontSizeForItem = options && options.fontSizeForItem;
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
      if (!text || /^(?:Epicrisis|Receta de Alta)$/i.test(text.trim())) return;
      var itemFontSize = typeof fontSizeForItem === 'function'
        ? Number(fontSizeForItem(item, text)) || defaultFontSize
        : defaultFontSize;
      page.drawText(text, {
        x: Number(item.x || 0),
        y: Number(item.y || 0) + shift,
        size: itemFontSize,
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

  var splitLayoutPart = function (part, maximumHeight) {
    var bounds = boundsForLayout(part && part.items, part && part.lines);
    if (!bounds || bounds.top - bounds.bottom <= maximumHeight) return part ? [part] : [];
    var chunks = [];
    var bandTop = bounds.top;
    while (bandTop > bounds.bottom) {
      var bandBottom = Math.max(bounds.bottom, bandTop - maximumHeight);
      var isLast = bandBottom === bounds.bottom;
      var inBand = function (value) {
        var y = Number(value && value.y);
        return Number.isFinite(y) && y <= bandTop && (isLast ? y >= bandBottom : y > bandBottom);
      };
      var chunk = {
        items: (Array.isArray(part.items) ? part.items : []).filter(inBand),
        lines: (Array.isArray(part.lines) ? part.lines : []).filter(inBand),
      };
      if (chunk.items.length || chunk.lines.length) chunks.push(chunk);
      bandTop = bandBottom;
    }
    return chunks;
  };

  var normalizedRun = function (value) {
    return String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
  };

  var isValidNormalizedRun = function (value) {
    return /^[0-9]{6,8}[0-9K]$/.test(String(value || ''));
  };

  var headerRun = function (items) {
    var safeItems = Array.isArray(items) ? items : [];
    var label = safeItems.find(function (item) {
      return /^RUN\s*:?/i.test(String(item && item.text || '').trim());
    });
    if (!label) return '';
    var inlineMatch = String(label.text || '').trim().match(/^RUN\s*:?\s*([0-9.]+-[0-9K])$/i);
    if (inlineMatch) return normalizedRun(inlineMatch[1]);
    var candidate = safeItems
      .filter(function (item) {
        return item !== label && Number(item.x) > Number(label.x) &&
          Math.abs(Number(item.y) - Number(label.y)) <= 2;
      })
      .sort(function (left, right) { return Number(left.x) - Number(right.x); })
      .map(function (item) { return normalizedRun(item.text); })
      .find(isValidNormalizedRun);
    return candidate || '';
  };

  var correctEpicrisisPrescriptionPages = async function (buffer, helper, pdfLibrary, options) {
    if (!helper || typeof helper.extractOfficialEpicrisisLayout !== 'function') {
      throw new Error('No está disponible el analizador del alta médica.');
    }
    var layout = await helper.extractOfficialEpicrisisLayout(buffer);
    if (!layout) throw new Error('No se encontró una receta de alta separable en el PDF oficial.');
    var expectedPatientRun = normalizedRun(options && options.expectedPatientRun);
    if (!isValidNormalizedRun(expectedPatientRun)) {
      throw new Error('El RUN del paciente seleccionado no es válido.');
    }
    var headerPatientRun = headerRun(layout.headerItems);
    if (headerPatientRun !== expectedPatientRun) {
      throw new Error('El PDF generado por Eloísa no corresponde al paciente seleccionado.');
    }
    var library = pdfLibrary || root.PDFLib;
    if (!library || !library.PDFDocument) throw new Error('pdf-lib no está disponible.');
    var sourceBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var sourcePdf = await library.PDFDocument.load(sourceBytes);
    var pdf = await library.PDFDocument.create();
    var skippedUntil = layout.control
      ? layout.control.pageIndex
      : Math.max(layout.recipePageIndex, Number(layout.recipeEndPageIndex || layout.recipePageIndex));
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
      y: layout.recipeTitleY - 5,
      width: 150,
      height: 18,
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
    var contentTop = layout.headerBottomY - 22;
    var minimumBottom = 62;
    if (contentTop <= minimumBottom) throw new Error('La receta de alta no tiene espacio imprimible.');
    var recipePage = null;
    var currentBottom = contentTop;
    var addRecipePage = function () {
      recipePage = pdf.insertPage(insertionIndex, [size.width, size.height]);
      insertionIndex += 1;
      drawLayoutItems(recipePage, layout.headerItems, [], font, library, 0);
      drawCenteredTitle(
        recipePage,
        font,
        layout.titleItems[layout.recipePageIndex],
        correctedTitle,
        library
      );
      currentBottom = contentTop;
    };
    var printableParts = [];
    (Array.isArray(layout.recipeParts) ? layout.recipeParts : []).forEach(function (part) {
      printableParts = printableParts.concat(splitLayoutPart(part, contentTop - minimumBottom));
    });
    printableParts.forEach(function (part) {
      var partBounds = boundsForLayout(part && part.items, part && part.lines);
      if (!partBounds) return;
      var partHeight = Math.max(0, partBounds.top - partBounds.bottom);
      var gap = recipePage ? 10 : 0;
      if (!recipePage || currentBottom - gap - partHeight < minimumBottom) addRecipePage();
      var offset = currentBottom - (recipePage && currentBottom !== contentTop ? 10 : 0) - partBounds.top;
      drawLayoutItems(recipePage, part.items, part.lines, font, library, offset, {
        fontSize: 8,
        fontSizeForItem: function (_item, text) {
          return /^\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}$/.test(text.trim()) ? 6.3 : 8;
        },
      });
      currentBottom = partBounds.bottom + offset;
    });
    if (!recipePage) throw new Error('La receta de alta no contiene información imprimible.');
    drawPagination(pdf.getPages(), font, library);
    return pdf.save();
  };

  var api = { correctEpicrisisPrescriptionPages: correctEpicrisisPrescriptionPages };
  root.HhrEpicrisisPdf = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);

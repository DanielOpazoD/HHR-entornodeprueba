/**
 * prescription-pdf.js (UMD: service worker + Vitest)
 *
 * Renders a medication-only prescription. The caller supplies rows already attributed and
 * filtered by prescription-print.js. A folio is shown only for the compact complete option,
 * using the value extracted from Eloisa's official PDF.
 */
(function (root) {
  'use strict';

  var text = function (value, fallback) {
    var normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return normalized || (fallback || '');
  };

  var dateLabel = function (value) {
    var normalized = String(value || '');
    var display = normalized.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (display) return display[1] + '-' + display[2] + '-' + display[3];
    var match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[3] + '-' + match[2] + '-' + match[1] : '';
  };

  var dateTimeLabel = function (value) {
    var normalized = text(value);
    var displayMatch = normalized.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2})/);
    if (displayMatch) return displayMatch[1] + '-' + displayMatch[2] + '-' + displayMatch[3] + ' ' + displayMatch[4];
    var isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (isoMatch && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
      var instant = new Date(normalized);
      if (!Number.isNaN(instant.getTime())) {
        var parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Pacific/Easter',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(instant);
        var part = function (type) {
          var found = parts.find(function (item) { return item.type === type; });
          return found ? found.value : '';
        };
        return part('day') + '-' + part('month') + '-' + part('year') +
          ' ' + part('hour') + ':' + part('minute');
      }
    }
    return isoMatch
      ? isoMatch[3] + '-' + isoMatch[2] + '-' + isoMatch[1] + ' ' + isoMatch[4] + ':' + isoMatch[5]
      : dateLabel(normalized);
  };

  var createPrescriptionLayout = function (data, medications, doc) {
    var isCompact = data && data.printFormat === 'compact';
    var officialEquivalent = Boolean(data && data.officialEquivalent);
    var isLongCompact = isCompact && medications.length > 16;
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var margin = isLongCompact ? 22 : isCompact ? 26 : 36;
    var contentWidth = pageWidth - margin * 2;
    var tableLeftWidth = Math.round(contentWidth * (officialEquivalent ? 0.51 : 0.54));
    var dispatchWidth = officialEquivalent ? Math.round(contentWidth * 0.2) : 0;
    return {
      data: data,
      patient: (data && data.patient) || {},
      medications: medications,
      professional: text(data && data.professional, 'Profesional no informado'),
      doc: doc,
      isCompact: isCompact,
      officialEquivalent: officialEquivalent,
      isExternalPrescription: Boolean(data && data.isExternalPrescription),
      isLongCompact: isLongCompact,
      compactRowsPerPage: 22,
      pageWidth: pageWidth,
      pageHeight: pageHeight,
      margin: margin,
      contentWidth: contentWidth,
      tableLeftWidth: tableLeftWidth,
      dispatchWidth: dispatchWidth,
      tableRightWidth: contentWidth - tableLeftWidth - dispatchWidth,
      pageBottom: pageHeight - (isLongCompact ? 38 : isCompact ? 52 : 74),
      headerFontSize: isLongCompact ? 6.8 : isCompact ? 7.2 : 8.5,
      headerLineHeight: isLongCompact ? 8.5 : isCompact ? 10 : 13,
      titleFontSize: isLongCompact ? 13 : isCompact ? 14 : 17,
      titleGap: isLongCompact ? 15 : isCompact ? 18 : 25,
      patientFontSize: isLongCompact ? 7.2 : isCompact ? 8 : 9.5,
      patientLineHeight: isLongCompact ? 10 : isCompact ? 12 : 15,
      tableHeaderHeight: isLongCompact ? 16 : isCompact ? 18 : 24,
      tableFontSize: isLongCompact ? 6.8 : isCompact ? 7.2 : 8.5,
      tableLineHeight: isLongCompact ? 7.5 : isCompact ? 8 : 11,
      tablePadding: isLongCompact ? 3.5 : isCompact ? 5 : 7,
      rowTop: isLongCompact ? 7.8 : isCompact ? 9 : 13,
      minimumRowHeight: isLongCompact ? 20 : isCompact ? 25 : 38,
      y: margin,
    };
  };

  var drawPrescriptionPatientHeader = function (layout, continuation) {
    var doc = layout.doc;
    var data = layout.data;
    var patient = layout.patient;
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(layout.headerFontSize);
    doc.text('Servicio de salud', layout.margin, layout.y);
    doc.text('Servicio de Salud Metropolitano Oriente', layout.margin + 88, layout.y);
    if (!continuation) {
      doc.text('Fecha emisión', layout.pageWidth - layout.margin - 190, layout.y);
      doc.text(text(data && data.emissionDateTime, '-'), layout.pageWidth - layout.margin, layout.y, { align: 'right' });
    }
    layout.y += layout.headerLineHeight;
    doc.text('Establecimiento', layout.margin, layout.y);
    doc.text('Hospital Hanga Roa (Isla de Pascua)', layout.margin + 88, layout.y);
    if (layout.officialEquivalent) {
      layout.y += layout.headerLineHeight;
      doc.text('Dirección', layout.margin, layout.y);
      doc.text(text(data && data.address, ''), layout.margin + 88, layout.y);
    }
    layout.y += layout.isLongCompact ? 13 : layout.isCompact ? 17 : 25;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(layout.titleFontSize);
    doc.text(
      layout.isExternalPrescription ? 'Receta médica externa' : 'Receta médica',
      layout.pageWidth / 2,
      layout.y,
      { align: 'center' }
    );
    if (!continuation && layout.officialEquivalent && layout.isCompact && text(data && data.folio)) {
      doc.setFontSize(layout.isCompact ? 8 : 9.5);
      doc.text('Folio: ' + text(data.folio), layout.pageWidth - layout.margin, layout.y, { align: 'right' });
    }
    layout.y += layout.titleGap;

    doc.setFontSize(layout.patientFontSize);
    doc.setFont('helvetica', 'bold');
    doc.text(layout.officialEquivalent ? 'Nombres:' : 'Paciente:', layout.margin, layout.y);
    doc.setFont('helvetica', 'normal');
    doc.text(text(patient.name, '-'), layout.margin + 52, layout.y);
    layout.y += layout.patientLineHeight;

    doc.setFont('helvetica', 'bold');
    doc.text('RUN:', layout.margin, layout.y);
    doc.setFont('helvetica', 'normal');
    doc.text(text(patient.run, '-'), layout.margin + 31, layout.y);
    doc.setFont('helvetica', 'bold');
    doc.text('Sexo:', layout.margin + 190, layout.y);
    doc.setFont('helvetica', 'normal');
    doc.text(text(patient.sex, '-'), layout.margin + 224, layout.y);
    doc.setFont('helvetica', 'bold');
    doc.text('Edad:', layout.margin + 340, layout.y);
    doc.setFont('helvetica', 'normal');
    doc.text(text(patient.age, '-'), layout.margin + 374, layout.y);
    layout.y += layout.patientLineHeight;

    doc.setFont('helvetica', 'bold');
    doc.text('Cama:', layout.margin, layout.y);
    doc.setFont('helvetica', 'normal');
    doc.text(text(patient.bed, '-'), layout.margin + 36, layout.y);
    doc.setFont('helvetica', 'bold');
    doc.text('Sala:', layout.margin + 130, layout.y);
    doc.setFont('helvetica', 'normal');
    doc.text(text(patient.room, '-'), layout.margin + 162, layout.y);
    doc.setFont('helvetica', 'bold');
    doc.text('Servicio:', layout.margin + 290, layout.y);
    doc.setFont('helvetica', 'normal');
    doc.text(text(patient.service, '-'), layout.margin + 338, layout.y, { maxWidth: layout.contentWidth - 338 });
    layout.y += layout.isCompact ? 14 : 20;

    if (!continuation) {
      doc.setFont('helvetica', 'bold');
      doc.text('Diagnóstico(s):', layout.margin, layout.y);
      doc.setFont('helvetica', 'normal');
      var diagnosisValue = text(patient.diagnosis, layout.officialEquivalent ? '' : '-');
      var diagnosisLines = diagnosisValue ? doc.splitTextToSize(diagnosisValue, layout.contentWidth - 80) : [];
      if (diagnosisLines.length) doc.text(diagnosisLines, layout.margin + 80, layout.y);
      layout.y += Math.max(
        layout.isLongCompact ? 11 : layout.isCompact ? 16 : 22,
        diagnosisLines.length * (layout.isLongCompact ? 7.5 : layout.isCompact ? 9 : 11) +
          (layout.isLongCompact ? 4 : layout.isCompact ? 5 : 8)
      );
    }
  };

  var drawPrescriptionTableHeader = function (layout) {
    var doc = layout.doc;
    doc.setFillColor(242, 242, 242);
    doc.setDrawColor(35, 35, 35);
    doc.rect(layout.margin, layout.y, layout.contentWidth, layout.tableHeaderHeight, 'FD');
    doc.line(
      layout.margin + layout.tableLeftWidth,
      layout.y,
      layout.margin + layout.tableLeftWidth,
      layout.y + layout.tableHeaderHeight
    );
    if (layout.officialEquivalent) {
      doc.line(
        layout.margin + layout.tableLeftWidth + layout.tableRightWidth,
        layout.y,
        layout.margin + layout.tableLeftWidth + layout.tableRightWidth,
        layout.y + layout.tableHeaderHeight
      );
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(layout.isLongCompact ? 6.8 : layout.isCompact ? 7.5 : 9);
    var baseline = layout.y + (layout.isLongCompact ? 11 : layout.isCompact ? 12 : 16);
    doc.text('Medicamento', layout.margin + layout.tableLeftWidth / 2, baseline, { align: 'center' });
    doc.text(
      'Posología e indicaciones',
      layout.margin + layout.tableLeftWidth + layout.tableRightWidth / 2,
      baseline,
      { align: 'center' }
    );
    if (layout.officialEquivalent) {
      doc.text(
        'Despacho Farmacia',
        layout.margin + layout.tableLeftWidth + layout.tableRightWidth + layout.dispatchWidth / 2,
        baseline,
        { align: 'center' }
      );
    }
    layout.y += layout.tableHeaderHeight;
  };

  var addPrescriptionContinuationPage = function (layout, includeTableHeader) {
    layout.doc.addPage();
    layout.y = layout.margin;
    drawPrescriptionPatientHeader(layout, true);
    if (includeTableHeader) drawPrescriptionTableHeader(layout);
  };

  var measurePrescriptionRow = function (layout, medication) {
    var medicationTitle = text(medication.medication, '-');
    if (text(medication.route)) medicationTitle += ', vía ' + text(medication.route).toLowerCase();
    var leftLines = layout.doc.splitTextToSize(
      medicationTitle,
      layout.tableLeftWidth - layout.tablePadding * 2
    );
    var indicationText = text(medication.posology, '-');
    if (text(medication.note)) indicationText += '\n' + text(medication.note);
    var rightLines = layout.doc.splitTextToSize(
      indicationText,
      layout.tableRightWidth - layout.tablePadding * 2
    );
    var normalizedDispatch = layout.officialEquivalent ? text(medication.dispatch) : '';
    var dispatchLines = normalizedDispatch
      ? layout.doc.splitTextToSize(normalizedDispatch, layout.dispatchWidth - layout.tablePadding * 2)
      : [];
    var medicationDate = dateTimeLabel(medication.dateTime || medication.date);
    return {
      leftLines: leftLines,
      rightLines: rightLines,
      dispatchLines: dispatchLines,
      medicationDate: medicationDate,
      height: Math.max(
        layout.minimumRowHeight,
        Math.max(
          leftLines.length + (medicationDate ? 1 : 0),
          rightLines.length,
          dispatchLines.length
        ) * layout.tableLineHeight + (layout.isLongCompact ? 5 : layout.isCompact ? 7 : 12)
      ),
    };
  };

  var drawPrescriptionRow = function (layout, row) {
    var doc = layout.doc;
    doc.setDrawColor(45, 45, 45);
    doc.rect(layout.margin, layout.y, layout.contentWidth, row.height);
    doc.line(
      layout.margin + layout.tableLeftWidth,
      layout.y,
      layout.margin + layout.tableLeftWidth,
      layout.y + row.height
    );
    if (layout.officialEquivalent) {
      doc.line(
        layout.margin + layout.tableLeftWidth + layout.tableRightWidth,
        layout.y,
        layout.margin + layout.tableLeftWidth + layout.tableRightWidth,
        layout.y + row.height
      );
    }
    doc.setFont('helvetica', 'normal');
    doc.text(row.leftLines, layout.margin + layout.tablePadding, layout.y + layout.rowTop);
    if (row.medicationDate) {
      doc.setFontSize(layout.isLongCompact ? 6 : layout.isCompact ? 6.3 : 7.5);
      doc.text(
        row.medicationDate,
        layout.margin + layout.tablePadding,
        layout.y + layout.rowTop + row.leftLines.length * layout.tableLineHeight
      );
      doc.setFontSize(layout.tableFontSize);
    }
    doc.text(row.rightLines, layout.margin + layout.tableLeftWidth + layout.tablePadding, layout.y + layout.rowTop);
    if (row.dispatchLines.length) {
      doc.text(
        row.dispatchLines,
        layout.margin + layout.tableLeftWidth + layout.tableRightWidth + layout.tablePadding,
        layout.y + layout.rowTop
      );
    }
    layout.y += row.height;
  };

  var drawPrescriptionSignature = function (layout) {
    var doc = layout.doc;
    var data = layout.data;
    if (layout.y + (layout.isLongCompact ? 48 : layout.isCompact ? 58 : 82) > layout.pageBottom) {
      addPrescriptionContinuationPage(layout, false);
    }
    layout.y += layout.isLongCompact ? 13 : layout.isCompact ? 18 : 28;
    doc.setFontSize(layout.isLongCompact ? 7 : layout.isCompact ? 8 : 9.5);
    doc.setFont('helvetica', 'bold');
    doc.text('Prescriptor:', layout.margin, layout.y);
    doc.setFont('helvetica', 'normal');
    doc.text(layout.professional, layout.margin + 62, layout.y);
    doc.setFont('helvetica', 'bold');
    doc.text(
      layout.officialEquivalent
        ? 'Fecha:'
        : data && data.dateSource === 'indication' ? 'Fecha indicación:' : 'Fecha validación:',
      layout.pageWidth - layout.margin - 170,
      layout.y
    );
    doc.setFont('helvetica', 'normal');
    doc.text(
      dateTimeLabel(data && (data.validationDateTime || data.validationDate)) || '-',
      layout.pageWidth - layout.margin,
      layout.y,
      { align: 'right' }
    );
    layout.y += layout.isLongCompact ? 10 : layout.isCompact ? 12 : 16;
    doc.setFont('helvetica', 'bold');
    doc.text('RUN:', layout.margin, layout.y);
    doc.setFont('helvetica', 'normal');
    doc.text(text(data && data.professionalRun, '-'), layout.margin + 31, layout.y);
    layout.y += layout.isLongCompact ? 17 : layout.isCompact ? 22 : 30;
    doc.setDrawColor(80, 80, 80);
    doc.line(layout.pageWidth - layout.margin - 150, layout.y, layout.pageWidth - layout.margin, layout.y);
    doc.setFontSize(layout.isLongCompact ? 6.5 : layout.isCompact ? 7 : 8);
    doc.text(
      'FIRMA',
      layout.pageWidth - layout.margin - 75,
      layout.y + (layout.isLongCompact ? 9 : layout.isCompact ? 10 : 12),
      { align: 'center' }
    );
  };

  var drawPrescriptionFooters = function (layout) {
    var doc = layout.doc;
    var pageCount = doc.getNumberOfPages();
    for (var page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(layout.isLongCompact ? 6.2 : layout.isCompact ? 6.5 : 7.5);
      doc.setTextColor(80, 80, 80);
      if (layout.officialEquivalent && text(layout.data && layout.data.printedBy)) {
        doc.text(
          'Impreso por ' + text(layout.data.printedBy),
          layout.margin,
          layout.pageHeight - (layout.isLongCompact ? 16 : layout.isCompact ? 20 : 28)
        );
      }
      doc.text(
        'Pagina ' + page + ' de ' + pageCount,
        layout.pageWidth - layout.margin,
        layout.pageHeight - (layout.isLongCompact ? 16 : layout.isCompact ? 20 : 28),
        { align: 'right' }
      );
    }
  };

  var generateProfessionalPrescriptionPdf = function (data, JsPdfOverride) {
    var JsPDF = JsPdfOverride || (root.jspdf && root.jspdf.jsPDF);
    if (!JsPDF) throw new Error('jsPDF no está disponible.');
    var medications = Array.isArray(data && data.medications) ? data.medications : [];
    if (medications.length === 0) throw new Error('No hay fármacos para este profesional.');

    var doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
    var layout = createPrescriptionLayout(data, medications, doc);
    drawPrescriptionPatientHeader(layout, false);
    drawPrescriptionTableHeader(layout);
    doc.setFontSize(layout.tableFontSize);
    var rowsOnPage = 0;

    for (var i = 0; i < medications.length; i += 1) {
      var row = measurePrescriptionRow(layout, medications[i] || {});
      if (
        (layout.isCompact && rowsOnPage >= layout.compactRowsPerPage) ||
        layout.y + row.height > layout.pageBottom
      ) {
        addPrescriptionContinuationPage(layout, true);
        rowsOnPage = 0;
      }
      if (layout.y + row.height > layout.pageBottom) {
        throw new Error('Una indicación es demasiado extensa para imprimirse sin pérdida de contenido.');
      }
      drawPrescriptionRow(layout, row);
      rowsOnPage += 1;
    }

    drawPrescriptionSignature(layout);
    drawPrescriptionFooters(layout);
    return doc.output('arraybuffer');
  };

  var generateBradenSummaryPdf = function (data, JsPdfOverride) {
    var JsPDF = JsPdfOverride || (root.jspdf && root.jspdf.jsPDF);
    if (!JsPDF) throw new Error('jsPDF no está disponible.');
    var patients = Array.isArray(data && data.patients) ? data.patients : [];
    if (patients.length === 0) throw new Error('No hay pacientes hospitalizados para resumir.');

    var doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var margin = 24;
    var contentWidth = pageWidth - margin * 2;
    var widths = [52, 178, 85, 55, 100, 95, contentWidth - 565];
    var headers = ['Cama', 'Paciente', 'RUN', 'Puntaje', 'Clasificación', 'Fecha / hora', 'Profesional'];
    var y = margin;
    var pageBottom = pageHeight - 30;

    var addPageHeader = function (continuation) {
      doc.setTextColor(25, 45, 43);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(continuation ? 12 : 15);
      doc.text(
        continuation ? 'Resumen BRADEN - continuación' : 'Regímenes hospitalizados - último BRADEN',
        margin,
        y
      );
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 90, 92);
      if (!continuation) {
        doc.text('Anexo al reporte oficial de Regímenes para servicios de Nutrición', margin, y + 13);
        doc.text('Establecimiento: Hospital Hanga Roa', margin, y + 26);
        doc.text('Emitido: ' + dateTimeLabel(data && data.generatedAt), pageWidth - margin, y + 26, { align: 'right' });
        y += 40;
      } else {
        y += 16;
      }
    };

    var addTableHeader = function () {
      var x = margin;
      doc.setFillColor(232, 244, 242);
      doc.setDrawColor(122, 151, 147);
      doc.rect(margin, y, contentWidth, 22, 'FD');
      doc.setTextColor(27, 75, 70);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.4);
      for (var i = 0; i < headers.length; i += 1) {
        if (i > 0) doc.line(x, y, x, y + 22);
        doc.text(headers[i], x + widths[i] / 2, y + 14, { align: 'center' });
        x += widths[i];
      }
      y += 22;
    };

    var addNewPage = function () {
      doc.addPage();
      y = margin;
      addPageHeader(true);
      addTableHeader();
    };

    addPageHeader(false);
    addTableHeader();
    for (var rowIndex = 0; rowIndex < patients.length; rowIndex += 1) {
      var patient = patients[rowIndex] || {};
      var braden = patient.braden || null;
      var cells = [
        text(patient.bed, '-'),
        text(patient.name, 'Paciente sin nombre'),
        text(patient.run, '-'),
        braden ? text(braden.total, '-') : 'Sin registro',
        braden ? text(braden.severity, '-') : '-',
        braden ? dateTimeLabel(braden.dateTime) || '-' : '-',
        braden ? text(braden.author, '-') : '-',
      ];
      var wrapped = cells.map(function (cell, index) {
        return doc.splitTextToSize(cell, widths[index] - 8);
      });
      var maxLines = wrapped.reduce(function (max, lines) { return Math.max(max, lines.length); }, 1);
      var rowHeight = Math.max(23, maxLines * 8 + 8);
      if (y + rowHeight > pageBottom) addNewPage();
      if (y + rowHeight > pageBottom) {
        throw new Error('Una fila de BRADEN es demasiado extensa para imprimirse sin pérdida de contenido.');
      }
      var x = margin;
      var alternate = rowIndex % 2 !== 0;
      doc.setFillColor(alternate ? 249 : 255, alternate ? 251 : 255, alternate ? 251 : 255);
      doc.setDrawColor(183, 194, 193);
      doc.rect(margin, y, contentWidth, rowHeight, 'FD');
      doc.setTextColor(40, 48, 50);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      for (var column = 0; column < wrapped.length; column += 1) {
        if (column > 0) doc.line(x, y, x, y + rowHeight);
        doc.text(wrapped[column], x + 4, y + 11);
        x += widths[column];
      }
      y += rowHeight;
    }

    var pageCount = doc.getNumberOfPages();
    for (var page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(90, 98, 100);
      doc.text(
        'BRADEN: último resultado disponible en Eloísa al momento de emitir este documento.',
        margin,
        pageHeight - 12
      );
      doc.text('Página ' + page + ' de ' + pageCount, pageWidth - margin, pageHeight - 12, { align: 'right' });
    }
    return doc.output('arraybuffer');
  };

  var generateIntegratedRegimenPdf = function (data, JsPdfOverride) {
    var JsPDF = JsPdfOverride || (root.jspdf && root.jspdf.jsPDF);
    if (!JsPDF) throw new Error('jsPDF no está disponible.');
    var patients = Array.isArray(data && data.patients) ? data.patients : [];
    if (patients.length === 0) throw new Error('No hay pacientes hospitalizados para imprimir.');

    var doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var margin = 18;
    var contentWidth = pageWidth - margin * 2;
    var widths = [102, 40, 156, 62, 150, 72, 46, 96, contentWidth - 726];
    var headers = [
      'SERVICIO', 'CAMA', 'PACIENTE / RUN', 'RÉGIMEN', 'OBSERVACIÓN',
      'FECHA RÉGIMEN', 'VALOR BRADEN', 'CLASIFICACIÓN', 'FECHA ESCALA BRADEN',
    ];
    var y = margin;
    var pageBottom = pageHeight - 30;

    var drawHeader = function (continuation) {
      doc.setTextColor(43, 55, 55);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.4);
      doc.text('Hospital Hanga Roa (Isla de Pascua)', margin, y + 7);
      doc.text(
        'Emitido: ' + (dateTimeLabel(data && data.generatedAt) || '-'),
        pageWidth - margin,
        y + 7,
        { align: 'right' }
      );
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(continuation ? 11 : 13);
      doc.text(
        continuation
          ? 'Regímenes para servicios de Nutrición · continuación'
          : 'Regímenes para servicios de Nutrición',
        pageWidth / 2,
        y + 24,
        { align: 'center' }
      );
      y += 34;
    };

    var drawTableHeader = function () {
      var groupHeight = 16;
      var headerHeight = 22;
      var patientWidth = widths[0] + widths[1] + widths[2];
      var regimenWidth = widths[3] + widths[4] + widths[5];
      var bradenWidth = widths[6] + widths[7] + widths[8];
      doc.setDrawColor(129, 154, 151);
      doc.setFillColor(229, 243, 241);
      doc.rect(margin, y, contentWidth, groupHeight, 'FD');
      doc.line(margin + patientWidth, y, margin + patientWidth, y + groupHeight);
      doc.line(margin + patientWidth + regimenWidth, y, margin + patientWidth + regimenWidth, y + groupHeight);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(23, 96, 89);
      doc.text('DATOS DEL PACIENTE', margin + patientWidth / 2, y + 11, { align: 'center' });
      doc.text('RÉGIMEN VIGENTE', margin + patientWidth + regimenWidth / 2, y + 11, { align: 'center' });
      doc.text('ÚLTIMO BRADEN', margin + patientWidth + regimenWidth + bradenWidth / 2, y + 11, { align: 'center' });
      y += groupHeight;

      doc.setFillColor(242, 247, 246);
      doc.rect(margin, y, contentWidth, headerHeight, 'FD');
      var x = margin;
      doc.setTextColor(42, 58, 56);
      doc.setFontSize(6.5);
      for (var i = 0; i < headers.length; i += 1) {
        if (i > 0) doc.line(x, y, x, y + headerHeight);
        var labelLines = doc.splitTextToSize(headers[i], widths[i] - 6);
        doc.text(labelLines, x + widths[i] / 2, y + 9, { align: 'center' });
        x += widths[i];
      }
      y += headerHeight;
    };

    var addPage = function () {
      doc.addPage();
      y = margin;
      drawHeader(true);
      drawTableHeader();
    };

    drawHeader(false);
    drawTableHeader();
    patients.forEach(function (patient, rowIndex) {
      var regimen = patient && patient.regimen;
      var braden = patient && patient.braden;
      var cells = [
        text(patient && patient.service, '-'),
        text(patient && (patient.bed || patient.room), '-'),
        text(patient && patient.name, 'Paciente sin nombre') + '\n' + text(patient && patient.run, '-'),
        regimen ? text(regimen.diet, '-') : 'Sin régimen vigente',
        regimen ? text(regimen.observation, '-') : '-',
        regimen ? dateTimeLabel(regimen.dateTime) || '-' : '-',
        braden ? text(braden.total, '-') : 'Sin registro',
        braden ? text(braden.severity, '-') : '-',
        braden ? dateTimeLabel(braden.dateTime) || '-' : '-',
      ];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      var wrapped = cells.map(function (cell, index) {
        return doc.splitTextToSize(cell, widths[index] - 7);
      });
      var maxLines = wrapped.reduce(function (max, lines) { return Math.max(max, lines.length); }, 1);
      var rowHeight = Math.max(24, maxLines * 8 + 8);
      if (y + rowHeight > pageBottom) addPage();
      if (y + rowHeight > pageBottom) {
        throw new Error('Una fila de régimen es demasiado extensa para imprimirse sin pérdida de contenido.');
      }

      doc.setFillColor(rowIndex % 2 ? 249 : 255, rowIndex % 2 ? 251 : 255, rowIndex % 2 ? 251 : 255);
      doc.setDrawColor(185, 197, 195);
      doc.rect(margin, y, contentWidth, rowHeight, 'FD');
      doc.setTextColor(42, 49, 50);
      var x = margin;
      for (var column = 0; column < wrapped.length; column += 1) {
        if (column > 0) doc.line(x, y, x, y + rowHeight);
        doc.text(wrapped[column], x + 3.5, y + 10);
        x += widths[column];
      }
      y += rowHeight;
    });

    var pageCount = doc.getNumberOfPages();
    for (var page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(82, 92, 93);
      doc.text(
        'Fuente: régimen vigente y último BRADEN disponibles en Eloísa al momento de emitir.',
        margin,
        pageHeight - 12
      );
      doc.text('Página ' + page + ' de ' + pageCount, pageWidth - margin, pageHeight - 12, { align: 'right' });
    }
    return doc.output('arraybuffer');
  };

  var api = {
    generateProfessionalPrescriptionPdf: generateProfessionalPrescriptionPdf,
    generateBradenSummaryPdf: generateBradenSummaryPdf,
    generateIntegratedRegimenPdf: generateIntegratedRegimenPdf,
  };
  root.HhrPrescriptionPdf = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

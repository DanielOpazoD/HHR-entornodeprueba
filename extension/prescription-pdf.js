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

  var generateProfessionalPrescriptionPdf = function (data, JsPdfOverride) {
    var JsPDF = JsPdfOverride || (root.jspdf && root.jspdf.jsPDF);
    if (!JsPDF) throw new Error('jsPDF no está disponible.');

    var patient = (data && data.patient) || {};
    var professional = text(data && data.professional, 'Profesional no informado');
    var medications = Array.isArray(data && data.medications) ? data.medications : [];
    if (medications.length === 0) throw new Error('No hay fármacos para este profesional.');
    var isCompact = data && data.printFormat === 'compact';
    var officialEquivalent = Boolean(data && data.officialEquivalent);
    var isExternalPrescription = Boolean(data && data.isExternalPrescription);
    var isLongCompact = isCompact && medications.length > 16;
    var compactRowsPerPage = 22;

    var doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var margin = isLongCompact ? 22 : isCompact ? 26 : 36;
    var contentWidth = pageWidth - margin * 2;
    var tableLeftWidth = Math.round(contentWidth * (officialEquivalent ? 0.51 : 0.54));
    var dispatchWidth = officialEquivalent ? Math.round(contentWidth * 0.2) : 0;
    var tableRightWidth = contentWidth - tableLeftWidth - dispatchWidth;
    var pageBottom = pageHeight - (isLongCompact ? 38 : isCompact ? 52 : 74);
    var headerFontSize = isLongCompact ? 6.8 : isCompact ? 7.2 : 8.5;
    var headerLineHeight = isLongCompact ? 8.5 : isCompact ? 10 : 13;
    var titleFontSize = isLongCompact ? 13 : isCompact ? 14 : 17;
    var titleGap = isLongCompact ? 15 : isCompact ? 18 : 25;
    var patientFontSize = isLongCompact ? 7.2 : isCompact ? 8 : 9.5;
    var patientLineHeight = isLongCompact ? 10 : isCompact ? 12 : 15;
    var tableHeaderHeight = isLongCompact ? 16 : isCompact ? 18 : 24;
    var tableFontSize = isLongCompact ? 6.8 : isCompact ? 7.2 : 8.5;
    var tableLineHeight = isLongCompact ? 7.5 : isCompact ? 8 : 11;
    var tablePadding = isLongCompact ? 3.5 : isCompact ? 5 : 7;
    var rowTop = isLongCompact ? 7.8 : isCompact ? 9 : 13;
    var minimumRowHeight = isLongCompact ? 20 : isCompact ? 25 : 38;
    var y = margin;

    var addPatientHeader = function (continuation) {
      doc.setTextColor(20, 20, 20);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(headerFontSize);
      doc.text('Servicio de salud', margin, y);
      doc.text('Servicio de Salud Metropolitano Oriente', margin + 88, y);
      if (!continuation) {
        doc.text('Fecha emisión', pageWidth - margin - 190, y);
        doc.text(text(data && data.emissionDateTime, '-'), pageWidth - margin, y, { align: 'right' });
      }
      y += headerLineHeight;
      doc.text('Establecimiento', margin, y);
      doc.text('Hospital Hanga Roa (Isla de Pascua)', margin + 88, y);
      if (officialEquivalent) {
        y += headerLineHeight;
        doc.text('Dirección', margin, y);
        doc.text(text(data && data.address, ''), margin + 88, y);
      }
      y += isLongCompact ? 13 : isCompact ? 17 : 25;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(titleFontSize);
      doc.text(isExternalPrescription ? 'Receta médica externa' : 'Receta médica', pageWidth / 2, y, { align: 'center' });
      if (!continuation && officialEquivalent && isCompact && text(data && data.folio)) {
        doc.setFontSize(isCompact ? 8 : 9.5);
        doc.text('Folio: ' + text(data.folio), pageWidth - margin, y, { align: 'right' });
      }
      y += titleGap;

      doc.setFontSize(patientFontSize);
      doc.setFont('helvetica', 'bold');
      doc.text(officialEquivalent ? 'Nombres:' : 'Paciente:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(text(patient.name, '-'), margin + 52, y);
      y += patientLineHeight;

      var run = text(patient.run, '-');
      var sex = text(patient.sex, '-');
      var age = text(patient.age, '-');
      doc.setFont('helvetica', 'bold');
      doc.text('RUN:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(run, margin + 31, y);
      doc.setFont('helvetica', 'bold');
      doc.text('Sexo:', margin + 190, y);
      doc.setFont('helvetica', 'normal');
      doc.text(sex, margin + 224, y);
      doc.setFont('helvetica', 'bold');
      doc.text('Edad:', margin + 340, y);
      doc.setFont('helvetica', 'normal');
      doc.text(age, margin + 374, y);
      y += patientLineHeight;

      doc.setFont('helvetica', 'bold');
      doc.text('Cama:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(text(patient.bed, '-'), margin + 36, y);
      doc.setFont('helvetica', 'bold');
      doc.text('Sala:', margin + 130, y);
      doc.setFont('helvetica', 'normal');
      doc.text(text(patient.room, '-'), margin + 162, y);
      doc.setFont('helvetica', 'bold');
      doc.text('Servicio:', margin + 290, y);
      doc.setFont('helvetica', 'normal');
      doc.text(text(patient.service, '-'), margin + 338, y, { maxWidth: contentWidth - 338 });
      y += isCompact ? 14 : 20;

      if (!continuation) {
        doc.setFont('helvetica', 'bold');
        doc.text('Diagnóstico(s):', margin, y);
        doc.setFont('helvetica', 'normal');
        var diagnosisValue = text(patient.diagnosis, officialEquivalent ? '' : '-');
        var diagnosisLines = diagnosisValue ? doc.splitTextToSize(diagnosisValue, contentWidth - 80) : [];
        if (diagnosisLines.length) doc.text(diagnosisLines, margin + 80, y);
        y += Math.max(
          isLongCompact ? 11 : isCompact ? 16 : 22,
          diagnosisLines.length * (isLongCompact ? 7.5 : isCompact ? 9 : 11) +
            (isLongCompact ? 4 : isCompact ? 5 : 8)
        );
      }
    };

    var addTableHeader = function () {
      doc.setFillColor(242, 242, 242);
      doc.setDrawColor(35, 35, 35);
      doc.rect(margin, y, contentWidth, tableHeaderHeight, 'FD');
      doc.line(margin + tableLeftWidth, y, margin + tableLeftWidth, y + tableHeaderHeight);
      if (officialEquivalent) {
        doc.line(
          margin + tableLeftWidth + tableRightWidth,
          y,
          margin + tableLeftWidth + tableRightWidth,
          y + tableHeaderHeight
        );
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(isLongCompact ? 6.8 : isCompact ? 7.5 : 9);
      var tableHeaderBaseline = y + (isLongCompact ? 11 : isCompact ? 12 : 16);
      doc.text('Medicamento', margin + tableLeftWidth / 2, tableHeaderBaseline, { align: 'center' });
      doc.text('Posología e indicaciones', margin + tableLeftWidth + tableRightWidth / 2, tableHeaderBaseline, {
        align: 'center',
      });
      if (officialEquivalent) {
        doc.text(
          'Despacho Farmacia',
          margin + tableLeftWidth + tableRightWidth + dispatchWidth / 2,
          tableHeaderBaseline,
          { align: 'center' }
        );
      }
      y += tableHeaderHeight;
    };

    var addContinuationPage = function () {
      doc.addPage();
      y = margin;
      addPatientHeader(true);
      addTableHeader();
    };

    addPatientHeader(false);
    addTableHeader();
    doc.setFontSize(tableFontSize);
    var rowsOnPage = 0;

    for (var i = 0; i < medications.length; i += 1) {
      var medication = medications[i] || {};
      var medicationTitle = text(medication.medication, '-');
      if (text(medication.route)) medicationTitle += ', vía ' + text(medication.route).toLowerCase();
      var leftLines = doc.splitTextToSize(medicationTitle, tableLeftWidth - tablePadding * 2);
      var indicationText = text(medication.posology, '-');
      if (text(medication.note)) indicationText += '\n' + text(medication.note);
      var rightLines = doc.splitTextToSize(indicationText, tableRightWidth - tablePadding * 2);
      var dispatchText = officialEquivalent ? text(medication.dispatch) : '';
      var dispatchLines = dispatchText
        ? doc.splitTextToSize(dispatchText, dispatchWidth - tablePadding * 2)
        : [];
      var medicationDate = dateTimeLabel(medication.dateTime || medication.date);
      var leftLineCount = leftLines.length + (medicationDate ? 1 : 0);
      var rowHeight = Math.max(
        minimumRowHeight,
        Math.max(leftLineCount, rightLines.length, dispatchLines.length) * tableLineHeight +
          (isLongCompact ? 5 : isCompact ? 7 : 12)
      );
      if ((isCompact && rowsOnPage >= compactRowsPerPage) || y + rowHeight > pageBottom) {
        addContinuationPage();
        rowsOnPage = 0;
      }
      if (y + rowHeight > pageBottom) {
        throw new Error('Una indicación es demasiado extensa para imprimirse sin pérdida de contenido.');
      }

      doc.setDrawColor(45, 45, 45);
      doc.rect(margin, y, contentWidth, rowHeight);
      doc.line(margin + tableLeftWidth, y, margin + tableLeftWidth, y + rowHeight);
      if (officialEquivalent) {
        doc.line(
          margin + tableLeftWidth + tableRightWidth,
          y,
          margin + tableLeftWidth + tableRightWidth,
          y + rowHeight
        );
      }
      doc.setFont('helvetica', 'normal');
      doc.text(leftLines, margin + tablePadding, y + rowTop);
      if (medicationDate) {
        doc.setFontSize(isLongCompact ? 6 : isCompact ? 6.3 : 7.5);
        doc.text(medicationDate, margin + tablePadding, y + rowTop + leftLines.length * tableLineHeight);
        doc.setFontSize(tableFontSize);
      }
      doc.text(rightLines, margin + tableLeftWidth + tablePadding, y + rowTop);
      if (dispatchLines.length) {
        doc.text(
          dispatchLines,
          margin + tableLeftWidth + tableRightWidth + tablePadding,
          y + rowTop
        );
      }
      y += rowHeight;
      rowsOnPage += 1;
    }

    if (y + (isLongCompact ? 48 : isCompact ? 58 : 82) > pageBottom) {
      doc.addPage();
      y = margin;
      addPatientHeader(true);
    }
    y += isLongCompact ? 13 : isCompact ? 18 : 28;
    doc.setFontSize(isLongCompact ? 7 : isCompact ? 8 : 9.5);
    doc.setFont('helvetica', 'bold');
    doc.text('Prescriptor:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(professional, margin + 62, y);
    doc.setFont('helvetica', 'bold');
    doc.text(
      officialEquivalent
        ? 'Fecha:'
        : data && data.dateSource === 'indication' ? 'Fecha indicación:' : 'Fecha validación:',
      pageWidth - margin - 170,
      y
    );
    doc.setFont('helvetica', 'normal');
    doc.text(dateTimeLabel(data && (data.validationDateTime || data.validationDate)) || '-', pageWidth - margin, y, {
      align: 'right',
    });
    y += isLongCompact ? 10 : isCompact ? 12 : 16;
    doc.setFont('helvetica', 'bold');
    doc.text('RUN:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(text(data && data.professionalRun, '-'), margin + 31, y);
    y += isLongCompact ? 17 : isCompact ? 22 : 30;
    doc.setDrawColor(80, 80, 80);
    doc.line(pageWidth - margin - 150, y, pageWidth - margin, y);
    doc.setFontSize(isLongCompact ? 6.5 : isCompact ? 7 : 8);
    doc.text('FIRMA', pageWidth - margin - 75, y + (isLongCompact ? 9 : isCompact ? 10 : 12), { align: 'center' });

    var pageCount = doc.getNumberOfPages();
    for (var page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(isLongCompact ? 6.2 : isCompact ? 6.5 : 7.5);
      doc.setTextColor(80, 80, 80);
      if (officialEquivalent && text(data && data.printedBy)) {
        doc.text('Impreso por ' + text(data.printedBy), margin, pageHeight - (isLongCompact ? 16 : isCompact ? 20 : 28));
      }
      doc.text('Pagina ' + page + ' de ' + pageCount, pageWidth - margin, pageHeight - (isLongCompact ? 16 : isCompact ? 20 : 28), {
        align: 'right',
      });
    }

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

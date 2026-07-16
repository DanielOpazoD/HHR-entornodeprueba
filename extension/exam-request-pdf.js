/**
 * Generates one semantic laboratory request from 2-3 fully extracted official Eloisa reports.
 * Repeated patient, institution and professional fields are rendered once; every source folio,
 * test code and clinical difference remains traceable in the integrated document.
 */
(function (root) {
  'use strict';

  var clean = function (value, fallback) {
    var normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return normalized || (fallback || '');
  };

  var identity = function (value) {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  };

  var sameValue = function (requests, getter) {
    var values = requests.map(getter);
    var first = identity(values[0]);
    return values.every(function (value) { return identity(value) === first; }) ? clean(values[0]) : '';
  };

  var validateRequests = function (requests) {
    if (!Array.isArray(requests) || requests.length < 2 || requests.length > 3) {
      throw new Error('Se requieren entre 2 y 3 solicitudes oficiales.');
    }
    var first = requests[0];
    var patientRun = identity(first && first.patient && first.patient.run);
    var patientName = identity(first && first.patient && first.patient.name);
    var establishment = identity(first && first.establishment);
    var healthService = identity(first && first.healthService);
    var demographicFields = ['birthDate', 'sex', 'insurance', 'age'];
    if (!patientRun || !patientName || !establishment || !healthService ||
        demographicFields.some(function (field) {
          return !identity(first && first.patient && first.patient[field]);
        })) {
      throw new Error('La primera solicitud no contiene identificación clínica completa.');
    }
    requests.forEach(function (request) {
      if (!request || !request.folio || !request.orderId || !request.requestDate ||
          !request.requiredDate || !request.tests || !request.tests.length ||
          identity(request.patient && request.patient.run) !== patientRun ||
          identity(request.patient && request.patient.name) !== patientName ||
          identity(request.establishment) !== establishment ||
          identity(request.healthService) !== healthService ||
          demographicFields.some(function (field) {
            return identity(request.patient && request.patient[field]) !==
              identity(first.patient[field]);
          })) {
        throw new Error(
          'Las solicitudes no comparten la misma identificación demográfica y establecimiento.'
        );
      }
    });
  };

  var generateIntegratedExamRequestPdf = function (data, JsPdfOverride) {
    var JsPDF = JsPdfOverride || (root.jspdf && root.jspdf.jsPDF);
    if (!JsPDF) throw new Error('jsPDF no está disponible.');
    var requests = Array.isArray(data && data.requests) ? data.requests : [];
    validateRequests(requests);

    var patient = requests[0].patient;
    var healthService = requests[0].healthService;
    var establishment = requests[0].establishment;
    var commonDiagnosis = sameValue(requests, function (request) { return request.clinical.diagnosis; });
    var commonGes = sameValue(requests, function (request) { return request.clinical.ges; });
    var commonProblem = sameValue(requests, function (request) { return request.clinical.healthProblem; });
    var commonObservations = sameValue(requests, function (request) { return request.clinical.observations; });
    var professionalKeys = requests.map(function (request) {
      return identity(request.professional.run) || identity(request.professional.name);
    });
    var hasDifferentProfessionals = new Set(professionalKeys).size > 1;
    var doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var margin = 25;
    var contentWidth = pageWidth - margin * 2;
    var footerTop = pageHeight - 27;
    var black = [0, 0, 0];
    var white = [255, 255, 255];
    var dark = black;
    var muted = black;
    var pale = white;
    var line = black;
    var y = margin;

    var setText = function (color) {
      doc.setTextColor(color[0], color[1], color[2]);
    };

    var addFullHeader = function () {
      setText(muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.text('MINISTERIO DE SALUD - ' + clean(healthService), margin, y);
      doc.setFont('helvetica', 'normal');
      y += 11;
      doc.text(clean(establishment), margin, y);
      y += 22;
      setText(dark);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text('SOLICITUD DE EXÁMENES', pageWidth / 2, y, { align: 'center' });
      y += 10;
      doc.setDrawColor(black[0], black[1], black[2]);
      doc.setLineWidth(1.4);
      doc.line(margin, y, pageWidth - margin, y);
      y += 12;
    };

    var addContinuationHeader = function () {
      setText(dark);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('SOLICITUD DE EXÁMENES - CONTINUACIÓN', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(clean(patient.name) + ' | RUN ' + clean(patient.run), margin, y + 12);
      y += 19;
      doc.setDrawColor(black[0], black[1], black[2]);
      doc.setLineWidth(1);
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;
    };

    var newPage = function () {
      doc.addPage('letter', 'portrait');
      y = margin;
      addContinuationHeader();
    };

    var ensureSpace = function (height) {
      if (y + height > footerTop) newPage();
    };

    var drawSectionBand = function (title, top) {
      doc.setDrawColor(black[0], black[1], black[2]);
      doc.setLineWidth(0.7);
      doc.line(margin, top + 14, pageWidth - margin, top + 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.4);
      doc.setTextColor(black[0], black[1], black[2]);
      doc.text(title, margin + 7, top + 10);
    };

    var drawLabeledValue = function (label, value, x, top, maxWidth) {
      setText(muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.4);
      doc.text(label, x, top);
      setText(dark);
      doc.setFont('helvetica', 'normal');
      doc.text(clean(value, '-'), x, top + 9, { maxWidth: maxWidth });
    };

    var drawPatientBlock = function () {
      var top = y;
      var height = 61;
      doc.setFillColor(pale[0], pale[1], pale[2]);
      doc.setDrawColor(line[0], line[1], line[2]);
      doc.rect(margin, top, contentWidth, height, 'FD');
      drawSectionBand('IDENTIFICACIÓN DEL PACIENTE', top);
      drawLabeledValue('Paciente', patient.name, margin + 8, top + 25, 300);
      drawLabeledValue('RUN', patient.run, margin + 330, top + 25, 110);
      drawLabeledValue('Sexo', patient.sex, margin + 450, top + 25, 80);
      drawLabeledValue('Fecha de nacimiento', patient.birthDate, margin + 8, top + 44, 100);
      drawLabeledValue('Edad', patient.age, margin + 132, top + 44, 185);
      drawLabeledValue('Previsión', patient.insurance, margin + 330, top + 44, 210);
      y += height + 8;
    };

    var drawClinicalBlock = function () {
      var diagnosis = commonDiagnosis || 'Los datos clínicos varían por orden; revisar cada sección.';
      var diagnosisLines = doc.splitTextToSize(diagnosis, contentWidth - 175);
      var problemLines = commonProblem
        ? doc.splitTextToSize(commonProblem, contentWidth - 96)
        : [];
      var observationLines = commonObservations
        ? doc.splitTextToSize(commonObservations, contentWidth - 88)
        : [];
      var height = 30 + Math.max(0, diagnosisLines.length - 1) * 8 +
        (problemLines.length ? problemLines.length * 8 + 4 : 0) +
        (observationLines.length ? 10 + observationLines.length * 8 : 0);
      ensureSpace(height);
      var top = y;
      doc.setDrawColor(line[0], line[1], line[2]);
      doc.rect(margin, top, contentWidth, height);
      drawSectionBand('DATOS CLÍNICOS', top);
      setText(dark);
      doc.setFontSize(8.1);
      doc.setFont('helvetica', 'bold');
      doc.text('Hipótesis diagnóstica:', margin + 8, top + 25);
      doc.setFont('helvetica', 'normal');
      doc.text(diagnosisLines, margin + 104, top + 25);
      doc.setFont('helvetica', 'bold');
      doc.text('GES: ' + clean(commonGes, 'Por orden'), pageWidth - margin - 8, top + 25, { align: 'right' });
      var detailY = top + 25 + Math.max(1, diagnosisLines.length) * 8;
      if (problemLines.length) {
        doc.setFont('helvetica', 'bold');
        doc.text('Problema de salud:', margin + 8, detailY);
        doc.setFont('helvetica', 'normal');
        doc.text(problemLines, margin + 88, detailY);
        detailY += problemLines.length * 8 + 4;
      }
      if (observationLines.length) {
        doc.setFont('helvetica', 'bold');
        doc.text('Observaciones:', margin + 8, detailY);
        doc.setFont('helvetica', 'normal');
        doc.text(observationLines, margin + 70, detailY);
      }
      y += height + 10;
    };

    var drawOrderHeader = function (request, continuation) {
      var top = y;
      doc.setFillColor(white[0], white[1], white[2]);
      doc.setDrawColor(line[0], line[1], line[2]);
      doc.rect(margin, top, contentWidth, 23, 'FD');
      setText(dark);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      var group = clean(request.group, 'Solicitud de laboratorio');
      doc.text(group + (continuation ? ' - continuación' : ''), margin + 7, top + 10, { maxWidth: 285 });
      doc.setFontSize(7.7);
      doc.text(request.folio, pageWidth - margin - 7, top + 10, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.text(
        'Solicitud: ' + request.requestDate + ' | Toma requerida: ' + request.requiredDate,
        margin + 7,
        top + 19
      );
      doc.text(request.tests.length + ' examen(es)', pageWidth - margin - 7, top + 19, { align: 'right' });
      y += 23;
    };

    var getOrderClinicalDifference = function (request) {
      var parts = [];
      if (!commonDiagnosis) parts.push('Diagnóstico: ' + clean(request.clinical.diagnosis, '-'));
      if (!commonGes) parts.push('GES: ' + clean(request.clinical.ges, '-'));
      if (!commonProblem && clean(request.clinical.healthProblem)) {
        parts.push('Problema de salud: ' + clean(request.clinical.healthProblem));
      }
      if (!commonObservations && clean(request.clinical.observations)) {
        parts.push('Observaciones: ' + clean(request.clinical.observations));
      }
      if (hasDifferentProfessionals) {
        parts.push(
          'Solicitante: ' + clean(request.professional.name) +
          ' - RUN ' + clean(request.professional.run)
        );
      }
      if (!parts.length) return { lines: [], height: 0 };
      var lines = doc.splitTextToSize(parts.join(' | '), contentWidth - 14);
      return { lines: lines, height: lines.length * 8 + 6 };
    };

    var drawOrderClinicalDifference = function (difference) {
      if (!difference.height) return;
      doc.setFillColor(white[0], white[1], white[2]);
      doc.rect(margin, y, contentWidth, difference.height, 'F');
      setText(muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.4);
      doc.text(difference.lines, margin + 7, y + 9);
      y += difference.height;
    };

    var drawTestHeader = function () {
      doc.setFillColor(white[0], white[1], white[2]);
      doc.setDrawColor(line[0], line[1], line[2]);
      doc.rect(margin, y, contentWidth, 14, 'FD');
      setText(muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.text('Código', margin + 7, y + 10);
      doc.text('Examen solicitado', margin + 58, y + 10);
      y += 14;
    };

    var getTestRowHeight = function (test) {
      var nameLines = doc.splitTextToSize(clean(test.name), contentWidth - 70);
      return { nameLines: nameLines, rowHeight: Math.max(17, nameLines.length * 9.5 + 6) };
    };

    var drawTest = function (test, index, request) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      var metrics = getTestRowHeight(test);
      var nameLines = metrics.nameLines;
      var rowHeight = metrics.rowHeight;
      if (y + rowHeight > footerTop) {
        newPage();
        drawOrderHeader(request, true);
        drawTestHeader();
      }
      if (index % 2 === 1) {
        doc.setFillColor(white[0], white[1], white[2]);
        doc.rect(margin, y, contentWidth, rowHeight, 'F');
      }
      setText(muted);
      doc.setFont('helvetica', 'bold');
      doc.text(clean(test.code), margin + 7, y + 12);
      setText(dark);
      doc.setFont('helvetica', 'normal');
      doc.text(nameLines, margin + 58, y + 12);
      doc.setDrawColor(black[0], black[1], black[2]);
      doc.setLineWidth(0.25);
      doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
      y += rowHeight;
    };

    addFullHeader();
    drawPatientBlock();
    drawClinicalBlock();

    requests.forEach(function (request) {
      var difference = getOrderClinicalDifference(request);
      var firstRowHeight = request.tests.length ? getTestRowHeight(request.tests[0]).rowHeight : 0;
      ensureSpace(23 + difference.height + 14 + firstRowHeight);
      drawOrderHeader(request, false);
      drawOrderClinicalDifference(difference);
      drawTestHeader();
      request.tests.forEach(function (test, index) { drawTest(test, index, request); });
      y += 8;
    });

    var professionals = [];
    requests.forEach(function (request) {
      var key = identity(request.professional.run) || identity(request.professional.name);
      var current = professionals.find(function (item) { return item.key === key; });
      if (!current) {
        current = { key: key, professional: request.professional };
        professionals.push(current);
      }
    });
    professionals.forEach(function (entry, index) {
      ensureSpace(index === 0 ? 49 : 35);
      if (index === 0) {
        drawSectionBand('PROFESIONAL SOLICITANTE', y);
        y += 14;
      }
      setText(dark);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.text(clean(entry.professional.name), margin + 7, y + 11);
      doc.setFont('helvetica', 'normal');
      doc.text('RUN ' + clean(entry.professional.run), margin + 7, y + 21);
      doc.setDrawColor(muted[0], muted[1], muted[2]);
      doc.line(pageWidth - margin - 165, y + 21, pageWidth - margin - 7, y + 21);
      doc.setFontSize(6.2);
      setText(muted);
      doc.text('Firma profesional', pageWidth - margin - 86, y + 30, { align: 'center' });
      y += 35;
    });

    var pageCount = doc.getNumberOfPages();
    for (var page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(line[0], line[1], line[2]);
      doc.setLineWidth(0.5);
      doc.line(margin, footerTop + 5, pageWidth - margin, footerTop + 5);
      setText(muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.text('Página ' + page + ' de ' + pageCount, pageWidth - margin, footerTop + 15, { align: 'right' });
    }

    doc.setProperties({
      title: 'Solicitud de exámenes',
      subject: 'Solicitud de exámenes',
      creator: 'Rayen -> HHR',
    });
    return doc.output('arraybuffer');
  };

  root.HhrExamRequestPdf = {
    generateIntegratedExamRequestPdf: generateIntegratedExamRequestPdf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HhrExamRequestPdf;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Small, testable DOM helpers for the compact laboratory-request action.
 */
(function (root) {
  'use strict';

  var normalizeText = function (value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  };

  var resolveEncounterId = function (rawUrl) {
    try {
      var parsed = new URL(String(rawUrl || ''));
      if (parsed.hostname !== 'fichamedico.rayensalud.cl') return '';
      var match = parsed.pathname.match(
        /^\/dashboard\/encounter-list(?:-nurse)?\/(\d+)\/?$/
      );
      return match ? match[1] : '';
    } catch (_error) {
      return '';
    }
  };

  var findExamRequestTable = function (documentRef) {
    if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return null;
    var tables = Array.from(documentRef.querySelectorAll('table'));
    return tables.find(function (table) {
      var headers = Array.from(table.querySelectorAll('thead th')).map(function (header) {
        return normalizeText(header.textContent);
      });
      return headers.includes('Grupo de exámenes')
        && headers.includes('Nro. Orden')
        && headers.includes('Examen(es)')
        && headers.includes('Acciones');
    }) || null;
  };

  var collectExamRequests = function (table) {
    if (!table || typeof table.querySelectorAll !== 'function') return [];
    var seen = new Set();
    var requests = [];
    Array.from(table.querySelectorAll('tbody tr')).forEach(function (row) {
      var cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 4) return;
      var orderId = normalizeText(cells[1] && cells[1].textContent);
      if (!/^\d+$/.test(orderId) || seen.has(orderId)) return;
      seen.add(orderId);
      requests.push({
        orderId: orderId,
        group: normalizeText(cells[0] && cells[0].textContent) || 'Solicitud de laboratorio',
        date: normalizeText(cells[3] && cells[3].textContent),
      });
    });
    return requests;
  };

  var validateSelection = function (values) {
    var selected = Array.from(new Set(Array.isArray(values) ? values.map(String) : []))
      .filter(function (value) { return /^\d+$/.test(value); });
    return {
      selected: selected,
      valid: selected.length >= 2 && selected.length <= 3,
      message: selected.length < 2
        ? 'Selecciona al menos 2 órdenes.'
        : selected.length > 3
          ? 'Selecciona un máximo de 3 órdenes.'
          : '',
    };
  };

  var decodePdfLiteral = function (value) {
    return String(value || '')
      .replace(/\\([0-7]{1,3})/g, function (_match, octal) {
        return String.fromCharCode(parseInt(octal, 8));
      })
      .replace(/\\([nrtbf()\\])/g, function (_match, escaped) {
        var controls = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        return controls[escaped] || escaped;
      });
  };

  var inflatePdfStreams = async function (buffer) {
    if (typeof DecompressionStream === 'undefined') return [];
    var bytes = new Uint8Array(buffer);
    var source = new TextDecoder('latin1').decode(bytes);
    var streams = [];
    var expression = /<<(?:.|\r|\n)*?\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])(?:.|\r|\n)*?>>\s*stream\r?\n/g;
    var match;
    while ((match = expression.exec(source))) {
      var start = match.index + match[0].length;
      var end = source.indexOf('endstream', start);
      if (end < 0) break;
      while (end > start && (bytes[end - 1] === 10 || bytes[end - 1] === 13)) end -= 1;
      try {
        var stream = new Blob([bytes.slice(start, end)])
          .stream()
          .pipeThrough(new DecompressionStream('deflate'));
        var reader = stream.getReader();
        var chunks = [];
        var totalLength = 0;
        while (true) {
          var read = await reader.read();
          if (read.done) break;
          chunks.push(read.value);
          totalLength += read.value.byteLength;
        }
        var inflated = new Uint8Array(totalLength);
        var writeOffset = 0;
        chunks.forEach(function (chunk) {
          inflated.set(chunk, writeOffset);
          writeOffset += chunk.byteLength;
        });
        streams.push(new TextDecoder('windows-1252').decode(inflated));
      } catch (_error) {
        // Jasper includes fonts and metadata in other compressed streams. Only text streams
        // that can be decoded safely are candidates for the clinical extraction below.
      }
      expression.lastIndex = Math.max(expression.lastIndex, end + 9);
    }
    return streams;
  };

  var pdfTextItems = function (streams) {
    var pages = [];
    (Array.isArray(streams) ? streams : []).forEach(function (stream, pageIndex) {
      var items = [];
      var x = 0;
      var y = 0;
      var lineX = 0;
      var lineY = 0;
      var inText = false;
      String(stream || '').split(/\r?\n/).forEach(function (line) {
        if (/^BT\s*$/.test(line)) {
          x = 0;
          y = 0;
          lineX = 0;
          lineY = 0;
          inText = true;
          return;
        }
        if (/^ET\s*$/.test(line)) {
          inText = false;
          return;
        }
        var matrix = line.match(/^1 0 0 1\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+Tm\s*$/);
        if (matrix) {
          lineX = Number(matrix[1]);
          lineY = Number(matrix[2]);
          x = lineX;
          y = lineY;
          return;
        }
        var translation = line.match(/^(-?[0-9.]+)\s+(-?[0-9.]+)\s+Td\s*$/);
        if (translation && inText) {
          lineX += Number(translation[1]);
          lineY += Number(translation[2]);
          x = lineX;
          y = lineY;
          return;
        }
        var literal = line.match(/^\(((?:\\.|[^\\)])*)\)\s*Tj\s*$/);
        if (literal && inText) {
          items.push({
            page: pageIndex + 1,
            x: x,
            y: y,
            text: normalizeText(decodePdfLiteral(literal[1])),
          });
        }
      });
      if (items.length) pages.push(items);
    });
    return pages;
  };

  var exactItem = function (items, label, last) {
    var matches = items.filter(function (item) {
      return normalizeText(item.text).toLowerCase() === String(label || '').toLowerCase();
    });
    return last ? matches[matches.length - 1] : matches[0];
  };

  var valueAboveLabel = function (items, label, options) {
    var settings = options || {};
    var labelItem = exactItem(items, label, settings.last);
    if (!labelItem) return '';
    var candidate = items
      .filter(function (item) {
        return Math.abs(item.x - labelItem.x) <= (settings.xTolerance || 22) &&
          item.y > labelItem.y + 4 && item.y < labelItem.y + (settings.maxRise || 30);
      })
      .sort(function (a, b) { return a.y - b.y || Math.abs(a.x - labelItem.x) - Math.abs(b.x - labelItem.x); })[0];
    return normalizeText(candidate && candidate.text);
  };

  var valueBelowLabel = function (items, label) {
    var labelItem = exactItem(items, label);
    if (!labelItem) return '';
    var candidate = items
      .filter(function (item) {
        return Math.abs(item.x - labelItem.x) <= 24 && item.y < labelItem.y - 4 && item.y > labelItem.y - 30;
      })
      .sort(function (a, b) { return b.y - a.y || Math.abs(a.x - labelItem.x) - Math.abs(b.x - labelItem.x); })[0];
    return normalizeText(candidate && candidate.text);
  };

  var fieldTextUntilLabel = function (items, label, nextLabel, maxX) {
    var labelItem = exactItem(items, label);
    var boundaryItem = exactItem(items, nextLabel);
    if (!labelItem || !boundaryItem || labelItem.y <= boundaryItem.y) return '';
    return items
      .filter(function (item) {
        if (item === labelItem || item === boundaryItem || item.x >= (Number(maxX) || Infinity)) {
          return false;
        }
        var sameBaseline = Math.abs(item.y - labelItem.y) <= 2 && item.x > labelItem.x + 8;
        var continuation = item.y < labelItem.y - 2 && item.y > boundaryItem.y + 2 &&
          item.x >= labelItem.x;
        return sameBaseline || continuation;
      })
      .sort(function (a, b) { return b.y - a.y || a.x - b.x; })
      .map(function (item) { return normalizeText(item.text); })
      .filter(Boolean)
      .join(' ');
  };

  var dateOnLabelRow = function (items, label, maxX) {
    var labelItem = exactItem(items, label);
    if (!labelItem) return '';
    var values = items
      .filter(function (item) {
        return item.x > labelItem.x + 45 && item.x < (Number(maxX) || Infinity) &&
          Math.abs(item.y - labelItem.y) <= 2 && /^\d{2,4}$/.test(normalizeText(item.text));
      })
      .sort(function (a, b) { return a.x - b.x; })
      .map(function (item) { return normalizeText(item.text); });
    return values.length >= 3 ? values[0] + '-' + values[1] + '-' + values[2] : '';
  };

  var extractGesValue = function (items) {
    var no = exactItem(items, 'NO');
    var yes = exactItem(items, 'SI');
    if (!no || !yes) return '';
    var mark = items.find(function (item) {
      return normalizeText(item.text).toUpperCase() === 'X' &&
        Math.abs(item.y - no.y) <= 2 && item.x >= no.x && item.x <= yes.x + 20;
    });
    if (!mark) return '';
    // Jasper places the check mark after the selected label. The NO mark therefore sits
    // between NO and SI; a SI mark is drawn to the right of SI.
    return mark.x < yes.x ? 'NO' : 'SI';
  };

  var extractClinicalObservations = function (items) {
    var label = exactItem(items, 'Observaciones Clínicas:');
    var testsHeader = exactItem(items, 'Se solicitan las siguientes pruebas de Laboratorio:');
    if (!label || !testsHeader || label.y <= testsHeader.y) return '';
    return items
      .filter(function (item) {
        return item !== label && item.x >= label.x && item.y < label.y - 2 && item.y > testsHeader.y + 2;
      })
      .sort(function (a, b) { return b.y - a.y || a.x - b.x; })
      .map(function (item) { return normalizeText(item.text); })
      .filter(Boolean)
      .join(' ');
  };

  var extractLaboratoryTests = function (pages) {
    var tests = [];
    (Array.isArray(pages) ? pages : []).forEach(function (pageItems) {
      var current = null;
      pageItems
        .slice()
        .sort(function (a, b) { return b.y - a.y || a.x - b.x; })
        .forEach(function (item) {
          var value = normalizeText(item.text);
          var start = value.match(/^(\d{6})\s*-\s*(.+)$/);
          if (start && item.x < 80) {
            current = { code: start[1], rawName: start[2], complete: /-\s*Prueba de laboratorio\s*$/i.test(start[2]) };
            tests.push(current);
            return;
          }
          if (!current || item.x >= 80 || !value || /^(?:Pág\.|DATOS DEL \(LA\) PROFESIONAL)/i.test(value)) return;
          if (current.complete) return;
          current.rawName += ' ' + value;
          current.complete = /-\s*Prueba de laboratorio\s*$/i.test(current.rawName);
        });
    });
    if (!tests.length || tests.some(function (test) { return !test.complete; })) return [];
    return tests.map(function (test) {
      return {
        code: test.code,
        name: normalizeText(test.rawName.replace(/\s*-\s*Prueba de laboratorio\s*$/i, '')),
      };
    }).filter(function (test) { return test.code && test.name; });
  };

  var extractOfficialExamRequestContent = async function (buffer) {
    var streams = await inflatePdfStreams(buffer);
    var pages = pdfTextItems(streams);
    var firstPage = pages[0] || [];
    var lastPage = pages[pages.length - 1] || [];
    if (!firstPage.length || !lastPage.length) return null;
    var folioItem = firstPage.find(function (item) { return /^ELO-\d+$/.test(normalizeText(item.text)); });
    var firstFamilyName = valueAboveLabel(firstPage, 'Primer Apellido');
    var secondFamilyName = valueAboveLabel(firstPage, 'Segundo Apellido');
    var givenNames = valueAboveLabel(firstPage, 'Nombres');
    var professionalFirstFamilyName = valueAboveLabel(lastPage, 'Primer Apellido', { last: true });
    var professionalSecondFamilyName = valueAboveLabel(lastPage, 'Segundo Apellido', { last: true });
    var professionalGivenNames = valueAboveLabel(lastPage, 'Nombres', { last: true });
    var tests = extractLaboratoryTests(pages);
    var extracted = {
      folio: normalizeText(folioItem && folioItem.text),
      orderId: normalizeText(folioItem && folioItem.text).replace(/^ELO-/, ''),
      requestDate: dateOnLabelRow(firstPage, 'Fecha Solicitud:', 300),
      requiredDate: dateOnLabelRow(firstPage, 'Fecha requerida de toma:', 620),
      healthService: valueBelowLabel(firstPage, '1. Servicio de Salud'),
      establishment: valueBelowLabel(firstPage, '2. Establecimiento'),
      patient: {
        firstFamilyName: firstFamilyName,
        secondFamilyName: secondFamilyName,
        givenNames: givenNames,
        name: normalizeText([givenNames, firstFamilyName, secondFamilyName].filter(Boolean).join(' ')),
        run: valueAboveLabel(firstPage, 'RUN'),
        insurance: valueAboveLabel(firstPage, 'Previsión'),
        sex: valueAboveLabel(firstPage, 'Sexo'),
        birthDate: valueAboveLabel(firstPage, 'Fecha de Nacimiento'),
        age: valueAboveLabel(firstPage, 'Edad'),
      },
      clinical: {
        diagnosis: fieldTextUntilLabel(
          firstPage,
          'Hipótesis diagnóstica:',
          '¿Es GES?',
          610
        ),
        ges: extractGesValue(firstPage),
        healthProblem: fieldTextUntilLabel(
          firstPage,
          'Problema de Salud:',
          'Observaciones Clínicas:',
          610
        ),
        observations: extractClinicalObservations(firstPage),
      },
      professional: {
        firstFamilyName: professionalFirstFamilyName,
        secondFamilyName: professionalSecondFamilyName,
        givenNames: professionalGivenNames,
        name: normalizeText([
          professionalGivenNames,
          professionalFirstFamilyName,
          professionalSecondFamilyName,
        ].filter(Boolean).join(' ')),
        run: valueAboveLabel(lastPage, 'RUN', { last: true }),
      },
      tests: tests,
      sourcePageCount: pages.length,
    };
    var required = [
      extracted.folio,
      extracted.orderId,
      extracted.requestDate,
      extracted.requiredDate,
      extracted.healthService,
      extracted.establishment,
      extracted.patient.name,
      extracted.patient.run,
      extracted.patient.insurance,
      extracted.patient.sex,
      extracted.patient.birthDate,
      extracted.patient.age,
      extracted.clinical.diagnosis,
      extracted.clinical.ges,
      extracted.professional.name,
      extracted.professional.run,
    ];
    return required.every(function (value) { return normalizeText(value); }) && tests.length
      ? extracted
      : null;
  };

  var api = {
    normalizeText: normalizeText,
    resolveEncounterId: resolveEncounterId,
    findExamRequestTable: findExamRequestTable,
    collectExamRequests: collectExamRequests,
    validateSelection: validateSelection,
    extractOfficialExamRequestContent: extractOfficialExamRequestContent,
  };
  root.HhrExamRequestPrintUi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

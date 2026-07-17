/**
 * prescription-print.js (UMD: content script + service worker + Vitest)
 *
 * Pure helpers for the nursing prescription-print affordance. Keeping URL and
 * history normalization here lets us test the clinical selection contract
 * without a browser or a Rayen session.
 */
(function (root) {
  'use strict';

  var FICHA_ORIGIN = 'https://fichamedico.rayensalud.cl';
  var NURSE_ROUTE_RE = /^\/dashboard\/encounter-list-nurse\/(\d+)\/?$/;
  var ENCOUNTER_ROUTE_RE = /^\/dashboard\/encounter-list(?:-nurse)?\/(\d+)(?:\/.*)?$/;
  var ENCOUNTER_QUERY_ROUTE_RE = /^\/dashboard\/encounter-list(?:-nurse)?\/?$/;
  var INDICATIONS_REPORT_FILE = 'Reporte_Indicaciones_Paciente.pdf';
  var PRESCRIPTION_REPORT_FILE = 'Reporte_Receta_Medica.pdf';
  var REGIMEN_REPORT_FILE = 'Reporte_Regimen.pdf';
  var EASTER_TIME_ZONE = 'Pacific/Easter';

  var resolveNursingEncounterId = function (value) {
    try {
      var url = new URL(String(value || ''), FICHA_ORIGIN);
      if (url.origin !== FICHA_ORIGIN) return '';
      var match = url.pathname.match(NURSE_ROUTE_RE);
      return match ? match[1] : '';
    } catch (_error) {
      return '';
    }
  };

  // Nursing profiles are not guaranteed to keep the `-nurse` route after every internal
  // navigation. Resolve the clinical episode from either supported work-list route, while the
  // content script independently verifies the visible nursing role before adding the control.
  var resolveEncounterId = function (value) {
    try {
      var url = new URL(String(value || ''), FICHA_ORIGIN);
      if (url.origin !== FICHA_ORIGIN) return '';
      var match = url.pathname.match(ENCOUNTER_ROUTE_RE);
      var queryId =
        url.searchParams.get('encId') ||
        url.searchParams.get('enc_id') ||
        url.searchParams.get('encounterId');
      if (match) {
        return /^\d+$/.test(String(queryId || '')) && String(queryId) !== match[1]
          ? ''
          : match[1];
      }
      if (!ENCOUNTER_QUERY_ROUTE_RE.test(url.pathname)) return '';
      if (/^\d+$/.test(String(queryId || ''))) return String(queryId);
      return '';
    } catch (_error) {
      return '';
    }
  };

  var isNursingRouteUrl = function (value) {
    try {
      var url = new URL(String(value || ''), FICHA_ORIGIN);
      return url.origin === FICHA_ORIGIN && /\/dashboard\/encounter-list-nurse(?:\/|$)/.test(url.pathname);
    } catch (_error) {
      return false;
    }
  };

  var toIsoDate = function (value) {
    var text = String(value || '').trim();
    var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '';
    var date = new Date(match[1] + '-' + match[2] + '-' + match[3] + 'T12:00:00Z');
    return Number.isNaN(date.getTime()) ? '' : match[1] + '-' + match[2] + '-' + match[3];
  };

  var toDateTime = function (value) {
    var normalized = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized) ? normalized : '';
  };

  var formatDateLabel = function (isoDate) {
    var normalized = toIsoDate(isoDate);
    if (!normalized) return '';
    var parts = normalized.split('-');
    return parts[2] + '-' + parts[1] + '-' + parts[0];
  };

  var formatDateTimeLabel = function (value) {
    var normalized = toDateTime(value);
    if (!normalized) return formatDateLabel(value);
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
      var instant = new Date(normalized);
      if (!Number.isNaN(instant.getTime())) {
        var parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: EASTER_TIME_ZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).formatToParts(instant);
        var part = function (type) {
          var found = parts.find(function (item) { return item.type === type; });
          return found ? found.value : '';
        };
        return part('day') + '-' + part('month') + '-' + part('year') +
          ' ' + part('hour') + ':' + part('minute');
      }
    }
    return formatDateLabel(normalized) + ' ' + normalized.slice(11, 16);
  };

  var formatAgeLabel = function (birthDate, referenceValue) {
    var birthMatch = String(birthDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!birthMatch) return '';
    var birthYear = Number(birthMatch[1]);
    var birthMonth = Number(birthMatch[2]);
    var birthDay = Number(birthMatch[3]);
    if (birthMonth < 1 || birthMonth > 12 || birthDay < 1 ||
        birthDay > new Date(Date.UTC(birthYear, birthMonth, 0)).getUTCDate()) return '';

    var referenceParts = null;
    var referenceText = String(referenceValue || '').trim();
    var localReference = referenceText.match(/^(\d{4})-(\d{2})-(\d{2})(?!.*(?:Z|[+-]\d{2}:?\d{2})$)/i);
    if (localReference) {
      referenceParts = [Number(localReference[1]), Number(localReference[2]), Number(localReference[3])];
    } else {
      var referenceDate = referenceValue instanceof Date
        ? referenceValue
        : referenceText ? new Date(referenceText) : new Date();
      if (Number.isNaN(referenceDate.getTime())) return '';
      var dateParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: EASTER_TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(referenceDate);
      var datePart = function (type) {
        var found = dateParts.find(function (item) { return item.type === type; });
        return found ? Number(found.value) : 0;
      };
      referenceParts = [datePart('year'), datePart('month'), datePart('day')];
    }
    var year = referenceParts[0];
    var month = referenceParts[1];
    var day = referenceParts[2];
    if (!year || !month || !day) return '';
    var years = year - birthYear;
    var months = month - birthMonth;
    var days = day - birthDay;
    if (days < 0) {
      months -= 1;
      days += new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    if (years < 0) return '';
    return years + (years === 1 ? ' año, ' : ' años, ') +
      months + (months === 1 ? ' mes, ' : ' meses, ') +
      days + (days === 1 ? ' día' : ' días');
  };

  var normalizeClinicalDateTime = function (value) {
    var normalized = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) return normalized;
    var display = normalized.match(
      /^(\d{1,2})-(\d{1,2})-(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );
    if (!display) return '';
    return display[3] + '-' + display[2].padStart(2, '0') + '-' + display[1].padStart(2, '0') +
      'T' + display[4].padStart(2, '0') + ':' + display[5] + ':' + (display[6] || '00');
  };

  var formatRun = function (value) {
    var raw = String(value || '').trim();
    if (!raw || /[^0-9kK.\-\s]/.test(raw)) return '';
    var normalized = raw.replace(/[^0-9kK]/g, '').toUpperCase();
    if (normalized.length < 2 || normalized.length > 9) return '';
    var body = normalized.slice(0, -1);
    var verifier = normalized.slice(-1);
    if (!/^\d{1,8}$/.test(body) || !/^(?:\d|K)$/.test(verifier)) return '';
    var sum = 0;
    var multiplier = 2;
    for (var index = body.length - 1; index >= 0; index -= 1) {
      sum += Number(body[index]) * multiplier;
      multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }
    var remainder = 11 - (sum % 11);
    var expectedVerifier = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
    if (verifier !== expectedVerifier) return '';
    var grouped = '';
    while (body.length > 3) {
      grouped = '.' + body.slice(-3) + grouped;
      body = body.slice(0, -3);
    }
    return body + grouped + '-' + verifier;
  };

  var isTrueFlag = function (value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    return value === true || value === 1 || normalized === 'true' || normalized === '1' || normalized === 's';
  };

  var normalizedAuthor = function (value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  };

  var authorKey = function (name) {
    return normalizedAuthor(name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'sin-profesional';
  };

  var deriveProfessionalPrescriptionGroups = function (events) {
    var latestRows = new Map();
    for (var i = 0; i < (Array.isArray(events) ? events.length : 0); i += 1) {
      var event = events[i] || {};
      var rows = Array.isArray(event.patientPharmaIndicationResume)
        ? event.patientPharmaIndicationResume
        : [];
      for (var j = 0; j < rows.length; j += 1) {
        var row = rows[j] || {};
        var dateTime = String(row.PUBLISH_DATETIME || event.publishDatetime || '');
        var medicationName = String(row.DESCRIPTOR || row.VIRTUAL_MEDICAL_PRODUCT || '').trim();
        if (!medicationName) continue;
        var sourceAuthor = normalizedAuthor(row.HCP_NAME);
        var author = sourceAuthor || 'Profesional no informado';
        var stableId = String(row.MRE_ID || '').trim();
        var identity = stableId
          ? 'id:' + stableId
          : 'row:' + [
              author,
              medicationName,
              row.POSOLOGY || '',
              row.ROUTE_ADMINISTRATION || '',
              row.MRE_ADMINISTRATION_NOTE || '',
              dateTime,
            ].join('|').toLowerCase();
        var current = latestRows.get(identity);
        var inactive = isTrueFlag(row.ARCHIVED) || isTrueFlag(row.SUSPENDED);
        var hasExternalFlag = ['IS_EXTERNAL', 'is_external', 'ALL_MEDICATION', 'allMedication']
          .some(function (key) { return Object.prototype.hasOwnProperty.call(row, key); });
        var external = hasExternalFlag
          ? isTrueFlag(row.IS_EXTERNAL) || isTrueFlag(row.is_external) ||
            isTrueFlag(row.ALL_MEDICATION) || isTrueFlag(row.allMedication)
          : Boolean(current && current.external);
        var sortDateTime = normalizeClinicalDateTime(dateTime) || dateTime;
        var eventDateTime = normalizeClinicalDateTime(event.publishDatetime || '') ||
          String(event.publishDatetime || '');
        var eventSequence = Number(event.encounterEventId || event.id || 0);
        var shouldReplace = !current || sortDateTime > current.sortDateTime ||
          (sortDateTime === current.sortDateTime && (
            eventDateTime > current.eventDateTime ||
            (eventDateTime === current.eventDateTime && eventSequence > current.eventSequence) ||
            (eventDateTime === current.eventDateTime && eventSequence === current.eventSequence &&
              inactive && !current.inactive)
          ));
        if (shouldReplace) {
          latestRows.set(identity, {
            id: stableId || identity,
            author: author,
            authorVerified: Boolean(sourceAuthor),
            professionalRun: formatRun(
              row.PREFERRED_IDENTIFIER_CODE || row.HCP_IDENTIFIER_CODE || ''
            ),
            medication: medicationName,
            posology: String(row.POSOLOGY || '').trim(),
            route: String(row.ROUTE_ADMINISTRATION || '').trim(),
            note: String(row.MRE_ADMINISTRATION_NOTE || '').trim(),
            date: toIsoDate(dateTime),
            dateTime: dateTime,
            sortDateTime: sortDateTime,
            eventDateTime: eventDateTime,
            eventSequence: eventSequence,
            inactive: inactive,
            external: external,
          });
        }
      }
    }

    var groupsByKey = new Map();
    latestRows.forEach(function (row) {
      if (row.inactive) return;
      var normalizedName = authorKey(row.author);
      var resolvedRun = row.professionalRun || '';
      var runIdentity = String(resolvedRun || '').replace(/[^0-9kK]/g, '').toUpperCase();
      var key = runIdentity
        ? 'professional-run:' + runIdentity.toLowerCase()
        : 'professional:' + normalizedName;
      var group = groupsByKey.get(key) || {
        key: key,
        professional: row.author,
        professionalRun: resolvedRun,
        prescriberVerified: Boolean(row.authorVerified && resolvedRun),
        medications: [],
        latestDate: '',
        latestDateTime: '',
      };
      if (!group.professionalRun && resolvedRun) group.professionalRun = resolvedRun;
      if (!group.prescriberVerified && row.authorVerified && resolvedRun) {
        group.professional = row.author;
        group.prescriberVerified = true;
      }
      group.medications.push({
        id: row.id,
        medication: row.medication,
        posology: row.posology,
        route: row.route,
        note: row.note,
        date: row.date,
        dateTime: row.dateTime,
        external: row.external,
      });
      if (row.date > group.latestDate) group.latestDate = row.date;
      if (row.dateTime > group.latestDateTime) group.latestDateTime = row.dateTime;
      groupsByKey.set(key, group);
    });

    return Array.from(groupsByKey.values())
      .map(function (group) {
        group.medications.sort(function (a, b) {
          return (a.date || '').localeCompare(b.date || '') || a.medication.localeCompare(b.medication);
        });
        return {
          key: group.key,
          professional: group.professional,
          professionalRun: group.professionalRun,
          prescriberVerified: group.prescriberVerified,
          count: group.medications.length,
          externalCount: group.medications.filter(function (medication) { return medication.external; }).length,
          latestDate: group.latestDate,
          latestDateTime: group.latestDateTime,
          medications: group.medications,
        };
      })
      .sort(function (a, b) { return a.professional.localeCompare(b.professional); });
  };

  // The history report is the best source for authorship and validation chronology, but some
  // Eloisa deployments omit `is_external` from that report. The active medication endpoint used
  // by the visible table keeps the flag. Reconcile both sources strictly by the stable MRE id so
  // an external label can never be inferred from a similar drug name.
  var applyCurrentMedicationMetadata = function (events, currentEntries) {
    var metadataById = new Map();
    (Array.isArray(currentEntries) ? currentEntries : []).forEach(function (entry) {
      var id = String(entry && (entry.id || entry.MRE_ID || entry.mreId) || '').trim();
      if (!/^\d+$/.test(id)) return;
      metadataById.set(id, {
        external: isTrueFlag(entry.is_external) || isTrueFlag(entry.IS_EXTERNAL),
      });
    });
    if (!metadataById.size) return Array.isArray(events) ? events : [];
    return (Array.isArray(events) ? events : []).map(function (event) {
      var rows = Array.isArray(event && event.patientPharmaIndicationResume)
        ? event.patientPharmaIndicationResume
        : null;
      if (!rows) return event;
      return {
        ...event,
        patientPharmaIndicationResume: rows.map(function (row) {
          var id = String(row && (row.MRE_ID || row.id || row.mreId) || '').trim();
          var metadata = metadataById.get(id);
          return metadata ? { ...row, IS_EXTERNAL: metadata.external } : row;
        }),
      };
    });
  };

  var deriveExternalPrescriptionGroups = function (professionalGroups) {
    var seenIds = new Set();
    var externalGroups = [];
    (Array.isArray(professionalGroups) ? professionalGroups : []).forEach(function (group) {
      (Array.isArray(group.medications) ? group.medications : []).forEach(function (medication) {
        var medicationId = String(medication && medication.id || '').trim();
        if (!medication || !medication.external || !/^\d+$/.test(medicationId) || seenIds.has(medicationId)) return;
        seenIds.add(medicationId);
        externalGroups.push({
          key: 'external:' + medicationId,
          external: true,
          medication: medication.medication,
          professional: group.professional,
          professionalRun: group.professionalRun,
          prescriberVerified: group.prescriberVerified,
          count: 1,
          latestDate: medication.date || group.latestDate || '',
          latestDateTime: medication.dateTime || group.latestDateTime || '',
          validationDate: group.validationDate || '',
          validationDateTime: group.validationDateTime || '',
          printDate: medication.date || group.latestDate || group.validationDate || '',
          printDateTime: medication.dateTime || group.latestDateTime || group.validationDateTime || '',
          printDateSource: medication.dateTime || group.latestDateTime ? 'indication' : 'validation',
          medications: [{ ...medication }],
        });
      });
    });
    return externalGroups.sort(function (a, b) {
      return String(a.medication || '').localeCompare(String(b.medication || ''));
    });
  };

  var applyProfessionalValidationDates = function (groups, events, currentValidation) {
    var latestByProfessional = new Map();
    var latestByRun = new Map();
    var remember = function (name, value, run) {
      var normalizedName = normalizedAuthor(name);
      var dateTime = toDateTime(value);
      if (!normalizedName || !dateTime) return;
      var key = authorKey(normalizedName);
      if (dateTime > (latestByProfessional.get(key) || '')) latestByProfessional.set(key, dateTime);
      var runKey = String(formatRun(run || '') || '').replace(/[^0-9kK]/g, '').toUpperCase();
      if (runKey && dateTime > (latestByRun.get(runKey) || '')) latestByRun.set(runKey, dateTime);
    };

    for (var i = 0; i < (Array.isArray(events) ? events.length : 0); i += 1) {
      var event = events[i] || {};
      var validator = event.healthCarePractitionerValidator;
      if (validator && typeof validator === 'object') {
        remember(
          validator.healthCarePractitionerName || validator.fullName || validator.HCP_NAME || validator.name,
          validator.creationDatetime || validator.stringTimestamp || validator.timestamp || event.publishDatetime,
          validator.preferredIdentifierCode || validator.healthCarePractitionerIdentifierCode ||
            validator.PREFERRED_IDENTIFIER_CODE || validator.HCP_IDENTIFIER_CODE
        );
      } else if (typeof validator === 'string') {
        remember(validator, event.publishDatetime);
      }
    }

    if (currentValidation && typeof currentValidation === 'object') {
      remember(
        currentValidation.healthCarePractitionerName || currentValidation.fullName || currentValidation.name,
        currentValidation.creationDatetime || currentValidation.stringTimestamp || currentValidation.timestamp,
        currentValidation.preferredIdentifierCode || currentValidation.healthCarePractitionerIdentifierCode ||
          currentValidation.PREFERRED_IDENTIFIER_CODE || currentValidation.HCP_IDENTIFIER_CODE
      );
    }

    var safeGroups = Array.isArray(groups) ? groups : [];
    var nameCounts = new Map();
    safeGroups.forEach(function (group) {
      var key = authorKey(group.professional);
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    });
    return safeGroups.map(function (group) {
      var nameKey = authorKey(group.professional);
      var runKey = String(formatRun(group.professionalRun || '') || '').replace(/[^0-9kK]/g, '').toUpperCase();
      var identityValidation = runKey ? latestByRun.get(runKey) : '';
      var unambiguousNameValidation = nameCounts.get(nameKey) === 1
        ? latestByProfessional.get(nameKey)
        : '';
      // Prefer the stronger RUN match. Eloisa's validation response, however, frequently omits
      // the validator RUN even though the medication row includes it. In that case an exact,
      // unambiguous normalized name is the only available attribution and is safe to use. A name
      // shared by two groups never receives this fallback.
      var validationDateTime = identityValidation || unambiguousNameValidation || '';
      var indicationDateTime = normalizeClinicalDateTime(group.latestDateTime) || '';
      var printDateTime = indicationDateTime || validationDateTime || '';
      return {
        ...group,
        validationDateTime: validationDateTime,
        validationDate: toIsoDate(validationDateTime) || '',
        printDateTime: printDateTime,
        printDate: toIsoDate(printDateTime) || group.latestDate || '',
        printDateSource: indicationDateTime ? 'indication' : validationDateTime ? 'validation' : '',
      };
    });
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
        var stream = new Blob([bytes.slice(start, end)]).stream().pipeThrough(new DecompressionStream('deflate'));
        var inflated = await new Response(stream).arrayBuffer();
        streams.push(new TextDecoder('windows-1252').decode(inflated));
      } catch (_error) {
        // Ignore non-content streams; the official Jasper report keeps its page text in one
        // standard FlateDecode stream.
      }
      expression.lastIndex = Math.max(expression.lastIndex, end + 9);
    }
    return streams;
  };

  var pdfTextItems = function (streams) {
    var pages = [];
    (Array.isArray(streams) ? streams : []).forEach(function (stream, pageIndex) {
      var items = [];
      var horizontalLines = [];
      var x = 0;
      var y = 0;
      String(stream || '').split(/\r?\n/).forEach(function (line) {
        var matrix = line.match(/^1 0 0 1\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+Tm\s*$/);
        if (!matrix) matrix = line.match(/^(-?[0-9.]+)\s+(-?[0-9.]+)\s+Td\s*$/);
        if (matrix) {
          x = Number(matrix[1]);
          y = Number(matrix[2]);
          return;
        }
        var literal = line.match(/^\(((?:\\.|[^\\)])*)\)\s*Tj\s*$/);
        if (literal) items.push({ page: pageIndex + 1, x: x, y: y, text: decodePdfLiteral(literal[1]) });
      });
      var pdfNumber = '(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))';
      var lineExpression = new RegExp(
        pdfNumber + '\\s+' + pdfNumber + '\\s+m\\s+' +
        pdfNumber + '\\s+' + pdfNumber + '\\s+l\\s+S',
        'g'
      );
      var lineMatch;
      while ((lineMatch = lineExpression.exec(String(stream || '')))) {
        var x0 = Number(lineMatch[1]);
        var y0 = Number(lineMatch[2]);
        var x1 = Number(lineMatch[3]);
        var y1 = Number(lineMatch[4]);
        if ([x0, y0, x1, y1].every(Number.isFinite) && Math.abs(y0 - y1) <= 0.75) {
          horizontalLines.push({
            x0: Math.min(x0, x1),
            x1: Math.max(x0, x1),
            y: (y0 + y1) / 2,
          });
        }
      }
      if (items.length) {
        items.horizontalLines = horizontalLines;
        pages.push(items);
      }
    });
    return pages;
  };

  var normalizedPdfText = function (value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  };

  var sameRowValue = function (items, label, options) {
    var settings = options || {};
    var labels = items.filter(function (item) {
      return normalizedPdfText(item.text).toLowerCase() === String(label || '').toLowerCase();
    });
    var selectedLabel = settings.last ? labels[labels.length - 1] : labels[0];
    if (!selectedLabel) return '';
    var candidate = items
      .filter(function (item) {
        return item.x > selectedLabel.x + 5 && Math.abs(item.y - selectedLabel.y) <= 2;
      })
      .sort(function (a, b) { return a.x - b.x; })[0];
    return normalizedPdfText(candidate && candidate.text);
  };

  var extractOfficialPrescriptionContent = async function (buffer) {
    var streams = await inflatePdfStreams(buffer);
    var pages = pdfTextItems(streams);
    var items = pages.flat();
    if (!items.length) return null;
    var firstPage = pages[0] || [];
    var lastPage = pages[pages.length - 1] || [];
    var metadata = await extractOfficialPrescriptionMetadata(buffer);
    var diagnosisLabel = firstPage.find(function (item) {
      return normalizedPdfText(item.text).toLowerCase() === 'diagnóstico(s):';
    });
    var medicationHeader = firstPage.find(function (item) {
      return normalizedPdfText(item.text).toLowerCase() === 'medicamento';
    });
    var posologyHeader = firstPage.find(function (item) {
      return normalizedPdfText(item.text).toLowerCase() === 'posología e indicaciones';
    });
    var dispatchHeader = firstPage.find(function (item) {
      return normalizedPdfText(item.text).toLowerCase() === 'despacho farmacia';
    });
    if (!medicationHeader || !posologyHeader || !dispatchHeader) return null;
    var dispatchColumnX = dispatchHeader ? dispatchHeader.x : NaN;
    var diagnosis = '';
    if (diagnosisLabel) {
      var diagnosisFloor = medicationHeader && medicationHeader.y < diagnosisLabel.y
        ? medicationHeader.y
        : -Infinity;
      diagnosis = firstPage
        .filter(function (item) {
          if (item === diagnosisLabel || item.y > diagnosisLabel.y + 2 || item.y <= diagnosisFloor + 1) return false;
          if (Math.abs(item.y - diagnosisLabel.y) <= 2) return item.x > diagnosisLabel.x + 30;
          return item.x >= diagnosisLabel.x;
        })
        .filter(function (item) {
          return !/^(Medicamento|Posología e indicaciones|Despacho Farmacia)$/i.test(normalizedPdfText(item.text));
        })
        .sort(function (a, b) { return b.y - a.y || a.x - b.x; })
        .map(function (item) { return normalizedPdfText(item.text); })
        .filter(Boolean)
        .join(' ');
    }
    var medications = [];
    var extractionComplete = true;
    var recognizedTimestampCount = 0;
    pages.forEach(function (pageItems) {
      var timestamps = pageItems
        .filter(function (item) {
          return item.x < 100 && /^\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}$/.test(normalizedPdfText(item.text));
        })
        .sort(function (a, b) { return b.y - a.y; });
      recognizedTimestampCount += timestamps.length;
      var structuralBoundaries = pageItems
        .filter(function (item) {
          return /^(Medicamento|Diagnóstico\(s\):|Nombres:|RUN:|Cama:|Sala:|Servicio:|Prescriptor:|Impreso por)$/i.test(
            normalizedPdfText(item.text)
          );
        })
        .map(function (item) { return item.y; });
      var rowStructuralPattern = /^(?:Medicamento|Posología e indicaciones|Despacho Farmacia|Diagnóstico\(s\):|Nombres:|RUN:|Cama:|Sala:|Servicio:|Prescriptor:|Fecha:|Impreso por:?)(?:\s|$)/i;
      var boundaryGroups = new Map();
      (Array.isArray(pageItems.horizontalLines) ? pageItems.horizontalLines : []).forEach(function (line) {
        var key = String(Math.round(line.y * 2) / 2);
        var group = boundaryGroups.get(key) || { y: line.y, lines: [] };
        group.lines.push(line);
        boundaryGroups.set(key, group);
      });
      var tableBoundaryYs = Array.from(boundaryGroups.values())
        .filter(function (group) {
          var tolerance = 5;
          // Rayen serves two official Jasper layouts. The newer one draws each column as a
          // separate segment; the older one draws one continuous horizontal row border and no
          // vertical separators. Both geometries prove the same medication-row ownership.
          var hasContinuousTableLine = group.lines.some(function (line) {
            return line.x0 <= medicationHeader.x + tolerance &&
              line.x1 >= dispatchHeader.x + 50;
          });
          var coveredUntil = group.lines
            .slice()
            .sort(function (a, b) { return a.x0 - b.x0 || a.x1 - b.x1; })
            .reduce(function (rightEdge, line) {
              if (line.x0 > rightEdge + tolerance || line.x1 <= rightEdge) return rightEdge;
              return Math.max(rightEdge, line.x1);
            }, medicationHeader.x);
          var hasJoinedTableLine = coveredUntil >= dispatchHeader.x + 50;
          var hasMedicationCell = group.lines.some(function (line) {
            return Math.abs(line.x0 - medicationHeader.x) <= tolerance &&
              Math.abs(line.x1 - posologyHeader.x) <= tolerance;
          });
          var hasPosologyCell = group.lines.some(function (line) {
            return Math.abs(line.x0 - posologyHeader.x) <= tolerance &&
              Math.abs(line.x1 - dispatchHeader.x) <= tolerance;
          });
          var hasDispatchCell = group.lines.some(function (line) {
            return Math.abs(line.x0 - dispatchHeader.x) <= tolerance && line.x1 - line.x0 >= 50;
          });
          return hasContinuousTableLine || hasJoinedTableLine ||
            hasMedicationCell && hasPosologyCell && hasDispatchCell;
        })
        .map(function (group) { return group.y; });
      timestamps.forEach(function (timestamp) {
        var upperStructural = structuralBoundaries
          .filter(function (candidateY) { return candidateY > timestamp.y + 2; })
          .sort(function (a, b) { return a - b; })[0];
        var upperTableBoundary = tableBoundaryYs
          .filter(function (candidateY) { return candidateY > timestamp.y + 2; })
          .sort(function (a, b) { return a - b; })[0];
        var lowerBoundary = tableBoundaryYs
          // In the horizontal-only Jasper variant the timestamp baseline can sit less than
          // two PDF points above its row border. Keep a small half-point separation so the
          // real lower border is retained without accepting a line crossing the timestamp.
          .filter(function (candidateY) { return candidateY < timestamp.y - 0.5; })
          .sort(function (a, b) { return b - a; })[0];
        // Jasper draws the lower border of every medication row. Those real table lines,
        // not timestamp midpoints, keep independently wrapped rows from crossing owners.
        // A continued page may omit only the first row's top border; its nearest official
        // metadata label is then the outer cap, while the lower border remains mandatory.
        var upperBoundary = [upperTableBoundary, upperStructural]
          .filter(Number.isFinite)
          .sort(function (a, b) { return a - b; })[0];
        if (!Number.isFinite(upperBoundary) || !Number.isFinite(lowerBoundary) ||
            upperBoundary <= timestamp.y || lowerBoundary >= timestamp.y ||
            upperBoundary - lowerBoundary > 120) {
          extractionComplete = false;
          return;
        }
        // Never compact a row whose inferred bounds include patient/header/footer metadata.
        // A false horizontal boundary must fail closed to the untouched official PDF.
        var containsStructuralMetadata = pageItems.some(function (item) {
          return item.y > lowerBoundary && item.y < upperBoundary &&
            rowStructuralPattern.test(normalizedPdfText(item.text));
        });
        if (containsStructuralMetadata) {
          extractionComplete = false;
          return;
        }
        var medicationParts = pageItems
          .filter(function (item) {
            return item.x < 300 && item.y > lowerBoundary && item.y < upperBoundary;
          })
          .filter(function (item) {
            var value = normalizedPdfText(item.text);
            return !/^(Medicamento|Diagnóstico\(s\):)$/i.test(value) &&
              !/^\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}$/.test(value);
          })
          .sort(function (a, b) { return b.y - a.y || a.x - b.x; })
          .map(function (item) { return normalizedPdfText(item.text); })
          .filter(Boolean);
        var indicationParts = pageItems
          .filter(function (item) {
            return item.x >= 300 && item.x < dispatchColumnX &&
              item.y > lowerBoundary && item.y < upperBoundary;
          })
          .sort(function (a, b) { return b.y - a.y || a.x - b.x; })
          .map(function (item) { return normalizedPdfText(item.text); })
          .filter(Boolean);
        var dispatchParts = pageItems
          .filter(function (item) {
            return item.x >= dispatchColumnX && item.y > lowerBoundary && item.y < upperBoundary;
          })
          .sort(function (a, b) { return b.y - a.y || a.x - b.x; })
          .map(function (item) { return normalizedPdfText(item.text); })
          .filter(Boolean);
        var dispatchText = dispatchParts.join(' ');
        if (/^P[aá]gina\s+\d+\s+de\s+\d+$/i.test(dispatchText)) dispatchText = '';
        if (!medicationParts.length) return;
        medications.push({
          medication: medicationParts.join(' '),
          posology: indicationParts.join(' '),
          dispatch: dispatchText,
          route: '',
          note: '',
          date: '',
          dateTime: normalizedPdfText(timestamp.text),
        });
      });
    });
    if (!extractionComplete || !diagnosisLabel ||
        !recognizedTimestampCount ||
        medications.length !== recognizedTimestampCount ||
        medications.some(function (medication) {
          return !/\bv[ií]a\b/i.test(medication.medication + ' ' + medication.posology) ||
            !normalizedPdfText(medication.posology);
        })) {
      return null;
    }
    var extracted = {
      patient: {
        name: sameRowValue(firstPage, 'Nombres:'),
        run: sameRowValue(firstPage, 'RUN:'),
        sex: sameRowValue(firstPage, 'Sexo:'),
        age: sameRowValue(firstPage, 'Edad:'),
        bed: sameRowValue(firstPage, 'Cama:'),
        room: sameRowValue(firstPage, 'Sala:'),
        service: sameRowValue(firstPage, 'Servicio:'),
        diagnosis: diagnosis,
      },
      professional: sameRowValue(lastPage, 'Prescriptor:'),
      professionalRun: sameRowValue(lastPage, 'RUN:', { last: true }),
      prescriptionDate: sameRowValue(lastPage, 'Fecha:'),
      printedBy: sameRowValue(lastPage, 'Impreso por'),
      address: sameRowValue(firstPage, 'Dirección'),
      emissionDateTime: metadata.emissionDateTime,
      folio: metadata.folio,
      medications: medications,
    };
    var requiredValues = [
      extracted.patient.name,
      extracted.patient.run,
      extracted.patient.sex,
      extracted.patient.age,
      extracted.patient.bed,
      extracted.patient.room,
      extracted.patient.service,
      extracted.professional,
      extracted.professionalRun,
      extracted.prescriptionDate,
      extracted.printedBy,
      extracted.address,
      extracted.emissionDateTime,
      extracted.folio,
    ];
    return requiredValues.every(function (value) { return normalizedPdfText(value); })
      ? extracted
      : null;
  };

  var extractOfficialPrescriptionMetadata = async function (buffer) {
    var streams = await inflatePdfStreams(buffer);
    var pages = pdfTextItems(streams);
    var firstPage = pages[0] || [];
    var values = [];
    streams.forEach(function (stream) {
      var expression = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
      var match;
      while ((match = expression.exec(stream))) values.push(decodePdfLiteral(match[1]));
    });
    var joined = values.join('\n');
    var folio = (joined.match(/Folio:\s*([A-Z0-9-]+)/i) || [])[1] || '';
    var emissionDateTime = [
      'Fecha emisión',
      'Fecha emisión:',
      'Fecha impresión',
      'Fecha impresión:',
    ].reduce(function (value, label) {
      return value || sameRowValue(firstPage, label);
    }, '');
    var prescriberIndex = values.findIndex(function (item) { return /^Prescriptor:\s*$/i.test(item.trim()); });
    var professional = '';
    var professionalRun = '';
    if (prescriberIndex >= 0) {
      for (var i = prescriberIndex + 1; i < values.length; i += 1) {
        var candidate = values[i].trim();
        if (!candidate || /^(RUN:|Fecha:|FIRMA|Pagina|Impreso por)/i.test(candidate)) continue;
        if (!professional) {
          professional = candidate.replace(/\s+/g, ' ').trim();
          continue;
        }
        if (/^[0-9.]+-[0-9K]$/i.test(candidate)) {
          professionalRun = formatRun(candidate);
          break;
        }
      }
    }
    return {
      folio: folio,
      emissionDateTime: normalizedPdfText(emissionDateTime),
      professional: professional,
      professionalRun: professionalRun,
    };
  };

  var extractOfficialEpicrisisLayout = async function (buffer) {
    var streams = await inflatePdfStreams(buffer);
    var pages = pdfTextItems(streams);
    if (!pages.length) return null;
    var normalize = function (value) {
      return normalizedPdfText(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
    };
    var recipePageIndex = -1;
    var recipeTitle = null;
    for (var pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      var candidate = pages[pageIndex].find(function (item) {
        return normalize(item.text) === 'RECETA DE ALTA';
      });
      if (candidate) {
        recipePageIndex = pageIndex;
        recipeTitle = candidate;
        break;
      }
    }
    if (recipePageIndex < 0 || !recipeTitle) return null;
    var headerDate = pages[recipePageIndex].find(function (item) {
      return /^Fecha Ingreso:?$/i.test(normalizedPdfText(item.text));
    });
    var titleItems = pages.map(function (items) {
      return items.find(function (item) { return normalize(item.text) === 'EPICRISIS'; }) || null;
    });
    if (!headerDate || !titleItems[recipePageIndex]) return null;
    var headerBottomY = Math.max(0, headerDate.y - 22);
    // Keep this boundary tight: the last free-text discharge indication can otherwise be
    // mistaken for recipe content because Jasper places it immediately above the title.
    var recipeTopY = recipeTitle.y + 3;
    var pageItems = pages[recipePageIndex];
    var isPageNumber = function (item) {
      return /^P[aá]g\.?(?:ina)?\s*\d+\s*(?:de|\/)?\s*\d+$/i.test(normalizedPdfText(item.text));
    };
    var partFromPage = function (items, lowerY, upperY) {
      var safeItems = (Array.isArray(items) ? items : []).filter(function (item) {
        return item.y >= lowerY && item.y <= upperY && !isPageNumber(item);
      });
      var safeLines = (Array.isArray(items && items.horizontalLines) ? items.horizontalLines : [])
        .filter(function (line) { return line.y >= lowerY && line.y <= upperY; });
      return {
        items: safeItems.map(function (item) { return { x: item.x, y: item.y, text: item.text }; }),
        lines: safeLines.map(function (line) { return { x0: line.x0, x1: line.x1, y: line.y }; }),
      };
    };
    var recipeParts = [partFromPage(pageItems, 48, recipeTopY)];
    var control = null;
    for (var continuationIndex = recipePageIndex + 1; continuationIndex < pages.length; continuationIndex += 1) {
      var continuationItems = pages[continuationIndex];
      var continuationDate = continuationItems.find(function (item) {
        return /^Fecha Ingreso:?$/i.test(normalizedPdfText(item.text));
      });
      var continuationHeaderBottom = continuationDate ? continuationDate.y - 22 : Number.POSITIVE_INFINITY;
      var controlTitle = continuationItems.find(function (item) {
        return normalize(item.text) === 'PROXIMO CONTROL';
      });
      var continuationLowerBound = controlTitle ? controlTitle.y + 3 : 48;
      var continuationPart = partFromPage(
        continuationItems,
        continuationLowerBound,
        continuationHeaderBottom
      );
      if (continuationPart.items.length || continuationPart.lines.length) recipeParts.push(continuationPart);
      if (controlTitle) {
        control = {
          pageIndex: continuationIndex,
          headerItems: continuationItems.filter(function (item) {
            return item.y >= continuationHeaderBottom && !isPageNumber(item);
          }).map(function (item) { return { x: item.x, y: item.y, text: item.text }; }),
          items: partFromPage(continuationItems, 48, controlTitle.y + 3).items,
          lines: partFromPage(continuationItems, 48, controlTitle.y + 3).lines,
        };
        break;
      }
    }
    if (recipeParts.length > 1 && !control) return null;
    return {
      pageCount: pages.length,
      recipePageIndex: recipePageIndex,
      recipeTitleY: recipeTitle.y,
      headerBottomY: headerBottomY,
      headerItems: pageItems.filter(function (item) {
        return item.y >= headerBottomY && !isPageNumber(item);
      }).map(function (item) { return { x: item.x, y: item.y, text: item.text }; }),
      recipeParts: recipeParts,
      control: control,
      titleItems: titleItems.map(function (item) {
        return item ? { x: item.x, y: item.y } : null;
      }),
    };
  };

  var derivePrescriptionDates = function (events) {
    var byDate = new Map();
    for (var i = 0; i < (Array.isArray(events) ? events.length : 0); i += 1) {
      var event = events[i] || {};
      var rows = Array.isArray(event.patientPharmaIndicationResume)
        ? event.patientPharmaIndicationResume
        : [];
      for (var j = 0; j < rows.length; j += 1) {
        var row = rows[j] || {};
        if (row.ARCHIVED === true || String(row.ARCHIVED).toLowerCase() === 'true') continue;
        var date = toIsoDate(row.PUBLISH_DATETIME || event.publishDatetime);
        if (!date) continue;
        var current = byDate.get(date) || { date: date, count: 0, prescribers: new Set() };
        current.count += 1;
        var prescriber = String(row.HCP_NAME || '').trim();
        if (prescriber) current.prescribers.add(prescriber);
        byDate.set(date, current);
      }
    }
    return Array.from(byDate.values())
      .map(function (item) {
        return {
          date: item.date,
          label: formatDateLabel(item.date),
          count: item.count,
          prescribers: Array.from(item.prescribers).sort(),
        };
      })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
  };

  var buildClinicalReportUrl = function (apiOrigin, reportName, encId, hcpId, patientId, date) {
    var safeEncounter = /^\d+$/.test(String(encId || '')) ? String(encId) : '';
    var safePractitioner = /^\d+$/.test(String(hcpId || '')) ? String(hcpId) : '';
    var safePatient = /^\d+$/.test(String(patientId || '')) ? String(patientId) : '';
    var safeReport = /^[A-Za-z0-9_-]+\.pdf$/.test(String(reportName || '')) ? String(reportName) : '';
    if (!safeEncounter || !safePractitioner || !safePatient || !safeReport) return '';
    var origin;
    try {
      origin = new URL(String(apiOrigin || '')).origin;
    } catch (_error) {
      return '';
    }
    var url = new URL('/api/report/' + safeReport, origin);
    url.searchParams.set('enc_id', safeEncounter);
    url.searchParams.set('hcp_id', safePractitioner);
    url.searchParams.set('pat_id', safePatient);
    var safeDate = toIsoDate(date);
    if (safeDate) url.searchParams.set('fecha', safeDate);
    return url.toString();
  };

  var buildPrescriptionReportUrl = function (apiOrigin, encId, hcpId, patientId) {
    return buildClinicalReportUrl(
      apiOrigin,
      PRESCRIPTION_REPORT_FILE,
      encId,
      hcpId,
      patientId,
      ''
    );
  };

  var buildIndicationsReportUrl = function (apiOrigin, encId, hcpId, patientId) {
    return buildClinicalReportUrl(
      apiOrigin,
      INDICATIONS_REPORT_FILE,
      encId,
      hcpId,
      patientId,
      ''
    );
  };

  var buildRegimenReportUrl = function (apiOrigin, facilityId) {
    var safeFacility = /^\d+$/.test(String(facilityId || '')) ? String(facilityId) : '';
    if (!safeFacility) return '';
    var origin;
    try {
      origin = new URL(String(apiOrigin || '')).origin;
    } catch (_error) {
      return '';
    }
    var url = new URL('/api/report/' + REGIMEN_REPORT_FILE, origin);
    url.searchParams.set('fac_id', safeFacility);
    return url.toString();
  };

  var deriveScaleHistory = function (events, forms, scaleName) {
    var candidates = [];
    var isArchived = function (value) { return isTrueFlag(value); };
    var scalePattern = /downton/i.test(String(scaleName || '')) ? /downton/i : /braden/i;
    var isRequestedScale = function (value) { return scalePattern.test(String(value || '')); };
    var rowLabel = function (row) { return String(row && (row.LABEL || row.label || row.id) || ''); };
    var rowValue = function (row) {
      if (!row) return '';
      var value = row.VALUE != null ? row.VALUE : row.value != null ? row.value : row.valueName;
      return value == null ? '' : String(value).trim();
    };
    var findTotal = function (rows) {
      return rows.find(function (row) {
        var label = rowLabel(row);
        return /(^|_)puntaje$/i.test(label.trim()) || /^puntaje$/i.test(label.trim());
      });
    };
    var findSeverity = function (rows) {
      return rows.find(function (row) {
        return /severidad|resultadoscore/i.test(rowLabel(row));
      });
    };
    var addCandidate = function (rows, dateTime, author, source, tieBreaker) {
      var activeRows = (Array.isArray(rows) ? rows : []).filter(function (row) {
        return row && !isArchived(row.ARCHIVED || row.archived);
      });
      var totalRow = findTotal(activeRows);
      var totalText = rowValue(totalRow).replace(',', '.');
      var total = totalText === '' ? NaN : Number(totalText);
      if (!Number.isFinite(total)) return;
      var severityRow = findSeverity(activeRows);
      candidates.push({
        total: total,
        severity: String(
          severityRow && (severityRow.VALUE_NAME || severityRow.valueName || severityRow.VALUE || severityRow.value) || ''
        ).trim(),
        dateTime: normalizeClinicalDateTime(dateTime),
        author: normalizedAuthor(author),
        source: source,
        tieBreaker: Number(tieBreaker) || 0,
        eventId: /^\d+$/.test(String(tieBreaker || '')) ? String(tieBreaker) : '',
      });
    };

    for (var i = 0; i < (Array.isArray(events) ? events.length : 0); i += 1) {
      var event = events[i] || {};
      var eventRows = (Array.isArray(event.evaluationInstrumentsResume)
        ? event.evaluationInstrumentsResume
        : []).filter(function (row) { return row && isRequestedScale(row.FORM_NAME); });
      if (eventRows.length === 0) continue;
      var eventAuthorRow = eventRows.find(function (row) { return row.PUBLISH_DATE_HCP_NAME; }) || {};
      addCandidate(
        eventRows,
        event.publishDatetime,
        eventAuthorRow.PUBLISH_DATE_HCP_NAME || eventAuthorRow.HCP_NAME,
        'history',
        event.encounterEventId || event.id
      );
    }

    for (var j = 0; j < (Array.isArray(forms) ? forms.length : 0); j += 1) {
      var form = forms[j] || {};
      if (!isRequestedScale(form.nameForm || form.FORM_NAME)) continue;
      if (isArchived(form.archived || form.ARCHIVED) || isTrueFlag(form.deleted || form.DELETED)) continue;
      var formRows = Array.isArray(form.metaCampList) ? form.metaCampList : [];
      var formTotal = findTotal(formRows) || {};
      addCandidate(
        formRows,
        formTotal.createDatetime || form.createDateTime || form.startDateTime,
        form.authorHealthCarePractitionerName,
        'form',
        form.encounterEventId
      );
    }

    candidates.sort(function (a, b) {
      return b.dateTime.localeCompare(a.dateTime) || b.tieBreaker - a.tieBreaker;
    });
    var unique = [];
    candidates.forEach(function (candidate) {
      // History and form-summary endpoints can expose the same encounter event with
      // different timezone notation. Prefer the shared event id; otherwise compare
      // the clinical wall time so an offset-only difference does not duplicate it.
      var wallDateTime = String(candidate.dateTime || '').slice(0, 19);
      var currentIndex = unique.findIndex(function (existing) {
        if (candidate.eventId && existing.eventId) return candidate.eventId === existing.eventId;
        var sameWallTime = wallDateTime && wallDateTime === String(existing.dateTime || '').slice(0, 19);
        if (!sameWallTime || candidate.total !== existing.total) return false;
        var compatibleSeverity = !candidate.severity || !existing.severity ||
          candidate.severity === existing.severity;
        var compatibleAuthor = !candidate.author || !existing.author ||
          authorKey(candidate.author) === authorKey(existing.author);
        return compatibleSeverity && compatibleAuthor;
      });
      var current = currentIndex >= 0 ? unique[currentIndex] : null;
      var completeness = Number(Boolean(candidate.severity)) + Number(Boolean(candidate.author));
      var currentCompleteness = current
        ? Number(Boolean(current.severity)) + Number(Boolean(current.author))
        : -1;
      if (!current) {
        unique.push(candidate);
      } else if (candidate.source === 'history' || current.source === 'history') {
        var authoritative = candidate.source === 'history' ? candidate : current;
        var complement = authoritative === candidate ? current : candidate;
        unique[currentIndex] = {
          ...authoritative,
          severity: authoritative.severity || complement.severity,
          author: authoritative.author || complement.author,
          eventId: authoritative.eventId || complement.eventId,
        };
      } else if (completeness > currentCompleteness) {
        unique[currentIndex] = candidate;
      }
    });
    return unique
      .sort(function (a, b) {
        return b.dateTime.localeCompare(a.dateTime) || b.tieBreaker - a.tieBreaker;
      })
      .map(function (candidate) {
        return {
          total: candidate.total,
          severity: candidate.severity,
          dateTime: candidate.dateTime,
          author: candidate.author,
          source: candidate.source,
        };
      });
  };

  var deriveLatestBraden = function (events, forms) {
    return deriveScaleHistory(events, forms, 'BRADEN')[0] || null;
  };

  var deriveLatestNutritionOrder = function (entry) {
    var rows = Array.isArray(entry) ? entry : entry && typeof entry === 'object' ? [entry] : [];
    var active = rows
      .filter(function (row) {
        return row && !isTrueFlag(row.archived || row.ARCHIVED) && !isTrueFlag(row.deleted || row.DELETED);
      })
      .map(function (row) {
        return {
          diet: String(row.dietName || row.DIET_type || row.dietType || '').trim(),
          observation: String(row.observation || row.OBSERVATION || '').replace(/\s+/g, ' ').trim(),
          dateTime: normalizeClinicalDateTime(
            row.startDateTime || row.PUBLISH_DATETIME || row.createDateTime || ''
          ),
          author: normalizedAuthor(
            row.authorHealthCarePractitionerName || row.HCP_LEGAL || row.HCPR_NAME || ''
          ),
          id: String(row.guid || row.id || row.encounterEventId || ''),
        };
      })
      .filter(function (row) { return row.diet; })
      .sort(function (a, b) { return b.dateTime.localeCompare(a.dateTime); });
    return active[0] || null;
  };

  var resolveHandoffKind = function (role, practitionerRoleId) {
    var roleName = String(role || '').trim();
    var normalizedRole = roleName.toLowerCase().replace(/\s+/g, ' ');
    var nameKind = /^(m[eé]dico|m[eé]dico cirujano|cirujano)$/.test(normalizedRole)
      ? 'medical'
      : /^enfermer(?:a|o|a\(o\)|o\(a\))?$/.test(normalizedRole)
        ? 'nursing'
        : '';
    var rawRoleId = String(practitionerRoleId == null ? '' : practitionerRoleId).trim();
    var roleId = Number(rawRoleId);
    var idKind = roleId === 1 ? 'medical' : roleId === 2 ? 'nursing' : '';
    if (rawRoleId) return idKind && (!roleName || nameKind === idKind) ? idKind : '';
    return nameKind;
  };

  var handoffEncounterEventTypeId = function (kind) {
    if (kind === 'medical') return 1;
    if (kind === 'nursing') return 2;
    return 0;
  };

  var handoffLabelForIdentity = function (role, practitionerRoleId) {
    var kind = resolveHandoffKind(role, practitionerRoleId);
    return kind === 'nursing'
      ? 'Entrega de turno de enfermería'
      : kind === 'medical'
        ? 'Entrega de turno médica'
        : 'Entrega de turno según rol clínico';
  };

  var cudyrSourceNotice = function (response) {
    var result = response && typeof response === 'object' ? response : {};
    var warning = String(result.cudyrWarning || '').trim();
    var base = result.cudyrUnavailableReason
      ? String(result.cudyrUnavailableReason)
      : result.cudyrSource === 'gestion_camas+ficha_medico'
        ? 'CUDYR desde Gestión de Camas cuando existe historial oficial; los pacientes ausentes se completan con el último valor de Ficha Médico.'
        : result.cudyrHistoryAvailable
          ? 'CUDYR desde la Lista de trabajo de Gestión de Camas: categoría, fecha/hora, autor e historial oficial.'
          : 'CUDYR en modo de respaldo desde Ficha Médico: solo está disponible el último valor.' +
            (warning ? '' : ' Conecta Gestión de Camas para ver el historial oficial.');
    return [base, warning].filter(Boolean).join(' ');
  };

  var shiftChangeKind = function (row) {
    if (!row || typeof row !== 'object') return '';
    var rawEventTypeId = row.encounterEventTypeId;
    if (rawEventTypeId !== undefined && rawEventTypeId !== null && String(rawEventTypeId).trim()) {
      var eventTypeId = Number(rawEventTypeId);
      if (eventTypeId === 1) return 'medical';
      if (eventTypeId === 2) return 'nursing';
      return '';
    }
    var roleName = row.authorHealthCarePractitionerRoleName || row.healthCarePractitionerRoleName ||
      row.HCPR_NAME || row.roleName || '';
    var roleId = row.authorHealthCarePractitionerRoleId || row.healthCarePractitionerRoleId ||
      row.HCPR_ID || row.roleId || '';
    return resolveHandoffKind(roleName, roleId);
  };

  var entryMatchesHandoffKind = function (row, kind) {
    if (!kind) return true;
    return shiftChangeKind(row) === kind;
  };

  var deriveLatestShiftChange = function (entries, options) {
    var rows = Array.isArray(entries) ? entries : entries && typeof entries === 'object' ? [entries] : [];
    var kind = options && options.kind || 'nursing';
    var active = rows
      .filter(function (row) {
        return row && entryMatchesHandoffKind(row, kind) &&
          !isTrueFlag(row.archived || row.ARCHIVED) && !isTrueFlag(row.deleted || row.DELETED);
      })
      .map(function (row) {
        return {
          id: String(row.id || ''),
          guid: String(row.guid || ''),
          encounterEventId: String(row.encounterEventId || ''),
          observation: String(row.observation || row.OBSERVATION || '').replace(/\s+/g, ' ').trim(),
          dateTime: normalizeClinicalDateTime(
            row.startDateTime || row.PUBLISH_DATETIME || row.createDateTime || ''
          ),
          author: normalizedAuthor(
            row.authorHealthCarePractitionerName || row.HCP_LEGAL || row.HCP_NAME || ''
          ),
          authorRole: String(
            row.authorHealthCarePractitionerRoleName || row.healthCarePractitionerRoleName ||
              row.HCPR_NAME || ''
          ).replace(/\s+/g, ' ').trim(),
          handoffKind: shiftChangeKind(row),
          isSigned: isTrueFlag(row.isSigned),
          requiresValidation: isTrueFlag(row.requiresValidation),
        };
      })
      .filter(function (row) { return row.observation; })
      .sort(function (a, b) {
        return b.dateTime.localeCompare(a.dateTime) || Number(b.id || 0) - Number(a.id || 0);
      });
    return active[0] || null;
  };

  var calculateCudyrCategory = function (fields) {
    var rows = Array.isArray(fields) ? fields : [];
    var dependency = rows
      .filter(function (row) { return Number(row.typeId) === 1; })
      .reduce(function (sum, row) { return sum + Number(row.value || 0); }, 0);
    var risk = rows
      .filter(function (row) { return Number(row.typeId) === 2; })
      .reduce(function (sum, row) { return sum + Number(row.value || 0); }, 0);
    var dependencyClass = dependency <= 6 ? 3 : dependency <= 12 ? 2 : 1;
    var riskClass = risk <= 5 ? 'D' : risk <= 11 ? 'C' : risk <= 18 ? 'B' : 'A';
    return {
      dependency: dependency,
      risk: risk,
      value: riskClass + dependencyClass,
    };
  };

  var buildPrescriptionFilename = function (encId, professional, printFormat) {
    var safeEncounter = /^\d+$/.test(String(encId || '')) ? String(encId) : 'episodio';
    return 'Receta_medica_' + safeEncounter + '_' +
      (professional ? authorKey(professional) : 'vigente') +
      (printFormat === 'compact' ? '_compacta' : '') + '.pdf';
  };

  var activeHospitalizedEncounters = function (snapshot) {
    var encounters = snapshot && Array.isArray(snapshot.encounters) ? snapshot.encounters : [];
    return encounters
      .filter(function (encounter) {
        return encounter && /^\d+$/.test(String(encounter.encounterId || '')) &&
          !encounter.hasMedicalDischarge && !encounter.dischargeDatetime && !encounter.isDead;
      })
      .map(function (encounter) {
        var name = [
          encounter.firstGivenName,
          encounter.nextGivenNames,
          encounter.firstFamilyName,
          encounter.secondFamilyName,
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        return {
          encounterId: String(encounter.encounterId),
          name: name || 'Paciente sin nombre',
          run: String(encounter.run || '').trim(),
          service: String(encounter.service || '').trim(),
          room: String(encounter.room || '').trim(),
          bed: String(encounter.bed || '').trim(),
          birthDate: String(encounter.birthDate || '').trim(),
          administrativeSexId: String(encounter.administrativeSexId || '').trim(),
          hospitalDepartmentId: String(encounter.hospitalDepartmentId || '').trim(),
          nurseStationId: String(encounter.nurseStationId || '').trim(),
          patientId: String(encounter.patientId || '').trim(),
        };
      })
      .sort(function (a, b) {
        return a.service.localeCompare(b.service) || a.room.localeCompare(b.room) ||
          a.bed.localeCompare(b.bed, undefined, { numeric: true }) || a.name.localeCompare(b.name);
      });
  };

  var buildHospitalizedPrescriptionSummary = function (patient, groups, currentEncounterId) {
    var safeGroups = Array.isArray(groups) ? groups : [];
    var prescribers = safeGroups.map(function (group) {
      return {
        professional: normalizedAuthor(group.professional) || 'Profesional no informado',
        professionalRun: formatRun(group.professionalRun || ''),
        count: Number(group.count) || 0,
        validationDateTime: toDateTime(group.validationDateTime || group.latestDateTime),
      };
    });
    return {
      encounterId: String(patient && patient.encounterId || ''),
      name: String(patient && patient.name || 'Paciente sin nombre'),
      run: String(patient && patient.run || ''),
      service: String(patient && patient.service || ''),
      room: String(patient && patient.room || ''),
      bed: String(patient && patient.bed || ''),
      medicationCount: prescribers.reduce(function (sum, item) { return sum + item.count; }, 0),
      prescribers: prescribers,
      isCurrent: String(patient && patient.encounterId || '') === String(currentEncounterId || ''),
    };
  };

  var isPrescriptionBatchSessionValid = function (batch, sessionKey, now) {
    if (!batch || !sessionKey || String(batch.sessionKey || '') !== String(sessionKey)) return false;
    var expiresAt = Number(batch.expiresAt || 0);
    return !(expiresAt > 0 && Number(now == null ? Date.now() : now) >= expiresAt);
  };

  var buildBatchPrescriptionFilename = function (count, printFormat, date) {
    var safeCount = Math.max(1, Number(count) || 1);
    var safeDate = toIsoDate(date) || new Date().toISOString().slice(0, 10);
    return 'Recetas_hospitalizados_' + safeDate + '_' + safeCount + '_pacientes' +
      (printFormat === 'compact' ? '_compactas' : '') + '.pdf';
  };

  var buildBatchIndicationsFilename = function (count, date) {
    var safeCount = Math.max(1, Number(count) || 1);
    var safeDate = toIsoDate(date) || new Date().toISOString().slice(0, 10);
    return 'Indicaciones_hospitalizados_' + safeDate + '_' + safeCount + '_pacientes.pdf';
  };

  var buildRegimenFilename = function (date) {
    var safeDate = toIsoDate(date) || new Date().toISOString().slice(0, 10);
    return 'Regimenes_hospitalizados_BRADEN_' + safeDate + '.pdf';
  };

  var api = {
    INDICATIONS_REPORT_FILE: INDICATIONS_REPORT_FILE,
    PRESCRIPTION_REPORT_FILE: PRESCRIPTION_REPORT_FILE,
    REGIMEN_REPORT_FILE: REGIMEN_REPORT_FILE,
    resolveNursingEncounterId: resolveNursingEncounterId,
    resolveEncounterId: resolveEncounterId,
    isNursingRouteUrl: isNursingRouteUrl,
    toIsoDate: toIsoDate,
    toDateTime: toDateTime,
    formatDateLabel: formatDateLabel,
    formatDateTimeLabel: formatDateTimeLabel,
    formatAgeLabel: formatAgeLabel,
    formatRun: formatRun,
    derivePrescriptionDates: derivePrescriptionDates,
    deriveProfessionalPrescriptionGroups: deriveProfessionalPrescriptionGroups,
    applyCurrentMedicationMetadata: applyCurrentMedicationMetadata,
    deriveExternalPrescriptionGroups: deriveExternalPrescriptionGroups,
    applyProfessionalValidationDates: applyProfessionalValidationDates,
    extractOfficialPrescriptionMetadata: extractOfficialPrescriptionMetadata,
    extractOfficialPrescriptionContent: extractOfficialPrescriptionContent,
    extractOfficialEpicrisisLayout: extractOfficialEpicrisisLayout,
    buildClinicalReportUrl: buildClinicalReportUrl,
    buildPrescriptionReportUrl: buildPrescriptionReportUrl,
    buildIndicationsReportUrl: buildIndicationsReportUrl,
    buildRegimenReportUrl: buildRegimenReportUrl,
    deriveScaleHistory: deriveScaleHistory,
    deriveLatestBraden: deriveLatestBraden,
    deriveLatestNutritionOrder: deriveLatestNutritionOrder,
    resolveHandoffKind: resolveHandoffKind,
    handoffLabelForIdentity: handoffLabelForIdentity,
    cudyrSourceNotice: cudyrSourceNotice,
    handoffEncounterEventTypeId: handoffEncounterEventTypeId,
    entryMatchesHandoffKind: entryMatchesHandoffKind,
    deriveLatestShiftChange: deriveLatestShiftChange,
    calculateCudyrCategory: calculateCudyrCategory,
    buildPrescriptionFilename: buildPrescriptionFilename,
    activeHospitalizedEncounters: activeHospitalizedEncounters,
    buildHospitalizedPrescriptionSummary: buildHospitalizedPrescriptionSummary,
    isPrescriptionBatchSessionValid: isPrescriptionBatchSessionValid,
    buildBatchPrescriptionFilename: buildBatchPrescriptionFilename,
    buildBatchIndicationsFilename: buildBatchIndicationsFilename,
    buildRegimenFilename: buildRegimenFilename,
  };

  root.HhrPrescriptionPrint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);

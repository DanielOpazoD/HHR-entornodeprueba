/**
 * audit-documents-runtime.js (extension — importScripts in the SW, require() in tests)
 *
 * Downloads, for a short list of RUNs, the official Eloísa reports an audit asks for: the
 * hospitalization history («Historial hospitalizaciones paciente») and the pharmacological care
 * report («Reporte de cuidados farmacológicos y otros»), one PDF per hospitalization, in one ZIP.
 *
 * The PDFs go straight from Eloísa to the Downloads folder: HHR only sends the list and receives
 * counts. Eloísa's own session decides what the person may read. A list that could not be read is
 * reported as a failure for that RUN, never as «sin hospitalizaciones».
 */
(function (root) {
  'use strict';

  const MAX_PATIENTS = 20;
  const MAX_DOCUMENTS = 100;
  const CONCURRENCY = 2;
  const RUN_IDENTIFIER_TYPE = 2;
  const CANCELLED_MESSAGE = 'Descarga para auditoría cancelada desde HHR.';
  const PROGRESS_MESSAGE_TYPE = 'RAYEN_AUDIT_DOCUMENTS_PROGRESS';
  const FILE_CHUNK_MESSAGE_TYPE = 'RAYEN_AUDIT_DOCUMENTS_FILE_CHUNK';
  /** Data URLs of several MB are unreliable in Chrome; the ZIP travels in parts to the HHR tab. */
  const FILE_CHUNK_BYTES = 4 * 1024 * 1024;
  const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
  /**
   * Measured 2026-11-02: Eloísa's report server answered HTTP 500 to 5 of the first 6 histories of
   * a 17-RUT run, all long stays, and then served stays as long as those. A later, one-at-a-time
   * attempt is what recovers them.
   */
  const RETRY_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 3000;
  const isRetryable = result =>
    !result.buffer && !result.fatal && !result.permanent && (result.status == null || result.status >= 500);

  const DOCUMENT_TYPES = Object.freeze({
    history: Object.freeze({
      label: 'Historial hospitalizacion',
      summary: 'Historial de hospitalización',
      reportPath: 'GetHospitalizedEncounterHistory',
    }),
    pharmacological: Object.freeze({
      label: 'Cuidados farmacologicos',
      summary: 'Reporte de cuidados farmacológicos y otros',
      reportPath: 'GetPharmacologicalCareController',
    }),
  });

  /** Both report indexes are read: the history index omits a hospitalization still in course. */
  const ENCOUNTER_INDEXES = Object.freeze([
    'getEncounterHistoryReport',
    'getPharmacologicalCareReport',
  ]);

  // Only dots, dashes and spaces are dropped: a passport such as «P1234567» never becomes a RUN.
  const normalizeRun = value => String(value == null ? '' : value).toUpperCase().replace(/[.\s-]/g, '');
  const runVerifier = body => {
    let sum = 0;
    let factor = 2;
    for (let i = body.length - 1; i >= 0; i -= 1) {
      sum += Number(body[i]) * factor;
      factor = factor === 7 ? 2 : factor + 1;
    }
    const rest = 11 - (sum % 11);
    return rest === 11 ? '0' : rest === 10 ? 'K' : String(rest);
  };
  const isValidRun = run =>
    /^[0-9]{6,8}[0-9K]$/.test(run) && runVerifier(run.slice(0, -1)) === run.slice(-1);
  const displayRun = run => run.slice(0, -1) + '-' + run.slice(-1);
  const isIsoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const isEncounter = value => /^\d+$/.test(String(value == null ? '' : value));

  const hospitalParts = instant => {
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Easter', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).forEach(part => { parts[part.type] = part.value; });
    return {
      year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
      hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    };
  };
  const pad = value => String(value).padStart(2, '0');
  const hospitalDateOf = parts => `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;

  /** Eloísa periods carry their offset; the hospital day is read in Rapa Nui time (TIME-02). */
  const hospitalDate = value => {
    const text = String(value || '').trim();
    if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text)) return '';
    const instant = Date.parse(text);
    return Number.isFinite(instant) ? hospitalDateOf(hospitalParts(instant)) : '';
  };

  const asciiText = value => String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const isComplete = day => day.dailySummary && day.annex;
  const daySuffix = day => {
    if (isComplete(day)) return `${day.day} con resumen diario y anexo HHR`;
    if (day.dailySummary) return `${day.day} solo resumen diario`;
    if (day.annex) return `${day.day} solo anexo HHR`;
    return `sin ${day.day}`;
  };

  const buildFileName = ({ patientName, run, documentType, startDate, reconstructedDays }) => {
    const name = asciiText(patientName).slice(0, 80) || 'Sin nombre';
    const days = reconstructedDays && reconstructedDays.length ? ` - ${reconstructedDays.map(daySuffix).join(' - ')}` : '';
    return `${name} - ${displayRun(run)} - ${DOCUMENT_TYPES[documentType].label} - ingreso ${startDate}${days}.pdf`;
  };

  const dayNote = day => {
    const parts = [
      day.dailySummary ? 'el Resumen diario oficial de Eloísa' : `sin el Resumen diario (${day.dailySummaryError})`,
      day.annex ? `un anexo HHR no oficial con ${day.annexRecords} registro(s) de Ficha Médico` : `sin anexo HHR (${day.annexError})`,
    ];
    return `el ${day.day}${day.unserved ? ' (Eloísa no entregó su historial)' : ''} va con ${parts.join(' y ')}`;
  };

  const downloadedNote = document => {
    const days = document.reconstructedDays || [];
    if (!days.length) return 'Descargado';
    const why = days.some(day => day.unserved)
      ? 'Eloísa no entregó el historial oficial de algunos días'
      : 'Eloísa no genera el historial oficial del día del cambio de hora';
    return `Descargado en tramos: ${why}; ` + days.map(dayNote).join('; ');
  };

  const overlapsRange = ({ startDate, endDate }, { dateFrom, dateTo }) =>
    (!dateFrom || endDate >= dateFrom) && (!dateTo || startDate <= dateTo);

  const csvCell = value => {
    const raw = String(value == null ? '' : value);
    // A leading = + - @ would run as a formula when the summary is opened in a spreadsheet.
    const text = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
    return /[;"\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };

  // The top-level preferredIdentifierCode may only echo the query parameter, so it proves nothing.
  const ROW_IDENTIFIERS = row => [
    row.patientIdentifier, row.identifier,
    row.patient && row.patient.identifier, row.patient && row.patient.preferredIdentifierCode,
  ];

  /** 'match', 'other' (another person) or 'unknown' (Eloísa gave nothing to check against). */
  const rowIdentity = (row, run) => {
    // A newborn listed under the mother's RUN is a different person (ID-03).
    const type = row.patientIdentifierTypeId;
    if (type != null && type !== '' && Number(type) !== RUN_IDENTIFIER_TYPE) return 'other';
    const identifiers = ROW_IDENTIFIERS(row)
      .filter(value => value != null && String(value).trim())
      .map(normalizeRun);
    if (identifiers.length === 0) return 'unknown';
    // Any identifier that names someone else wins over one that matches.
    return identifiers.every(identifier => identifier === run) ? 'match' : 'other';
  };

  const validatePatient = (raw, seen) => {
    const run = normalizeRun(raw && raw.run);
    if (!isValidRun(run)) return { error: 'Uno de los RUT no es válido.' };
    if (seen.has(run)) return { error: 'La lista repite un RUT.' };
    seen.add(run);
    const dateFrom = raw.dateFrom ? String(raw.dateFrom) : '';
    const dateTo = raw.dateTo ? String(raw.dateTo) : '';
    if ((dateFrom && !isIsoDate(dateFrom)) || (dateTo && !isIsoDate(dateTo))) {
      return { error: 'Una de las fechas no es válida.' };
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return { error: 'Una fecha «desde» es posterior a su fecha «hasta».' };
    }
    return { patient: { run, dateFrom, dateTo } };
  };

  const validateRequest = request => {
    const rawPatients = Array.isArray(request && request.patients) ? request.patients : [];
    if (rawPatients.length === 0) return { error: 'Ingresa al menos un RUT.' };
    if (rawPatients.length > MAX_PATIENTS) {
      return { error: `Se pueden pedir como máximo ${MAX_PATIENTS} RUT por descarga.` };
    }
    const seen = new Set();
    const patients = [];
    for (const raw of rawPatients) {
      const checked = validatePatient(raw, seen);
      if (checked.error) return checked;
      patients.push(checked.patient);
    }
    const documentTypes = Array.from(new Set(
      Array.isArray(request.documentTypes) ? request.documentTypes : []
    ));
    if (documentTypes.length === 0 || documentTypes.some(type => !DOCUMENT_TYPES[type])) {
      return { error: 'Elige al menos un tipo de documento.' };
    }
    return { patients, documentTypes };
  };

  const REQUIRED_FUNCTIONS = Object.freeze([
    'getFetchInfo', 'fetchWithTimeout', 'fetchOfficialPdf', 'mapWithConcurrency', 'bufferToBase64',
    'now', 'isHhrTabUrl',
  ]);
  const hasDependencies = deps => Boolean(deps) &&
    REQUIRED_FUNCTIONS.every(name => typeof deps[name] === 'function') &&
    Boolean(deps.chromeApi && deps.chromeApi.tabs && typeof deps.chromeApi.tabs.sendMessage === 'function') &&
    Boolean(deps.zipWriter && typeof deps.zipWriter.build === 'function') &&
    Boolean(deps.historySegments && typeof deps.historySegments.segmentsAround === 'function') &&
    Boolean(deps.historyReconstruction && typeof deps.historyReconstruction.create === 'function');

  const create = dependencies => {
    const {
      chromeApi, getFetchInfo, fetchWithTimeout, fetchOfficialPdf, mapWithConcurrency,
      bufferToBase64, zipWriter, now, isHhrTabUrl, historySegments, historyReconstruction, dayAnnex, pdfLib,
      getJsPDF, retryDelayMs = RETRY_DELAY_MS,
    } = dependencies || {};
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    if (!hasDependencies(dependencies)) {
      throw new Error('No se pudo inicializar la descarga de documentos para auditoría.');
    }
    const reconstruction = historyReconstruction.create({ fetchOfficialPdf, fetchWithTimeout, pdfLib, getJsPDF, dayAnnex, historySegments });

    /** The exact requesting document: if the tab navigated meanwhile, the parts go nowhere. */
    const deliveryTarget = sender => ({
      tabId: sender && sender.tab ? sender.tab.id : undefined,
      options: {
        ...(typeof sender.frameId === 'number' ? { frameId: sender.frameId } : {}),
        ...(typeof sender.documentId === 'string' ? { documentId: sender.documentId } : {}),
      },
    });

    const sendPart = async (target, message) => {
      const reply = await chromeApi.tabs.sendMessage(target.tabId, message, target.options);
      if (!reply || reply.ok !== true) throw new Error((reply && reply.error) || 'la pestaña no confirmó');
    };

    /** The relay of the requesting HHR tab joins the parts and saves the ZIP as a Blob. */
    const deliverZip = async ({ sender, requestId, bytes, filename, isCancelled }) => {
      const target = deliveryTarget(sender);
      if (target.tabId == null) return { error: 'No se encontró la pestaña de HHR que pidió el ZIP.' };
      const total = Math.ceil(bytes.length / FILE_CHUNK_BYTES);
      try {
        for (let index = 0; index < total; index += 1) {
          // The last part saves the file, so a cancel that arrives meanwhile must stop before it.
          if (isCancelled()) {
            if (index > 0) {
              await sendPart(target, { type: FILE_CHUNK_MESSAGE_TYPE, requestId, discard: true })
                .catch(() => undefined);
            }
            return { cancelled: true };
          }
          const part = bytes.subarray(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES);
          await sendPart(target, {
            type: FILE_CHUNK_MESSAGE_TYPE, requestId, index, total, filename,
            base64: bufferToBase64(part),
          });
        }
        return { ok: true };
      } catch (error) {
        return { error: 'No se pudo guardar el ZIP en HHR: ' + String((error && error.message) || error) };
      }
    };

    /** Counts only. Each message also keeps the worker awake during a long download. */
    const progressReporter = sender => {
      const tabId = sender && sender.tab && sender.tab.id;
      return progress => {
        if (tabId == null) return;
        Promise.resolve(chromeApi.tabs.sendMessage(tabId, { type: PROGRESS_MESSAGE_TYPE, ...progress }))
          .catch(() => undefined);
      };
    };

    const cancelled = new Set();
    let running = null;

    const readIndex = async (info, run, indexPath) => {
      const url = new URL('/api/inpatientReport/' + indexPath, info.apiOrigin);
      url.searchParams.set('prefferedPeridentId', String(RUN_IDENTIFIER_TYPE));
      url.searchParams.set('prefferedIdentifierCode', run);
      url.searchParams.set('facilityId', String(info.facId));
      url.searchParams.set('dateFrom', '');
      url.searchParams.set('dateTo', '');
      try {
        const response = await fetchWithTimeout(url.toString(), {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) {
          return { fatal: true, error: 'Eloísa no autorizó la búsqueda de informes para la sesión actual.' };
        }
        if (!response.ok) return { error: 'Eloísa respondió HTTP ' + response.status + ' al buscar las hospitalizaciones.' };
        const payload = await response.json();
        if (!Array.isArray(payload)) return { error: 'Eloísa entregó una lista de hospitalizaciones no válida.' };
        return { rows: payload };
      } catch (error) {
        return { error: 'No se pudo consultar Eloísa: ' + String((error && error.message) || error) };
      }
    };

    const listEncounters = async (info, patient, today) => {
      const indexes = await Promise.all(ENCOUNTER_INDEXES.map(path => readIndex(info, patient.run, path)));
      const failed = indexes.find(index => index.error);
      if (failed) return failed;
      const byEncounter = new Map();
      const unknownIdentity = new Set();
      indexes.forEach(index => index.rows.forEach(row => {
        if (!row || !isEncounter(row.encounterId) || row.deleted === true) return;
        const identity = rowIdentity(row, patient.run);
        const encId = String(row.encounterId);
        if (identity === 'unknown') unknownIdentity.add(encId);
        if (identity === 'match' && !byEncounter.has(encId)) byEncounter.set(encId, row);
      }));
      const encounters = [];
      let unverified = [...unknownIdentity].filter(encId => !byEncounter.has(encId)).length;
      byEncounter.forEach((row, encId) => {
        const startDate = hospitalDate(row.startPeriod);
        const endDate = hospitalDate(row.endPeriod);
        // A date Eloísa gave but that cannot be read is reported, never guessed.
        if (!startDate || (row.endPeriod && !endDate)) {
          unverified += 1;
          return;
        }
        if (!overlapsRange({ startDate, endDate: endDate || today }, patient)) return;
        encounters.push({
          encId,
          startDate,
          endDate,
          startPeriod: String(row.startPeriod),
          endPeriod: row.endPeriod ? String(row.endPeriod) : '',
          facilityId: isEncounter(row.facilityId) ? String(row.facilityId) : String(info.facId),
          patientName: typeof row.patientName === 'string' ? row.patientName.trim() : '',
        });
      });
      encounters.sort((left, right) => left.startDate.localeCompare(right.startDate));
      return { encounters, unverified };
    };

    const reportUrl = (info, documentType, encounter, nowIso) => {
      const url = new URL('/api/reportServer/' + DOCUMENT_TYPES[documentType].reportPath, info.apiOrigin);
      url.searchParams.set('enc_id', encounter.encId);
      if (documentType === 'history') {
        url.searchParams.set('start_date', encounter.startPeriod);
        url.searchParams.set('end_date', encounter.endPeriod || nowIso);
      } else {
        url.searchParams.set('fac_id', encounter.facilityId);
      }
      return url.toString();
    };

    const uniqueName = (name, used) => {
      let candidate = name;
      for (let copy = 2; used.has(candidate.toLowerCase()); copy += 1) {
        candidate = name.replace(/\.pdf$/, ` (${copy}).pdf`);
      }
      used.add(candidate.toLowerCase());
      return candidate;
    };

    const summaryCsv = (patients, documents) => {
      const lines = [['RUT', 'Nombre', 'Ingreso', 'Egreso', 'Documento', 'Resultado', 'Archivo']];
      patients.forEach(patient => {
        const run = displayRun(patient.run);
        if (patient.error) {
          lines.push([run, '', '', '', '', 'No se pudo consultar Eloísa: ' + patient.error, '']);
          return;
        }
        if (patient.unverified) {
          lines.push([run, patient.name, '', '', '', `${patient.unverified} hospitalización(es) que Eloísa entregó sin fecha o RUT verificable. Revisar en Eloísa`, '']);
        }
        const own = documents.filter(document => document.run === patient.run);
        if (own.length === 0 && !patient.unverified) {
          lines.push([run, patient.name, '', '', '', 'Sin hospitalizaciones en el periodo', '']);
        }
        own.forEach(document => lines.push([
          run, document.patientName, document.startDate, document.endDate || 'En curso',
          DOCUMENT_TYPES[document.documentType].summary,
          document.error ? 'No descargado: ' + document.error : downloadedNote(document),
          document.fileName || '',
        ]));
      });
      const text = '﻿' + lines.map(line => line.map(csvCell).join(';')).join('\r\n') + '\r\n';
      return new TextEncoder().encode(text);
    };

    const publicSummary = (patients, documents) => patients.map(patient => {
      const own = documents.filter(document => document.run === patient.run);
      return {
        run: patient.run,
        name: patient.name,
        ...(patient.error ? { error: patient.error } : {}),
        hospitalizations: new Set(own.map(document => document.encId)).size,
        unverified: patient.unverified || 0,
        downloaded: own.filter(document => document.buffer).length,
        reconstructed: own.filter(document => document.buffer && document.reconstructedDays &&
          document.reconstructedDays.every(isComplete)).length,
        incomplete: own.filter(document => document.buffer && document.reconstructedDays &&
          !document.reconstructedDays.every(isComplete)).length,
        failed: own.filter(document => document.error).length,
      };
    });

    const listPatients = async (job, patients) => {
      let listed = 0;
      job.progress('listing', 0, patients.length);
      return mapWithConcurrency(patients, CONCURRENCY, async patient => {
        if (job.isCancelled()) return { ...patient, encounters: [] };
        const result = await listEncounters(job.info, patient, job.today);
        listed += 1;
        job.progress('listing', listed, patients.length);
        if (result.error) return { ...patient, fatal: result.fatal === true, error: result.error, encounters: [] };
        const named = result.encounters.find(encounter => encounter.patientName);
        return { ...patient, name: named ? named.patientName : '', encounters: result.encounters, unverified: result.unverified };
      });
    };

    const planDocuments = (patients, documentTypes) => patients.flatMap(patient =>
      patient.encounters.flatMap(encounter => documentTypes.map(documentType => ({
        run: patient.run, documentType, ...encounter,
        patientName: encounter.patientName || patient.name,
      }))));

    /** Explains why nothing will be downloaded, or '' when the plan can go ahead. */
    const planProblem = (patients, planned) => {
      if (planned.length > MAX_DOCUMENTS) {
        return `La búsqueda reúne ${planned.length} documentos y el máximo por descarga es ${MAX_DOCUMENTS}. ` +
          'Acota las fechas o divide la lista de RUT.';
      }
      if (planned.length > 0) return '';
      const unread = patients.filter(patient => patient.error).length;
      if (unread === patients.length) return 'No se pudo consultar Eloísa. No se descargó nada.';
      return unread
        ? 'No se descargó nada: Eloísa no respondió por algunos RUT y los demás no tienen hospitalizaciones en las fechas pedidas.'
        : 'No hay hospitalizaciones en las fechas pedidas. No se descargó nada.';
    };

    const fetchReport = (job, item, url) => fetchOfficialPdf({
      url,
      token: job.info.token,
      label: 'el informe ' + DOCUMENT_TYPES[item.documentType].summary.toLowerCase(),
    });

    const fetchDocument = async (job, item) => {
      const result = await fetchReport(job, item, reportUrl(job.info, item.documentType, item, job.nowIso));
      if (result.buffer || item.documentType !== 'history' || !isRetryable(result)) return result;
      const split = historySegments.segmentsAround({ start: item.startPeriod, end: item.endPeriod || job.nowIso });
      if (!split.skipped.length) return result;
      return reconstruction.reconstruct({
        info: job.info, item, split, nowMs: job.startedAt, keepAlive: job.keepAlive,
        patient: { name: item.patientName, run: displayRun(item.run), encId: item.encId },
      });
    };

    const downloadDocuments = async (job, planned) => {
      let downloaded = 0;
      let sessionError = '';
      job.progress('downloading', 0, planned.length);
      const documents = await mapWithConcurrency(planned, CONCURRENCY, async item => {
        if (job.isCancelled() || sessionError) return { ...item, error: 'No se intentó.' };
        const result = await fetchDocument(job, item);
        downloaded += 1;
        job.progress('downloading', downloaded, planned.length);
        if (result.fatal) sessionError = result.error;
        return result.buffer
          ? { ...item, buffer: result.buffer, ...(result.days ? { reconstructedDays: result.days } : {}) }
          : { ...item, error: result.error || 'Falló la descarga.', retryable: isRetryable(result) };
      });
      return { documents, sessionError };
    };

    /** Tries one document again, after a pause; returns the session error that stops the run. */
    const retryDocument = async (job, document) => {
      let attempts = 1;
      while (attempts <= RETRY_ATTEMPTS && !job.isCancelled()) {
        await wait(retryDelayMs * attempts);
        attempts += 1;
        const result = await fetchDocument(job, document);
        if (result.fatal) return result.error;
        if (result.buffer) {
          document.buffer = result.buffer;
          if (result.days) document.reconstructedDays = result.days;
          delete document.error;
          return '';
        }
        document.error = result.error || 'Falló la descarga.';
        if (!isRetryable(result)) break;
      }
      document.error += ` (${attempts} intentos)`;
      return '';
    };

    /** Server errors are retried at the end, one at a time, so a busy report server can recover. */
    const retryDocuments = async (job, documents) => {
      const pending = documents.filter(document => document.retryable);
      job.progress('retrying', 0, pending.length);
      for (let index = 0; index < pending.length && !job.isCancelled(); index += 1) {
        const sessionError = await retryDocument(job, pending[index]);
        if (sessionError) return sessionError;
        job.progress('retrying', index + 1, pending.length);
      }
      return '';
    };

    const packArchive = (job, patients, documents) => {
      const ready = documents.filter(document => document.buffer);
      if (ready.length === 0) return { error: 'Eloísa no entregó ninguno de los documentos. No se descargó nada.' };
      if (ready.reduce((sum, document) => sum + document.buffer.byteLength, 0) > MAX_ARCHIVE_BYTES) {
        return { error: 'Los documentos superan 200 MB. Acota las fechas o divide la lista de RUT.' };
      }
      job.progress('packing', ready.length, documents.length);
      const used = new Set(['00 resumen.csv']);
      ready.forEach(document => { document.fileName = uniqueName(buildFileName(document), used); });
      const stamp = hospitalParts(job.startedAt);
      try {
        const bytes = zipWriter.build([
          { name: '00 Resumen.csv', data: summaryCsv(patients, documents) },
          ...ready.map(document => ({ name: document.fileName, data: new Uint8Array(document.buffer) })),
        ], stamp);
        const filename = `Auditoria_Eloisa_${hospitalDateOf(stamp)}_${pad(stamp.hour)}${pad(stamp.minute)}.zip`;
        return { bytes, filename, documentCount: ready.length };
      } catch (error) {
        return { error: 'No se pudo armar el ZIP: ' + String((error && error.message) || error) };
      }
    };

    const startJob = async (requestId, reportProgress) => {
      const infoResult = await getFetchInfo();
      if (infoResult.error) return { error: infoResult.error };
      const info = infoResult.info;
      if (!info || !info.apiOrigin || !info.token || !isEncounter(info.facId)) {
        return { error: 'La sesión de Eloísa no permite consultar informes de hospitalización.' };
      }
      const startedAt = now();
      let lastProgress = null;
      const send = progress => { try { reportProgress({ requestId, ...progress }); } catch (_error) {} };
      return {
        info, startedAt,
        today: hospitalDateOf(hospitalParts(startedAt)),
        nowIso: new Date(startedAt).toISOString(),
        isCancelled: () => cancelled.has(requestId),
        progress: (phase, done, total) => {
          lastProgress = { phase, done, total };
          send(lastProgress);
        },
        // Repeats the last progress, so HHR keeps waiting while one document takes many requests.
        keepAlive: () => { if (lastProgress) send(lastProgress); },
      };
    };

    const execute = async (requestId, validated, sender, reportProgress) => {
      const cancelledResult = { cancelled: true, error: CANCELLED_MESSAGE };
      const job = await startJob(requestId, reportProgress);
      if (job.error) return job;

      const patients = await listPatients(job, validated.patients);
      if (job.isCancelled()) return cancelledResult;
      const fatal = patients.find(patient => patient.fatal);
      if (fatal) return { error: fatal.error };
      const planned = planDocuments(patients, validated.documentTypes);
      const problem = planProblem(patients, planned);
      if (problem) return { summary: publicSummary(patients, planned), error: problem };

      const { documents, sessionError } = await downloadDocuments(job, planned);
      if (job.isCancelled()) return cancelledResult;
      if (sessionError) return { error: sessionError + ' No se descargó el ZIP.' };
      if (documents.some(document => document.retryable)) {
        const retryError = await retryDocuments(job, documents);
        if (job.isCancelled()) return cancelledResult;
        if (retryError) return { error: retryError + ' No se descargó el ZIP.' };
      }
      const archive = packArchive(job, patients, documents);
      if (archive.error) return { summary: publicSummary(patients, documents), error: archive.error };
      if (job.isCancelled()) return cancelledResult;
      const saved = await deliverZip({
        sender, requestId, bytes: archive.bytes, filename: archive.filename, isCancelled: job.isCancelled,
      });
      if (saved.cancelled) return cancelledResult;
      if (saved.error) return { error: saved.error };
      return {
        ok: true,
        filename: archive.filename,
        documentCount: archive.documentCount,
        failedCount: documents.length - archive.documentCount,
        documentTypes: validated.documentTypes,
        summary: publicSummary(patients, documents),
      };
    };

    /** One audit download at a time: several people share the same computer and Eloísa session. */
    const handleRequest = async ({ requestId, patients, documentTypes, sender }) => {
      if (typeof requestId !== 'string' || !requestId) return { error: 'La solicitud no es válida.' };
      // Only an HHR tab may ask for a bulk export, and the ZIP goes back to that same tab.
      if (!sender || !sender.tab || !isHhrTabUrl(String(sender.tab.url || ''))) {
        return { error: 'La descarga para auditoría solo se puede pedir desde HHR.' };
      }
      if (running) {
        return {
          error: cancelled.has(running)
            ? 'La descarga anterior se está deteniendo. Vuelve a intentarlo en unos segundos.'
            : 'Ya hay una descarga para auditoría en curso. Espera a que termine.',
        };
      }
      const validated = validateRequest({ patients, documentTypes });
      if (validated.error) return { error: validated.error };
      running = requestId;
      try {
        return await execute(requestId, validated, sender, progressReporter(sender));
      } finally {
        running = null;
        cancelled.delete(requestId);
      }
    };

    const cancel = requestId => {
      if (typeof requestId !== 'string' || !requestId) return { ok: false };
      if (running === requestId) cancelled.add(requestId);
      return { ok: true };
    };

    /** A change of HHR session stops the download of the previous person. */
    const cancelAll = () => {
      if (running) cancelled.add(running);
      return { ok: true };
    };

    return Object.freeze({ handleRequest, cancel, cancelAll });
  };

  const api = Object.freeze({
    CANCELLED_MESSAGE, FILE_CHUNK_BYTES, FILE_CHUNK_MESSAGE_TYPE, MAX_DOCUMENTS, MAX_PATIENTS,
    PROGRESS_MESSAGE_TYPE,
    buildFileName, create, hospitalDate, overlapsRange, validateRequest,
  });
  root.HhrAuditDocumentsRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);

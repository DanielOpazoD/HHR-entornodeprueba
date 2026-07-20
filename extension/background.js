/**
 * background.js  (MV3 service worker)
 *
 * Routes messages from an HHR tab to the right Rayen tab and returns the result. The tabs
 * cannot message each other directly.
 *   - RAYEN_SNAPSHOT_REQUEST      → Ficha Médico tab (reads the census snapshot)
 *   - RAYEN_EGRESO_LOOKUP_REQUEST → Gestión de Camas tab (looks up egresos by RUN)
 *   - RAYEN_EGRESO_REPORT_REQUEST → downloads the bulk "Alta Administrativa" report .xls here
 *     in the background (host_permissions bypass CORS, which a page/content fetch cannot), using
 *     the token the Gestión de Camas tab hands over, PARSES it (vendored SheetJS) and returns
 *     clean egreso rows as JSON for HHR to enumerate.
 *   - RAYEN_EGRESO_REPORT_SAVE    → same fetch, but saves the .xls to disk (diagnostic).
 */
'use strict';

// Manifest V3 classic service workers may call importScripts only during their initial
// evaluation. Register every PDF/XLS dependency here; runtime-loader.js then acts as a readiness
// guard for the workflows that use them instead of attempting a forbidden late import.
importScripts(
  'message-contract.js',
  'encounter-navigation.js',
  'hhr-request-forms.js',
  'health-check.js',
  'fichamedico-transport-runtime.js',
  'fichamedico-clinical-client.js',
  'fichamedico-patient-context.js',
  'gestion-camas-session.js',
  'gestion-camas-runtime.js',
  'gestion-camas-egreso-lookup.js', 'gestion-camas-clinical-cribs.js',
  'gestion-camas-discharge-report-runtime.js',
  'gestion-camas-cudyr.js',
  'clinical-panel-fetch.js',
  'clinical-panel-runtime.js',
  'clinical-write-recovery-policy.js', 'clinical-write-runtime.js',
  'clinical-handoff-runtime.js',
  'clinical-score-runtime.js',
  'clinical-score-write-model.js',
  'clinical-score-write-runtime.js',
  'hospitalization-reports-runtime.js',
  'epicrisis-download-runtime.js',
  'clinical-report-runtime.js',
  'clinical-batch-print-runtime.js',
  'prescription-print.js',
  'lab-viewer.js',
  'syslab-runtime.js',
  'exam-request-print.js',
  'xlsx.full.min.js',
  'report-parser.js',
  'jspdf.umd.min.js',
  'pdf-lib.min.js',
  'prescription-pdf.js',
  'epicrisis-pdf.js',
  'exam-request-pdf.js',
  'pdf-print.js',
  'runtime-loader.js',
);
if (!self.HhrClinicalWriteRecoveryPolicy || !self.HhrClinicalWriteRuntime || typeof self.HhrClinicalWriteRuntime.create !== 'function') {
  throw new Error('No se pudo cargar el runtime de escrituras clínicas.');
}
if (!self.HhrGestionCamasEgresoLookup) {
  throw new Error('No se pudo cargar la política de verificación de egresos.');
}
if (!self.HhrGestionCamasClinicalCribs) throw new Error('No se pudo cargar el mapeo de cunas clínicas.');
if (
  !self.HhrGestionCamasDischargeReportRuntime ||
  typeof self.HhrGestionCamasDischargeReportRuntime.create !== 'function'
) {
  throw new Error('No se pudo cargar el runtime del informe estadístico de egreso.');
}
if (!self.HhrClinicalHandoffRuntime || typeof self.HhrClinicalHandoffRuntime.create !== 'function') {
  throw new Error('No se pudo cargar el runtime clínico de entrega de turno.');
}
if (!self.HhrClinicalPanelRuntime || typeof self.HhrClinicalPanelRuntime.create !== 'function') {
  throw new Error('No se pudo cargar el runtime de lectura del panel clínico.');
}
if (!self.HhrClinicalReportRuntime || typeof self.HhrClinicalReportRuntime.create !== 'function') {
  throw new Error('No se pudo cargar el runtime de informes clínicos.');
}
if (
  !self.HhrClinicalBatchPrintRuntime ||
  typeof self.HhrClinicalBatchPrintRuntime.create !== 'function'
) {
  throw new Error('No se pudo cargar el runtime batch de documentos hospitalizados.');
}
if (!self.HhrClinicalScoreRuntime || typeof self.HhrClinicalScoreRuntime.create !== 'function') {
  throw new Error('No se pudo cargar el runtime de lectura de Scores.');
}
if (
  !self.HhrClinicalScoreWriteModel ||
  !self.HhrClinicalScoreWriteRuntime ||
  typeof self.HhrClinicalScoreWriteRuntime.create !== 'function'
) {
  throw new Error('No se pudo cargar el runtime de escritura de Scores.');
}
if (
  !self.HhrFichaMedicoTransportRuntime ||
  typeof self.HhrFichaMedicoTransportRuntime.create !== 'function'
) {
  throw new Error('No se pudo cargar el runtime de transporte de Ficha Médico.');
}
if (
  !self.HhrFichaMedicoClinicalClient ||
  typeof self.HhrFichaMedicoClinicalClient.create !== 'function'
) {
  throw new Error('No se pudo cargar el cliente clínico de lectura de Ficha Médico.');
}
if (
  !self.HhrFichaMedicoPatientContext ||
  typeof self.HhrFichaMedicoPatientContext.create !== 'function'
) {
  throw new Error('No se pudo cargar el contexto clínico de pacientes de Ficha Médico.');
}

const messageContract = self.HhrRayenMessageContract;
const RUNTIME_MESSAGES = messageContract.types;

const REPORT_FILE = 'Lista_Pacientes_Alta_Administrativa_Rango_Fecha.xls';
const EXTENSION_PROTOCOL_VERSION = 3;
const BACKEND_REQUEST_TIMEOUT_MS = 45_000;
const TAB_MESSAGE_TIMEOUT_MS = 50_000;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
const CLINICAL_PANEL_REQUEST_TIMEOUT_MS = 15_000;

const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  Promise.resolve(promise).then(
    value => {
      clearTimeout(timeout);
      resolve(value);
    },
    error => {
      clearTimeout(timeout);
      reject(error);
    }
  );
});

const fetchWithTimeout = async (
  url,
  options,
  timeoutMs = BACKEND_REQUEST_TIMEOUT_MS,
  timeoutMessage = 'Tiempo de espera agotado consultando Eloísa. Reintenta la operación.'
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const fichaMedicoTransportRuntime = self.HhrFichaMedicoTransportRuntime.create({
  chrome,
  extensionHealth: self.HhrExtensionHealth,
  encounterNavigation: self.HhrEncounterNavigation,
  withTimeout,
  tabMessageTimeoutMs: TAB_MESSAGE_TIMEOUT_MS,
  healthProbeTimeoutMs: HEALTH_PROBE_TIMEOUT_MS,
});
const {
  sendToMatchingTab,
  handleSnapshotRequest,
  handleOpenEncounter,
  health: handleFichaMedicoHealth,
  getFetchInfo: getFichaFetchInfo,
} = fichaMedicoTransportRuntime;

const fichaMedicoClinicalClient = self.HhrFichaMedicoClinicalClient.create({
  resolveFetchInfo: getFichaFetchInfo,
  fetchWithTimeout,
  defaultTimeoutMs: BACKEND_REQUEST_TIMEOUT_MS,
});

const {
  nursingWorklists: fichaMedicoNursingWorklists,
  resolveSession: resolveFichaClinicalSession,
  fetchDeviceReportBuffer,
  fetchScalesReportWithInfo,
  fetchHistoryScales,
  fetchPrescriptionEvents,
  fetchCurrentMedicationEntries,
  fetchEvaluationForms,
  fetchScaleHistoryEvents,
  fetchNutritionOrderEntry,
  fetchTreatmentValidation,
  fetchPatientHeader,
  fetchActiveEncounterRows,
} = fichaMedicoClinicalClient;

const fichaMedicoPatientContext = self.HhrFichaMedicoPatientContext.create({
  crypto,
  TextEncoder,
  resolveSession: resolveFichaClinicalSession,
  fetchPatientHeader,
  fetchActiveEncounterRows,
  fetchScalesReportWithInfo,
  prescriptionPrint: self.HhrPrescriptionPrint,
  warn: (...args) => console.warn(...args),
  now: () => Date.now(),
});

const {
  mapWithConcurrency,
  fichaSessionCacheKey,
  getClinicalReportContext,
  fetchActiveHospitalizedPatients,
  verifyEncounterStillHospitalized,
  verifySelectedEncountersStillHospitalized,
  handlePatientHeaderRequest,
  handleCensusListRequest,
  handleVitalsCensusRequest,
} = fichaMedicoPatientContext;

const gestionCamasRuntime = self.HhrGestionCamasRuntime.create({
  chrome,
  session: self.HhrGestionCamasSession,
  extensionHealth: self.HhrExtensionHealth,
  withTimeout,
  fetchWithTimeout,
  backendRequestTimeoutMs: BACKEND_REQUEST_TIMEOUT_MS,
  tabMessageTimeoutMs: TAB_MESSAGE_TIMEOUT_MS,
  healthProbeTimeoutMs: HEALTH_PROBE_TIMEOUT_MS,
});

const {
  markSessionVerified: markGestionCamasSessionVerified,
  captureSession: captureGestionCamasSession,
  handleDocumentReady: handleGestionCamasDocumentReady,
  resolveSession: resolveGestionCamasSession,
  classifyRejection: classifyGestionCamasRejection,
  health: handleGestionCamasHealth,
  connect: handleConnectGestionCamas,
  disconnect: handleDisconnectGestionCamas,
} = gestionCamasRuntime;

const handleExtensionHealth = async () => {
  const [fichaMedico, gestionCamas] = await Promise.all([
    handleFichaMedicoHealth(),
    handleGestionCamasHealth(),
  ]);

  return {
    version: chrome.runtime.getManifest().version,
    protocolVersion: EXTENSION_PROTOCOL_VERSION,
    checkedAt: new Date().toISOString(),
    fichaMedico,
    gestionCamas,
  };
};

const handleEgresoLookup = async (runs, targets) => {
  const session = await resolveGestionCamasSession();
  if (!session.record) {
    return { error: session.error || 'Conecta Gestión de Camas para consultar egresos.' };
  }
  const record = session.record;
  if (!record.facId) return { error: 'Gestión de Camas no informó el establecimiento.' };
  const results = [];
  for (const target of self.HhrGestionCamasEgresoLookup.normalizeTargets(runs, targets)) {
    const { run, encounterId } = target;
    const url =
      `${record.apiBase}/facility/${record.facId}/encounter` +
      `?facId=0&prefferedIdentifierCode=${encodeURIComponent(run)}&prefferedPeridentId=2`;
    try {
      const response = await fetchWithTimeout(url, { headers: { Authorization: record.token } });
      if (!response.ok) {
        const rejection = await classifyGestionCamasRejection(response, record);
        results.push({
          run,
          error: rejection === 'changed'
            ? 'La sesión cambió durante la consulta. Reintenta la operación.'
            : rejection === 'expired'
            ? 'La sesión de Gestión de Camas venció. Vuelve a conectarla.'
            : rejection === 'forbidden'
              ? 'Gestión de Camas rechazó esta consulta por permisos.'
            : 'HTTP ' + response.status,
        });
        if (rejection === 'expired' || rejection === 'changed') break;
        continue;
      }
      const payload = await response.json();
      const verified = await markGestionCamasSessionVerified(record);
      if (!verified) {
        results.push({
          run,
          error: 'La sesión cambió durante la consulta. Reintenta la operación.',
        });
        break;
      }
      const item = self.HhrGestionCamasEgresoLookup.selectEncounter(payload, encounterId);
      results.push({
        run,
        encounterId,
        egreso: item ? self.HhrGestionCamasEgresoLookup.pickMetadata(item) : null,
      });
    } catch (error) {
      results.push({ run, error: String((error && error.message) || error) });
    }
  }
  return { results };
};

// Base64-encode an ArrayBuffer in chunks (btoa chokes on huge apply() arg lists).
const bufferToBase64 = buffer => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const base64ToArrayBuffer = value => {
  const text = String(value || '').replace(/\s/g, '');
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('El PDF de alta recibido no es válido.');
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

// Fetch the report .xls bytes for a date range. Dates are ISO (YYYY-MM-DD); the server's params
// are fac_id / start_datetime / end_datetime (confirmed live — the older FAC_ID/DATE_START/
// DATE_END form silently returns an EMPTY report). Token + API base come from the open Gestión de
// Camas tab; the GET runs here in the background, where host_permissions bypass the CORS that
// blocks a page fetch.
const fetchReportBuffer = async ({ dateStart, dateEnd }) => {
  if (!dateStart || !dateEnd) return { error: 'Faltan fechas para el reporte.' };
  const session = await resolveGestionCamasSession();
  if (!session.record) return { error: session.error || 'Conecta Gestión de Camas y reintenta.' };
  const info = session.record;
  const url =
    `${info.apiBase}/report/${REPORT_FILE}` +
    `?fac_id=${encodeURIComponent(info.facId)}` +
    `&start_datetime=${encodeURIComponent(dateStart)}&end_datetime=${encodeURIComponent(dateEnd)}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: info.token } });
    if (!res.ok) {
      const rejection = await classifyGestionCamasRejection(res, info);
      return {
        error: rejection === 'changed'
          ? 'La sesión cambió durante la descarga. Reintenta la operación.'
          : rejection === 'expired'
          ? 'La sesión de Gestión de Camas venció. Vuelve a conectarla.'
          : rejection === 'forbidden'
            ? 'La sesión es válida, pero no tiene permiso para descargar este reporte.'
          : 'El servidor de reportes respondió HTTP ' + res.status + '.',
      };
    }
    const buffer = await res.arrayBuffer();
    const verified = await markGestionCamasSessionVerified(info);
    if (!verified) {
      return { error: 'La sesión cambió durante la descarga. Reintenta la operación.' };
    }
    return { buffer };
  } catch (error) {
    return { error: 'Falló la descarga del reporte: ' + String((error && error.message) || error) };
  }
};

// Fetch + parse the report into clean egreso rows (RUN, nombre, cama, destino, fecha egreso…).
const handleReportRequest = async args => {
  const result = await fetchReportBuffer(args);
  if (result.error) return { error: result.error };
  try {
    self.HhrExtensionRuntime.ensureSpreadsheet();
    const rows = self.RayenReportParser.parseWorkbook(self.XLSX, new Uint8Array(result.buffer));
    return { ok: true, rows, count: rows.length };
  } catch (error) {
    return { error: 'No se pudo parsear el reporte: ' + String((error && error.message) || error) };
  }
};

// Save the report .xls to disk via chrome.downloads (data URL) and return the resolved path.
// Diagnostic / manual-export path — the sync itself uses the parsed-rows path above.
const handleReportSave = async args => {
  const result = await fetchReportBuffer(args);
  if (result.error) return { error: result.error };
  const dataUrl = 'data:application/vnd.ms-excel;base64,' + bufferToBase64(result.buffer);
  const filename = `Alta_Administrativa_${args.dateStart}_${args.dateEnd}.xls`;
  try {
    const id = await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
      conflictAction: 'overwrite',
    });
    const path = await new Promise(resolve => {
      const poll = () =>
        chrome.downloads.search({ id }, items => {
          const item = items && items[0];
          if (item && (item.state === 'complete' || item.state === 'interrupted')) resolve(item.filename);
          else setTimeout(poll, 200);
        });
      poll();
    });
    return { ok: true, id, path, length: result.buffer.byteLength };
  } catch (error) {
    return { error: 'No se pudo guardar el reporte: ' + String((error && error.message) || error) };
  }
};

// Fetch + return the device-report PDF as base64 (for HHR to parse) plus size/first bytes so a
// diagnostic can confirm the fetch without dumping the whole blob.
const handleDeviceReportRequest = async args => {
  const result = await fetchDeviceReportBuffer(args);
  if (result.error) return { error: result.error };
  const bytes = new Uint8Array(result.buffer);
  const firstHex = Array.from(bytes.slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  return {
    ok: true,
    length: result.buffer.byteLength,
    firstHex,
    base64: bufferToBase64(result.buffer),
  };
};

// Diagnostic / de-risk: save the device-report PDF to disk and return the resolved path.
const handleDeviceReportSave = async args => {
  const result = await fetchDeviceReportBuffer(args);
  if (result.error) return { error: result.error };
  const dataUrl = 'data:application/pdf;base64,' + bufferToBase64(result.buffer);
  const filename = `Resumen_diario_${args.encId}_${args.fecha}.pdf`;
  try {
    const id = await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
      conflictAction: 'overwrite',
    });
    const path = await new Promise(resolve => {
      const poll = () =>
        chrome.downloads.search({ id }, items => {
          const item = items && items[0];
          if (item && (item.state === 'complete' || item.state === 'interrupted')) resolve(item.filename);
          else setTimeout(poll, 200);
        });
      poll();
    });
    return { ok: true, id, path, length: result.buffer.byteLength };
  } catch (error) {
    return { error: 'No se pudo guardar el PDF: ' + String((error && error.message) || error) };
  }
};

// Fetch one patient's clinical forms from Ficha Médico's encounter-form-entry endpoint. The trailing
// `0` (formCodigo) segment returns ALL forms; we keep only the ones HHR uses — INSTRUMENTO (Braden UPP
// / Downton scales) and VITAL_SIGNS (latest vitals: PA, FC, SatO2, Temp, FR, EVA) — to stay lean. The
// practitionerId is the logged-in viewer (from the list URL).
const handleScalesReportRequest = async ({ encId, sender }) => {
  const infoResult = await resolveFichaClinicalSession({ sender });
  if (infoResult.error) return { error: infoResult.error };
  return fetchScalesReportWithInfo(encId, infoResult.info);
};

// Fill an official imaging-request template (solicitud / encuesta de contraste / consentimiento)
// with the patient header, the requesting physician and the user's interactive marks, then open
// the standard print tab. Ported from HHR's imagingRequestPdfService (pdf-lib, Helvetica 10,
// uppercase, % marks converted to bottom-left PDF coordinates).
const handleImagingFormPrintRequest = async ({ encId, doc, physician, marks, sender }) => {
  const template = self.HhrRequestForms && self.HhrRequestForms.IMAGING_DOCUMENTS[String(doc || '')];
  if (!template) return { error: 'Documento de imagenología desconocido.' };
  const context = await getClinicalReportContext(encId, null, null, sender);
  if (context.error) return context;
  const patient = context.patient || {};
  const formattedRun = self.HhrPrescriptionPrint.formatRun(patient.run) || String(patient.run || '');
  const view = self.HhrRequestForms.buildPatientView(patient, formattedRun);
  const physicianName = String(physician || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const safeMarks = (Array.isArray(marks) ? marks : [])
    .slice(0, 80)
    .map(mark => ({
      x: Number(mark && mark.x),
      y: Number(mark && mark.y),
      text: mark && mark.text ? String(mark.text).slice(0, 80) : '',
    }))
    .filter(mark =>
      Number.isFinite(mark.x) && Number.isFinite(mark.y) &&
      mark.x >= 0 && mark.x <= 100 && mark.y >= 0 && mark.y <= 100
    );
  const library = self.PDFLib;
  if (!library || !library.PDFDocument) return { error: 'pdf-lib no está disponible en la extensión.' };
  try {
    const templateResponse = await fetchWithTimeout(chrome.runtime.getURL(template.pdf));
    if (!templateResponse.ok) return { error: 'No se pudo leer la plantilla del formulario.' };
    const pdfDoc = await library.PDFDocument.load(await templateResponse.arrayBuffer());
    const font = await pdfDoc.embedFont(library.StandardFonts.Helvetica);
    const page = pdfDoc.getPage(0);
    const drawField = ({ coord, text }) => {
      const value = String(text || '').toUpperCase();
      if (!value || !coord) return;
      let size = 10;
      if (coord.maxWidth) {
        while (size > 5 && font.widthOfTextAtSize(value, size) > coord.maxWidth) size -= 0.5;
      }
      page.drawText(value, { x: coord.x, y: coord.y, size, font });
    };
    template.pdfFields(view, physicianName).forEach(drawField);
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    for (const mark of safeMarks) {
      const xPos = pageWidth * (mark.x / 100);
      const yPos = pageHeight * (1 - mark.y / 100);
      if (mark.text) page.drawText(mark.text.toUpperCase(), { x: xPos, y: yPos - 3, size: 10, font });
      else page.drawText('X', { x: xPos - 4, y: yPos - 4, size: 14, font });
    }
    const bytes = await pdfDoc.save();
    return openPdfPrintDialog({
      buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      filename: template.id + '-imagenologia.pdf',
    });
  } catch (error) {
    return { error: 'No se pudo generar el formulario: ' + String((error && error.message) || error) };
  }
};

// Fetch one patient's clinical history report ("panel de historial") and return ONLY the events
// that carry an evaluation-instruments resume (Braden/Downton), slimmed to the fields HHR needs.
// Unlike encounterFormEntry (which returns stale startDateTimes and misses same-day re-applications),
// each history event's `publishDatetime` is the real application timestamp — so HHR can pick the last
// score APPLIED ON the census day being synced. The trailing `/false/0/0/-14` is the 14-day lookback.
const handleHistoryScalesRequest = async ({ encId }) => {
  const infoResult = await resolveFichaClinicalSession();
  if (infoResult.error) return infoResult;
  return fetchHistoryScales({ encId, info: infoResult.info });
};

// Fetch medication indication history and keep it inside the extension. The page UI receives only
// the active groups already normalized by prescriber and issuance time; print requests re-fetch the source instead of
// trusting rows sent back by the DOM.
// Eloisa's history report does not consistently include `is_external`. Read the same active
// medication endpoint that feeds the on-screen table and reconcile only its stable entry id with
// the history response. This is read-only and uses the event type already authorized for the
// signed-in clinical role.
const fetchBradenHistoryEvents = (encId, knownInfo) => fetchScaleHistoryEvents(encId, knownInfo, 30);

const clinicalPanelRuntime = self.HhrClinicalPanelRuntime.create({
  fetchClinicalJson: ({ info, path, query, timeoutMs }) =>
    fichaMedicoClinicalClient.readJson({
      info,
      path,
      query,
      timeoutMs,
      timeoutMessage: 'Tiempo de espera agotado consultando Ficha Médico.',
    }).then(result => result.data),
  fetchMedicationPages: self.HhrClinicalPanelFetch.fetchMedicationPages,
  unwrapRequiredSources: self.HhrClinicalPanelFetch.unwrapRequiredSources,
  resolveSession: () => resolveFichaClinicalSession(),
  fetchCurrentValidation: fetchTreatmentValidation,
  timeoutMs: CLINICAL_PANEL_REQUEST_TIMEOUT_MS,
});
const handleClinicalPanelRequest = clinicalPanelRuntime.handleRequest;

const handlePrescriptionOptionsRequest = async ({ encId }) => {
  const infoResult = await resolveFichaClinicalSession();
  if (infoResult.error) return infoResult;
  const [history, validationResult, currentMedicationResult, context] = await Promise.all([
    fetchPrescriptionEvents(encId, infoResult.info),
    fetchTreatmentValidation(encId, infoResult.info),
    fetchCurrentMedicationEntries(encId, infoResult.info),
    getClinicalReportContext(encId, infoResult.info),
  ]);
  if (history.error) return history;
  const validation = validationResult.error ? null : validationResult.validation;
  const reconciledEvents = self.HhrPrescriptionPrint.applyCurrentMedicationMetadata(
    history.events,
    currentMedicationResult.error ? [] : currentMedicationResult.entries
  );
  const groups = self.HhrPrescriptionPrint.applyProfessionalValidationDates(
    self.HhrPrescriptionPrint.deriveProfessionalPrescriptionGroups(reconciledEvents),
    reconciledEvents,
    validation
  );
  const externalGroups = self.HhrPrescriptionPrint.deriveExternalPrescriptionGroups(groups);
  return {
    ok: true,
    groups,
    externalGroups,
    patient: context.error ? null : context.patient,
    patientWarning: context.error || '',
    medicationMetadataWarning: currentMedicationResult.error || '',
    validation: validation
      ? {
          professional: validation.healthCarePractitionerName || '',
          date: self.HhrPrescriptionPrint.toIsoDate(validation.creationDatetime),
          dateTime: self.HhrPrescriptionPrint.toDateTime(validation.creationDatetime),
        }
      : null,
  };
};

const resolveFichaEncounterId = rawUrl => {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.hostname !== 'fichamedico.rayensalud.cl') return '';
    const match = parsed.pathname.match(
      /^\/dashboard\/encounter-list(?:-nurse)?\/(\d+)\/?$/
    );
    return match ? match[1] : '';
  } catch (_error) {
    return '';
  }
};

const buildExamRequestReportUrl = ({ apiOrigin, encId, diteId }) => {
  if (!/^\d+$/.test(String(encId || '')) || !/^\d+$/.test(String(diteId || ''))) return '';
  try {
    const url = new URL('/api/report/Orden_Examen_Hospitalario.pdf', apiOrigin);
    if (url.hostname !== 'fichamedicoback.rayensalud.cl') return '';
    url.searchParams.set('dite_id', String(diteId));
    url.searchParams.set('enc_id', String(encId));
    url.searchParams.set('userLocale', 'es');
    return url.toString();
  } catch (_error) {
    return '';
  }
};

const compactClinicalText = (value, maxLength = 140) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const normalizedClinicalIdentity = value => compactClinicalText(value, 180)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9k]+/g, '');

const handleExamRequestCombinePrint = async ({ encId, diteIds, requests, sender }) => {
  self.HhrExtensionRuntime.ensurePdf();
  const senderEncounterId = resolveFichaEncounterId(
    sender && sender.tab && sender.tab.url || sender && sender.url
  );
  if (!senderEncounterId || senderEncounterId !== String(encId || '')) {
    return { error: 'La selección no corresponde al episodio clínico abierto.' };
  }
  const selected = Array.from(new Set(Array.isArray(diteIds) ? diteIds.map(String) : []))
    .filter(diteId => /^\d+$/.test(diteId));
  if (selected.length < 2 || selected.length > 3) {
    return { error: 'Selecciona entre 2 y 3 órdenes de laboratorio.' };
  }
  const visibleGroups = new Map(
    (Array.isArray(requests) ? requests : [])
      .filter(request => selected.includes(String(request && request.orderId || '')))
      .map(request => [
        String(request.orderId),
        compactClinicalText(request.group, 100) || 'Solicitud de laboratorio',
      ])
  );

  const response = await getFichaFetchInfo();
  if (response.error) return response;
  const token = response.info.token;
  const [generated, clinicalContext] = await Promise.all([
    mapWithConcurrency(selected, 2, async diteId => {
      const url = buildExamRequestReportUrl({
        apiOrigin: response.info.apiOrigin,
        encId,
        diteId,
      });
      if (!url) return { diteId, error: 'No se pudo construir el reporte oficial.' };
      const result = await fetchOfficialPdf({
        url,
        token,
        label: 'la orden ' + diteId,
      });
      return result.buffer ? { diteId, buffer: result.buffer } : { diteId, error: result.error };
    }),
    getClinicalReportContext(encId, response.info),
  ]);
  const failed = generated.filter(item => item.error);
  if (failed.length) {
    return {
      error: 'No se abrió un PDF parcial. Falló la orden ' + failed[0].diteId + ': ' + failed[0].error,
    };
  }

  if (clinicalContext.error) return clinicalContext;

  let officialRequests;
  try {
    officialRequests = await Promise.all(generated.map(async item => {
      const content = await self.HhrExamRequestPrintUi.extractOfficialExamRequestContent(item.buffer);
      if (!content) throw new Error('La orden ' + item.diteId + ' no entregó todos sus campos oficiales.');
      if (content.orderId !== item.diteId) {
        throw new Error('El folio oficial no coincide con la orden ' + item.diteId + '.');
      }
      return { ...content, group: visibleGroups.get(item.diteId) || 'Solicitud de laboratorio' };
    }));
  } catch (error) {
    return { error: 'No se pudieron integrar las solicitudes: ' + String((error && error.message) || error) };
  }
  const officialPatientRun = normalizedClinicalIdentity(officialRequests[0].patient.run);
  const currentPatientRun = normalizedClinicalIdentity(clinicalContext.patient && clinicalContext.patient.run);
  if (!officialPatientRun || officialPatientRun !== currentPatientRun) {
    return { error: 'Las solicitudes oficiales no corresponden al paciente del episodio abierto.' };
  }

  let compactBuffer;
  try {
    compactBuffer = self.HhrExamRequestPdf.generateIntegratedExamRequestPdf({
      requests: officialRequests,
      encounterId: String(encId),
    });
  } catch (error) {
    return { error: 'No se pudo generar la solicitud integrada: ' + String((error && error.message) || error) };
  }
  const opened = await openPdfPrintDialog({
    buffer: compactBuffer,
    filename: `Solicitud_Examenes_${encId}_${selected.join('-')}.pdf`,
  });
  return opened.error ? opened : { ...opened, count: selected.length };
};

const clinicalReportRuntime = self.HhrClinicalReportRuntime.create({
  chrome,
  crypto,
  TextDecoder,
  fetchWithTimeout,
  getClinicalReportContext,
  getFichaFetchInfo,
  mapWithConcurrency,
  bufferToBase64,
  base64ToArrayBuffer,
  extensionRuntime: self.HhrExtensionRuntime,
  pdfPrint: self.HhrPdfPrint,
  prescriptionPrint: self.HhrPrescriptionPrint,
  prescriptionPdf: self.HhrPrescriptionPdf,
  epicrisisPdf: self.HhrEpicrisisPdf,
  pdfLib: self.PDFLib,
  now: () => Date.now(),
});

// Security contracts owned and tested directly by clinical-report-runtime.js:
// - invalid identity returns: No se pudo validar el RUN del paciente seleccionado.
// - epicrisis correction receives { expectedPatientRun: normalizedPatientRun }.
// - compact parsing uses officialResult.buffer.slice(0) so the official fallback stays intact.
// - const resolveDischargedEncounterIdByRun keeps filterType '2', getFichaFetchInfo(sender),
//   contextRun !== normalizedPatientRun and verifies candidates with && !rowRun(row).
//   The owner applies this through url.searchParams.set('filterType', '2').
const {
  fetchOfficialPdf,
  fetchPrescriptionReportBuffer,
  fetchIndicationsReportBuffer,
  fetchRegimenReportBuffer,
  downloadPdfBuffer,
  openPdfPrintDialog,
  handleCorrectedEpicrisisPrintRequest,
  handleNursingMedicalEpicrisisPrintRequest,
  createCompletePrescriptionPdf,
} = clinicalReportRuntime;

const { download: handleStatisticalDischargeReportDownload } =
  self.HhrGestionCamasDischargeReportRuntime.create({
    resolveSession: resolveGestionCamasSession,
    fetchOfficialPdf,
    markSessionVerified: markGestionCamasSessionVerified,
    downloadPdfBuffer,
  });

const parseClinicalTimestamp = value => {
  const text = String(value || '').trim();
  const match = text.match(
    /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*(Z|[+-]\d{2}:?\d{2}))?)?$/
  );
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    const maxDay = new Date(year, month, 0).getDate();
    if (month < 1 || month > 12 || day < 1 || day > maxDay ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return NaN;
    const pad = part => String(part || 0).padStart(2, '0');
    if (match[7]) {
      const offset = match[7] === 'Z' ? 'Z' : match[7].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
      return Date.parse(
        year + '-' + pad(month) + '-' + pad(day) + 'T' +
        pad(hour) + ':' + pad(minute) + ':' + pad(second) + offset
      );
    }
    return new Date(year, month - 1, day, hour, minute, second).getTime();
  }
  return Date.parse(text);
};

const collectClinicalTimestampBaseline = (records, getTimestamp) => {
  const timestampTexts = new Set();
  let latestAt = NaN;
  for (const record of Array.isArray(records) ? records : []) {
    const raw = String(getTimestamp(record) || '').trim();
    if (!raw) continue;
    timestampTexts.add(raw);
    const parsed = parseClinicalTimestamp(raw);
    if (Number.isFinite(parsed) && (!Number.isFinite(latestAt) || parsed > latestAt)) latestAt = parsed;
  }
  return { timestampTexts, latestAt };
};

const hasNewClinicalTimestamp = (value, baseline, startedAt) => {
  const raw = String(value || '').trim();
  const parsed = parseClinicalTimestamp(raw);
  if (!raw || !Number.isFinite(parsed) || parsed < startedAt - 120000) return false;
  if (baseline && Number.isFinite(baseline.latestAt) && parsed <= baseline.latestAt) return false;
  return !(baseline && baseline.timestampTexts && baseline.timestampTexts.has(raw));
};

const clinicalRecordKey = (kind, record, timestamp, extraParts = []) => {
  const row = record || {};
  const id = String(row.id || '').trim();
  if (id) return kind + ':id:' + id;
  const guid = String(row.guid || '').trim();
  if (guid) return kind + ':guid:' + guid;
  return JSON.stringify([
    kind,
    String(row.encounterEventId || '').trim(),
    String(timestamp || '').trim(),
    ...extraParts.map(value => String(value == null ? '' : value).trim()),
  ]);
};

const authorizeClinicalWriteRecovery = async ({ kind, encId, requiredHandoffKind }) => {
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  const sessionHandoffKind = resolveSessionHandoffKind(info);
  const roleMatchesRecovery = kind === 'handoff'
    ? sessionHandoffKind === requiredHandoffKind
    : sessionHandoffKind === 'nursing';
  if (!info.identityVerified || !/^\d+$/.test(String(info.practitionerRoleId || '')) ||
      !roleMatchesRecovery) {
    return {
      error: kind === 'handoff'
        ? 'No se pudo verificar una sesión médica o de enfermería.'
        : 'No se pudo verificar una sesión activa de enfermería.',
    };
  }
  const activeEncounter = await verifyEncounterStillHospitalized(encId, info);
  if (activeEncounter.error) return activeEncounter;
  const claimsResult = await fetchFichaClaims(info);
  if (claimsResult.error) return claimsResult;
  if (kind === 'handoff') {
    if (!hasFichaClaim(claimsResult, 'Ver_Cambio_Turno')) {
      return { error: 'El perfil no tiene permiso para verificar entregas de turno.' };
    }
  } else if (!hasFichaClaim(claimsResult, 'Ver_Instrumento_Evaluacion')) {
    return { error: 'El perfil no tiene permiso para verificar instrumentos.' };
  }
  return { info };
};
const clinicalWriteRuntime = self.HhrClinicalWriteRuntime.create({
  chrome,
  storage: chrome.storage.local,
  crypto: globalThis.crypto,
  now: () => Date.now(),
  authorizeRecovery: authorizeClinicalWriteRecovery,
  readRecoveryReview: request => readClinicalWriteRecoveryReview(request),
  recoveryPolicy: self.HhrClinicalWriteRecoveryPolicy,
});

const {
  acknowledge: acknowledgeClinicalWrite,
  recover: handleClinicalWriteRecoveryRequest,
  serializeProtection: serializeClinicalWriteProtection,
  withWriteLock: withClinicalWriteLock,
} = clinicalWriteRuntime;

const fetchFichaClaims = async info => {
  if (!info || !info.practitionerId || !info.facId) return { claims: [] };
  try {
    const url = new URL('/api/login/claim/getAllInApp', info.apiOrigin);
    url.searchParams.set('hcpId', info.practitionerId);
    url.searchParams.set('facilityId', info.facId);
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) return { error: 'Eloísa respondió HTTP ' + response.status + ' al consultar permisos.' };
    const rows = await response.json();
    return {
      claims: (Array.isArray(rows) ? rows : [])
        .map(row => ({
          claim: String(row && (row.claim || row.name) || '').trim(),
          moduleId: Number(row && row.moduleId),
        }))
        .filter(row => row.claim && Number.isFinite(row.moduleId)),
    };
  } catch (error) {
    return { error: 'No se pudieron verificar los permisos: ' + String((error && error.message) || error) };
  }
};

const hasFichaClaim = (claimResult, claimName, moduleId = 6) =>
  Boolean(claimResult && Array.isArray(claimResult.claims) && claimResult.claims.some(item =>
    item && item.claim === claimName && Number(item.moduleId) === Number(moduleId)
  ));

const resolveSessionHandoffKind = info => self.HhrPrescriptionPrint.resolveHandoffKind(
  info && info.role,
  info && info.practitionerRoleId
);

const clinicalHandoffRuntime = self.HhrClinicalHandoffRuntime.create({
  chrome,
  crypto,
  fetchWithTimeout,
  getFichaFetchInfo,
  resolveSessionHandoffKind,
  fetchFichaClaims,
  hasFichaClaim,
  fetchActiveHospitalizedPatients,
  mapWithConcurrency,
  serializeClinicalWriteProtection,
  withClinicalWriteLock: withClinicalWriteLock,
  verifyEncounterStillHospitalized,
  clinicalRecordKey,
  collectClinicalTimestampBaseline,
  hasNewClinicalTimestamp,
  fetchOfficialPdf,
  openPdfPrintDialog,
  prescriptionPrint: self.HhrPrescriptionPrint,
  now: () => Date.now(),
  wait: delay => new Promise(resolve => setTimeout(resolve, delay)),
});

const {
  handleOptionsRequest: handleHandoffOptionsRequest,
  handleSaveRequest: handleHandoffSaveRequest,
  handleReportRequest: handleHandoffReportRequest,
} = clinicalHandoffRuntime;

const clinicalScoreRuntime = self.HhrClinicalScoreRuntime.create({
  chrome,
  crypto,
  fetchWithTimeout,
  getFichaFetchInfo,
  resolveGestionCamasSession,
  classifyGestionCamasRejection,
  nursingWorklists: fichaMedicoNursingWorklists,
  resolveSessionHandoffKind,
  fetchFichaClaims,
  hasFichaClaim,
  fetchActiveHospitalizedPatients,
  mapWithConcurrency,
  fetchScaleHistoryEvents,
  fetchEvaluationForms,
  serializeClinicalWriteProtection,
  verifyEncounterStillHospitalized,
  prescriptionPrint: self.HhrPrescriptionPrint,
  gestionCamasCudyr: self.HhrGestionCamasCudyr,
  now: () => Date.now(),
});

const {
  fetchCudyrCategories,
  fetchCudyrDefinitions,
  getScaleDefinition,
  resolveCudyrFormId,
  readScoresBatch,
  handleOptionsRequest: handleScoresOptionsRequest,
  handleFormRequest: handleScoreFormRequest,
  handleCudyrCategoriesRequest,
} = clinicalScoreRuntime;
const clinicalScoreWriteRuntime = self.HhrClinicalScoreWriteRuntime.create({
  scoreWriteModel: self.HhrClinicalScoreWriteModel,
  fetchWithTimeout,
  getFichaFetchInfo,
  fetchFichaClaims,
  hasFichaClaim,
  verifyEncounterStillHospitalized,
  fetchCudyrDefinitions,
  fetchCudyrCategories,
  resolveCudyrFormId,
  getScaleDefinition,
  readScoresBatch,
  fetchScaleHistoryEvents,
  fetchEvaluationForms,
  withClinicalWriteLock,
  clinicalRecordKey,
  collectClinicalTimestampBaseline,
  hasNewClinicalTimestamp,
  prescriptionPrint: self.HhrPrescriptionPrint,
  wait: delay => new Promise(resolve => setTimeout(resolve, delay)),
});
const handleScoreSaveRequest = clinicalScoreWriteRuntime.handleSaveRequest;

const readClinicalWriteRecoveryReview = async ({ kind, encId, instrument, info }) => {
  if (kind === 'handoff') {
    return clinicalHandoffRuntime.readRecoveryReview({ encId, info });
  }
  return clinicalScoreWriteRuntime.readRecoveryReview({ encId, instrument, info });
};

const clinicalBatchPrintRuntime = self.HhrClinicalBatchPrintRuntime.create({
  chrome,
  crypto,
  getFichaFetchInfo,
  fetchActiveHospitalizedPatients,
  handleSnapshotRequest,
  mapWithConcurrency,
  fetchPrescriptionEvents,
  fetchBradenHistoryEvents,
  fetchEvaluationForms,
  fetchNutritionOrderEntry,
  verifySelectedEncountersStillHospitalized,
  fichaSessionCacheKey,
  createCompletePrescriptionPdf,
  fetchIndicationsReportBuffer,
  openPdfPrintDialog,
  extensionRuntime: self.HhrExtensionRuntime,
  pdfPrint: self.HhrPdfPrint,
  prescriptionPrint: self.HhrPrescriptionPrint,
  prescriptionPdf: self.HhrPrescriptionPdf,
  now: () => Date.now(),
});

const {
  handleHospitalizedPrescriptionOptionsRequest,
  handleHospitalizedPrescriptionPrintRequest,
  handleHospitalizedIndicationsOptionsRequest,
  handleHospitalizedIndicationsPrintRequest,
  handleHospitalizedRegimenOptionsRequest,
  handleHospitalizedRegimenPrintRequest,
} = clinicalBatchPrintRuntime;

// Keep Eloisa's official Jasper prescription as the source of truth for the complete option and
// for emission metadata. Every resulting PDF is opened with the standard /Print OpenAction.
// The native report accepts encounter, practitioner and patient identifiers; it has no historical
// date parameter, so the extension does not claim to produce past versions.
const handlePrescriptionPrintRequest = async ({ encId, selectionKey, printFormat }) => {
  self.HhrExtensionRuntime.ensurePdf();
  const format = printFormat === 'compact' ? 'compact' : 'standard';
  if (!selectionKey || selectionKey === 'complete') {
    const complete = await createCompletePrescriptionPdf({ encId, printFormat: format });
    if (complete.error) return complete;
    return openPdfPrintDialog({
      buffer: complete.buffer,
      filename: complete.filename,
    });
  }
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const officialResult = await fetchPrescriptionReportBuffer({ encId, info: infoResult.info });
  if (officialResult.error) return officialResult;
  if (!/^(?:professional(?:-run)?:[a-z0-9-]+|external:\d+)$/.test(String(selectionKey))) {
    return { error: 'La selección de receta no es válida.' };
  }
  const [history, validationResult, currentMedicationResult] = await Promise.all([
    fetchPrescriptionEvents(encId, infoResult.info),
    fetchTreatmentValidation(encId, infoResult.info),
    fetchCurrentMedicationEntries(encId, infoResult.info),
  ]);
  if (history.error) return history;
  const validation = validationResult.error ? null : validationResult.validation;
  const reconciledEvents = self.HhrPrescriptionPrint.applyCurrentMedicationMetadata(
    history.events,
    currentMedicationResult.error ? [] : currentMedicationResult.entries
  );
  const groups = self.HhrPrescriptionPrint.applyProfessionalValidationDates(
    self.HhrPrescriptionPrint.deriveProfessionalPrescriptionGroups(reconciledEvents),
    reconciledEvents,
    validation
  );
  const externalGroups = self.HhrPrescriptionPrint.deriveExternalPrescriptionGroups(groups);
  const selectedGroup = [...groups, ...externalGroups].find(item => item.key === selectionKey);
  if (!selectedGroup) {
    return { error: 'No se encontraron fármacos activos para esa receta.' };
  }
  if (!selectedGroup.prescriberVerified || !selectedGroup.professionalRun) {
    return { error: 'La identidad del prescriptor no pudo verificarse. Usa la receta completa oficial.' };
  }
  if (!(selectedGroup.printDateTime || selectedGroup.validationDateTime)) {
    return { error: 'No se encontró una fecha atribuible con certeza a ese prescriptor. Usa la receta completa oficial.' };
  }
  let officialMetadata;
  try {
    officialMetadata = await self.HhrPrescriptionPrint.extractOfficialPrescriptionMetadata(
      officialResult.buffer
    );
  } catch (error) {
    return { error: 'No se pudieron conservar los datos de emisión de la receta oficial: ' + String((error && error.message) || error) };
  }
  const group = selectedGroup;
  const groupDateTime = [group.printDateTime, group.validationDateTime].find(Boolean);
  const emissionDateTime = self.HhrPrescriptionPrint.resolvePrescriptionEmissionDateTime(
    group, officialMetadata.emissionDateTime
  );
  if (!emissionDateTime) return { error: 'La receta no informó su fecha y hora de emisión.' };
  if (group.medications.length === 0) return { error: 'No se encontraron fármacos activos.' };
  const context = await getClinicalReportContext(
    encId,
    infoResult.info,
    groupDateTime
  );
  if (context.error) return context;
  let buffer;
  try {
    buffer = self.HhrPrescriptionPdf.generateProfessionalPrescriptionPdf({
      patient: context.patient,
      professional: group.professional,
      professionalRun: group.professionalRun,
      medications: group.medications,
      validationDate: group.printDate || group.validationDate,
      validationDateTime: group.printDateTime || group.validationDateTime,
      dateSource: group.printDateSource || 'validation',
      emissionDateTime: self.HhrPrescriptionPrint.formatDateTimeLabel(emissionDateTime),
      folio: '',
      printFormat: format,
      isExternalPrescription: Boolean(group.external),
    });
  } catch (error) {
    return { error: 'No se pudo generar la receta: ' + String((error && error.message) || error) };
  }
  return openPdfPrintDialog({
    buffer,
    filename: self.HhrPrescriptionPrint.buildPrescriptionFilename(
      encId,
      group.external ? 'externa-' + group.medication + '-' + group.professional :
        group.professional + '-' + emissionDateTime,
      format
    ),
  });
};

const handleIndicationsPrintRequest = async ({ encId }) => {
  const result = await fetchIndicationsReportBuffer({ encId });
  if (result.error) return result;
  return downloadPdfBuffer({ buffer: result.buffer, filename: `Indicaciones_${encId}.pdf` });
};

const syslabRuntime = self.HhrSyslabRuntime.create({
  chrome,
  labViewer: self.HhrLabViewer,
  withTimeout,
  getClinicalReportContext,
  getFichaFetchInfo,
  fichaSessionCacheKey,
  fetchActiveEncounterRows,
  resolveFichaEncounterId,
});

const runtimeRoute = (handle, fallback) => Object.freeze({ handle, fallback });

const runtimeMessageRoutes = Object.freeze({
  [RUNTIME_MESSAGES.EXTENSION_HEALTH_REQUEST]: runtimeRoute(
    () => handleExtensionHealth(),
    'No se pudo verificar el estado de la extensión.'
  ),
  [RUNTIME_MESSAGES.GC_SESSION_CAPTURED]: runtimeRoute(
    (message, sender) => captureGestionCamasSession(message.info, sender),
    'No se pudo conservar la sesión temporal de Gestión de Camas.'
  ),
  [RUNTIME_MESSAGES.GC_DOCUMENT_READY]: runtimeRoute(
    (_message, sender) => handleGestionCamasDocumentReady(sender),
    'No se pudo restaurar el intento de conexión de Gestión de Camas.'
  ),
  [RUNTIME_MESSAGES.GC_CONNECT_REQUEST]: runtimeRoute(
    message => handleConnectGestionCamas({ renew: message.renew === true }),
    'No se pudo abrir Gestión de Camas.'
  ),
  [RUNTIME_MESSAGES.GC_DISCONNECT_REQUEST]: runtimeRoute(
    () => handleDisconnectGestionCamas(),
    'No se pudo olvidar la conexión de Gestión de Camas.'
  ),
  [RUNTIME_MESSAGES.SNAPSHOT_REQUEST]: runtimeRoute(
    () => self.HhrGestionCamasClinicalCribs.enrichSnapshotRequest(handleSnapshotRequest(), gestionCamasRuntime, fetchWithTimeout),
    'No se pudo leer el censo de Ficha Médico.'
  ),
  [RUNTIME_MESSAGES.OPEN_ENCOUNTER_REQUEST]: runtimeRoute(
    message => handleOpenEncounter(message.encId),
    'No se pudo abrir el episodio clínico.'
  ),
  [RUNTIME_MESSAGES.EGRESO_LOOKUP_REQUEST]: runtimeRoute(
    message => handleEgresoLookup(message.runs, message.targets),
    'No se pudo consultar el egreso.'
  ),
  [RUNTIME_MESSAGES.EGRESO_REPORT_REQUEST]: runtimeRoute(
    message => handleReportRequest({ dateStart: message.dateStart, dateEnd: message.dateEnd }),
    'No se pudo leer el reporte de egresos.'
  ),
  [RUNTIME_MESSAGES.EGRESO_REPORT_SAVE]: runtimeRoute(
    message => handleReportSave({ dateStart: message.dateStart, dateEnd: message.dateEnd }),
    'No se pudo guardar el reporte de egresos.'
  ),
  [RUNTIME_MESSAGES.STATISTICAL_DISCHARGE_REPORT_REQUEST]: runtimeRoute(
    message => handleStatisticalDischargeReportDownload({ encId: message.encId }),
    'No se pudo descargar el informe estadístico de egreso.'
  ),
  [RUNTIME_MESSAGES.DEVICE_REPORT_REQUEST]: runtimeRoute(
    message => handleDeviceReportRequest({ encId: message.encId, fecha: message.fecha }),
    'No se pudo leer el reporte de dispositivos.'
  ),
  [RUNTIME_MESSAGES.DEVICE_REPORT_SAVE]: runtimeRoute(
    message => handleDeviceReportSave({ encId: message.encId, fecha: message.fecha }),
    'No se pudo guardar el reporte de dispositivos.'
  ),
  [RUNTIME_MESSAGES.SCALES_REPORT_REQUEST]: runtimeRoute(
    (message, sender) => handleScalesReportRequest({ encId: message.encId, sender }),
    'No se pudo leer el reporte de escalas.'
  ),
  [RUNTIME_MESSAGES.PATIENT_HEADER_REQUEST]: runtimeRoute(
    (message, sender) => handlePatientHeaderRequest({ encId: message.encId, sender }),
    'No se pudo identificar al paciente.'
  ),
  [RUNTIME_MESSAGES.CENSUS_LIST_REQUEST]: runtimeRoute(
    (message, sender) =>
      handleCensusListRequest({ currentEncId: message.currentEncId, sender }),
    'No se pudo leer el censo de hospitalizados.'
  ),
  [RUNTIME_MESSAGES.VITALS_CENSUS_REQUEST]: runtimeRoute(
    (message, sender) =>
      handleVitalsCensusRequest({ currentEncId: message.currentEncId, sender }),
    'No se pudieron leer los signos vitales del censo.'
  ),
  [RUNTIME_MESSAGES.IMAGING_FORM_PRINT_REQUEST]: runtimeRoute(
    (message, sender) =>
      handleImagingFormPrintRequest({
        encId: message.encId,
        doc: message.doc,
        physician: message.physician,
        marks: message.marks,
        sender,
      }),
    'No se pudo imprimir el formulario de imagenología.'
  ),
  [RUNTIME_MESSAGES.HISTORY_SCALES_REQUEST]: runtimeRoute(
    message => handleHistoryScalesRequest({ encId: message.encId }),
    'No se pudo leer el historial de escalas.'
  ),
  [RUNTIME_MESSAGES.CLINICAL_PANEL_REQUEST]: runtimeRoute(
    message => handleClinicalPanelRequest({ encId: message.encId }),
    'No se pudo cargar el panel clínico.'
  ),
  [RUNTIME_MESSAGES.LAB_SEARCH_REQUEST]: runtimeRoute(
    (message, sender) => syslabRuntime.search({ encId: message.encId, sender }),
    'No se pudieron buscar los exámenes de laboratorio.'
  ),
  [RUNTIME_MESSAGES.SYSLAB_STATUS_REQUEST]: runtimeRoute(
    () => syslabRuntime.currentSession(),
    'No se pudo comprobar la conexión con Syslab.'
  ),
  [RUNTIME_MESSAGES.SYSLAB_LOGIN_REQUEST]: runtimeRoute(
    message =>
      syslabRuntime.login({ username: message.username, password: message.password }),
    'No se pudo iniciar sesión en Syslab.'
  ),
  [RUNTIME_MESSAGES.LAB_DETAILS_REQUEST]: runtimeRoute(
    (message, sender) =>
      syslabRuntime.details({ batchId: message.batchId, examIds: message.examIds, sender }),
    'No se pudieron analizar los informes de laboratorio.'
  ),
  [RUNTIME_MESSAGES.LAB_PDF_OPEN_REQUEST]: runtimeRoute(
    (message, sender) =>
      syslabRuntime.openPdf({ batchId: message.batchId, examId: message.examId, sender }),
    'No se pudo abrir el informe de laboratorio.'
  ),
  [RUNTIME_MESSAGES.PRESCRIPTION_OPTIONS_REQUEST]: runtimeRoute(
    message => handlePrescriptionOptionsRequest({ encId: message.encId }),
    'No se pudieron preparar las opciones de receta.'
  ),
  [RUNTIME_MESSAGES.PRESCRIPTION_PRINT_REQUEST]: runtimeRoute(
    message =>
      handlePrescriptionPrintRequest({
        encId: message.encId,
        selectionKey: message.selectionKey,
        printFormat: message.printFormat,
      }),
    'No se pudo generar la receta.'
  ),
  [RUNTIME_MESSAGES.EPICRISIS_CORRECTED_PRINT_REQUEST]: runtimeRoute(
    message =>
      handleCorrectedEpicrisisPrintRequest({
        pdfBase64: message.pdfBase64,
        patientRun: message.patientRun,
      }),
    'No se pudo preparar el alta médica corregida.'
  ),
  [RUNTIME_MESSAGES.NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST]: runtimeRoute(
    (message, sender) =>
      handleNursingMedicalEpicrisisPrintRequest({ ...message, sender }),
    'No se pudo imprimir la epicrisis médica.'
  ),
  [RUNTIME_MESSAGES.EXAM_REQUEST_COMBINE_PRINT_REQUEST]: runtimeRoute(
    (message, sender) =>
      handleExamRequestCombinePrint({
        encId: message.encId,
        diteIds: message.diteIds,
        requests: message.requests,
        sender,
      }),
    'No se pudieron combinar las solicitudes de laboratorio.'
  ),
  [RUNTIME_MESSAGES.HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST]: runtimeRoute(
    (message, sender) =>
      handleHospitalizedPrescriptionOptionsRequest({
        currentEncId: message.currentEncId,
        sender,
      }),
    'No se pudieron revisar las recetas de pacientes hospitalizados.'
  ),
  [RUNTIME_MESSAGES.HOSPITALIZED_PRESCRIPTION_PRINT_REQUEST]: runtimeRoute(
    (message, sender) =>
      handleHospitalizedPrescriptionPrintRequest({
        batchId: message.batchId,
        encIds: message.encIds,
        printFormat: message.printFormat,
        sender,
      }),
    'No se pudo generar la impresión de pacientes hospitalizados.'
  ),
  [RUNTIME_MESSAGES.INDICATIONS_PRINT_REQUEST]: runtimeRoute(
    message => handleIndicationsPrintRequest({ encId: message.encId }),
    'No se pudieron preparar las indicaciones.'
  ),
  [RUNTIME_MESSAGES.HOSPITALIZED_INDICATIONS_OPTIONS_REQUEST]: runtimeRoute(
    message =>
      handleHospitalizedIndicationsOptionsRequest({ currentEncId: message.currentEncId }),
    'No se pudieron revisar las indicaciones de pacientes hospitalizados.'
  ),
  [RUNTIME_MESSAGES.HOSPITALIZED_INDICATIONS_PRINT_REQUEST]: runtimeRoute(
    message =>
      handleHospitalizedIndicationsPrintRequest({
        batchId: message.batchId,
        encIds: message.encIds,
      }),
    'No se pudo generar la impresión de indicaciones.'
  ),
  [RUNTIME_MESSAGES.HOSPITALIZED_REGIMEN_OPTIONS_REQUEST]: runtimeRoute(
    message =>
      handleHospitalizedRegimenOptionsRequest({ currentEncId: message.currentEncId }),
    'No se pudieron revisar los regímenes hospitalizados.'
  ),
  [RUNTIME_MESSAGES.HOSPITALIZED_REGIMEN_PRINT_REQUEST]: runtimeRoute(
    () => handleHospitalizedRegimenPrintRequest(),
    'No se pudo generar el reporte de regímenes.'
  ),
  [RUNTIME_MESSAGES.HANDOFF_OPTIONS_REQUEST]: runtimeRoute(
    message => handleHandoffOptionsRequest({ currentEncId: message.currentEncId }),
    'No se pudo cargar la entrega de turno.'
  ),
  [RUNTIME_MESSAGES.HANDOFF_SAVE_REQUEST]: runtimeRoute(
    message =>
      handleHandoffSaveRequest({
        batchId: message.batchId,
        encId: message.encId,
        observation: message.observation,
      }),
    'No se pudo completar el guardado de la entrega de turno.'
  ),
  [RUNTIME_MESSAGES.HANDOFF_REPORT_REQUEST]: runtimeRoute(
    message => handleHandoffReportRequest({ nurseStationId: message.nurseStationId }),
    'No se pudo preparar el reporte de turno.'
  ),
  [RUNTIME_MESSAGES.SCORES_OPTIONS_REQUEST]: runtimeRoute(
    message => handleScoresOptionsRequest({ currentEncId: message.currentEncId }),
    'No se pudieron cargar los instrumentos clínicos.'
  ),
  [RUNTIME_MESSAGES.SCORE_FORM_REQUEST]: runtimeRoute(
    message =>
      handleScoreFormRequest({
        batchId: message.batchId,
        encId: message.encId,
        instrument: message.instrument,
      }),
    'No se pudo cargar el formulario clínico.'
  ),
  [RUNTIME_MESSAGES.SCORE_SAVE_REQUEST]: runtimeRoute(
    message =>
      handleScoreSaveRequest({
        batchId: message.batchId,
        encId: message.encId,
        instrument: message.instrument,
        answers: message.answers,
      }),
    'No se pudo completar el guardado del instrumento.'
  ),
  [RUNTIME_MESSAGES.CLINICAL_WRITE_ACK]: runtimeRoute(
    message =>
      acknowledgeClinicalWrite({
        key: message.key,
        generationId: message.generationId,
        receiptId: message.receiptId,
      }),
    'No se pudo confirmar localmente el guardado clínico.'
  ),
  [RUNTIME_MESSAGES.CLINICAL_WRITE_RECOVERY_REQUEST]: runtimeRoute(
    message =>
      handleClinicalWriteRecoveryRequest({
        key: message.key,
        generationId: message.generationId,
        phase: message.phase,
        recoveryToken: message.recoveryToken,
      }),
    'No se pudo revisar el estado del guardado clínico.'
  ),
  [RUNTIME_MESSAGES.CUDYR_CATEGORIES_REQUEST]: runtimeRoute(
    () => handleCudyrCategoriesRequest(),
    'No se pudo consultar CUDYR.'
  ),
});

chrome.runtime.onMessage.addListener(messageContract.createRuntimeRouter(runtimeMessageRoutes));

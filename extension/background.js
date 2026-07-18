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
  'gestion-camas-session.js',
  'gestion-camas-runtime.js',
  'gestion-camas-cudyr.js',
  'clinical-panel-fetch.js',
  'clinical-panel-runtime.js',
  'clinical-write-runtime.js',
  'clinical-score-runtime.js',
  'clinical-report-runtime.js',
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

if (!self.HhrClinicalWriteRuntime || typeof self.HhrClinicalWriteRuntime.create !== 'function') {
  throw new Error('No se pudo cargar el runtime de escrituras clínicas.');
}
if (!self.HhrClinicalPanelRuntime || typeof self.HhrClinicalPanelRuntime.create !== 'function') {
  throw new Error('No se pudo cargar el runtime de lectura del panel clínico.');
}
if (!self.HhrClinicalReportRuntime || typeof self.HhrClinicalReportRuntime.create !== 'function') {
  throw new Error('No se pudo cargar el runtime de informes clínicos.');
}
if (!self.HhrClinicalScoreRuntime || typeof self.HhrClinicalScoreRuntime.create !== 'function') {
  throw new Error('No se pudo cargar el runtime de lectura de Scores.');
}
if (
  !self.HhrFichaMedicoTransportRuntime ||
  typeof self.HhrFichaMedicoTransportRuntime.create !== 'function'
) {
  throw new Error('No se pudo cargar el runtime de transporte de Ficha Médico.');
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

const GESTION_CAMAS_EGRESO_METADATA_FIELDS = [
  'id',
  'endPeriod',
  'dateDischarge',
  'isDead',
  'hasMedicalDischarge',
  'hasNurseDischarge',
  'hasNursingDischarge',
  'hasAdministrativeDischarge',
  'dischargeDestination',
  'dischargeDestinationName',
  'destinationSystemName',
  'dischargeReasonName',
  'dischargeTypeName',
  'bedDestination',
  'destinationBed',
];

const pickGestionCamasEncounterMetadata = value => {
  const result = {};
  if (!value || typeof value !== 'object') return result;
  for (const key of GESTION_CAMAS_EGRESO_METADATA_FIELDS) {
    const field = value[key];
    if (field !== undefined && field !== null &&
        typeof field !== 'object' && typeof field !== 'function') {
      result[key] = field;
    }
  }
  return result;
};

const handleEgresoLookup = async runs => {
  const session = await resolveGestionCamasSession();
  if (!session.record) {
    return { error: session.error || 'Conecta Gestión de Camas para consultar egresos.' };
  }
  const record = session.record;
  if (!record.facId) return { error: 'Gestión de Camas no informó el establecimiento.' };
  const results = [];
  for (const sourceRun of Array.isArray(runs) ? runs : []) {
    const run = String(sourceRun || '').replace(/[^0-9kK]/g, '');
    if (!run) continue;
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
      const item = Array.isArray(payload) ? payload[0] : payload;
      results.push({ run, egreso: item ? pickGestionCamasEncounterMetadata(item) : null });
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

const FM_DEVICE_REPORT_FILE = 'Resumen_diario_paciente.pdf';

// Fetch the per-patient "Resumen diario paciente" PDF (Ficha Médico) — it carries the invasive
// devices table. Token + backend origin come from the open Ficha Médico tab; the GET runs here in
// the background, where host_permissions bypass CORS. enc_id = encounter id, fecha = ISO YYYY-MM-DD.
const fetchDeviceReportBuffer = async ({ encId, fecha }) => {
  if (!encId || !fecha) return { error: 'Faltan enc_id o fecha para el reporte de dispositivos.' };
  const infoResp = await sendToMatchingTab(
    FICHAMEDICO_MATCH,
    { type: 'RAYEN_FM_GET_FETCH_INFO' },
    'No hay una pestaña de Ficha Médico abierta. Ábrela e inicia sesión.',
    'No se pudo obtener el token de Ficha Médico. Recarga la lista de pacientes (Cmd+R) y reintenta.'
  );
  if (infoResp.error) return { error: infoResp.error };
  const info = infoResp.info;
  if (!info || !info.token || !info.apiOrigin) {
    return { error: 'Sin token de Ficha Médico. Recarga la lista de pacientes e inicia sesión.' };
  }
  const url =
    `${info.apiOrigin}/api/report/${FM_DEVICE_REPORT_FILE}` +
    `?enc_id=${encodeURIComponent(encId)}&fac_id=${encodeURIComponent(info.facId)}` +
    `&fecha=${encodeURIComponent(fecha)}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: info.token }, credentials: 'omit' });
    if (!res.ok) return { error: 'El servidor de Ficha Médico respondió HTTP ' + res.status + '.' };
    return { buffer: await res.arrayBuffer() };
  } catch (error) {
    return { error: 'Falló la descarga del PDF de dispositivos: ' + String((error && error.message) || error) };
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
const FORM_CODIGO_KEEP = new Set(['INSTRUMENTO', 'VITAL_SIGNS']);
const fetchScalesReportWithInfo = async (encId, info) => {
  if (!encId) return { error: 'Falta enc_id para las escalas de evaluación.' };
  const url =
    `${info.apiOrigin}/api/encounter/entrySummary/encounterFormEntry/` +
    `${encodeURIComponent(encId)}/1/0/${encodeURIComponent(info.practitionerId || '7941')}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
    });
    if (res.status === 204) return { ok: true, forms: [] };
    if (!res.ok) return { error: 'El servidor de Ficha Médico respondió HTTP ' + res.status + '.' };
    const forms = await res.json();
    const kept = Array.isArray(forms)
      ? forms.filter(f => f && FORM_CODIGO_KEEP.has(String(f.formCodigo || '').toUpperCase()))
      : [];
    return { ok: true, forms: kept };
  } catch (error) {
    return { error: 'Falló la descarga de escalas: ' + String((error && error.message) || error) };
  }
};

const handleScalesReportRequest = async ({ encId, sender }) => {
  const infoResult = await getFichaFetchInfo(sender);
  if (infoResult.error) return { error: infoResult.error };
  return fetchScalesReportWithInfo(encId, infoResult.info);
};

// Patient header for the auto-filled request forms (imaging + laboratory). Read-only:
// resolves the same patientHeaderData context the prescription flows use and formats the RUN.
// Demographics are stable within a hospitalization: a short cache absorbs the burst of
// parallel lookups (module + franja de paciente) without re-hitting Eloísa each time.
const PATIENT_HEADER_CACHE_TTL_MS = 60_000;
const patientHeaderCache = new Map();
const fichaSessionCacheKey = async (info, sender) => {
  const material = [
    info && info.apiOrigin,
    info && info.token,
    info && info.facId,
    info && info.practitionerId,
    info && info.practitionerRoleId,
    info && info.role,
  ].map(value => String(value || '').trim()).join('\u0000');
  const digest = await self.crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const fingerprint = Array.from(new Uint8Array(digest).slice(0, 16))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  const senderTabId = sender && sender.tab && sender.tab.id;
  return `${senderTabId == null ? 'fallback' : senderTabId}:${fingerprint}`;
};
const handlePatientHeaderRequest = async ({ encId, sender }) => {
  const infoResult = await getFichaFetchInfo(sender);
  if (infoResult.error) return infoResult;
  const encounterId = String(encId || '');
  const sessionKey = await fichaSessionCacheKey(infoResult.info, sender);
  const cacheKey = `${sessionKey}:${encounterId}`;
  const cached = patientHeaderCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PATIENT_HEADER_CACHE_TTL_MS) return cached.payload;
  const context = await getClinicalReportContext(encounterId, infoResult.info);
  if (context.error) return context;
  const patient = context.patient || {};
  const payload = {
    ok: true,
    encId: encounterId,
    patient: {
      ...patient,
      formattedRun: self.HhrPrescriptionPrint.formatRun(patient.run) || String(patient.run || ''),
    },
  };
  patientHeaderCache.set(cacheKey, { at: Date.now(), payload });
  if (patientHeaderCache.size > 60) {
    const oldest = patientHeaderCache.keys().next().value;
    patientHeaderCache.delete(oldest);
  }
  return payload;
};

// Census list for the shared patient picker of the Centro HHR: every patient-bound module
// (vitales, laboratorio, imágenes) lets the user pick any hospitalized patient from here.
const handleCensusListRequest = async ({ currentEncId, sender }) => {
  const infoResult = await getFichaFetchInfo(sender);
  if (infoResult.error) return infoResult;
  const result = await fetchActiveHospitalizedPatients(infoResult.info);
  if (result.error) return result;
  return {
    ok: true,
    patients: (result.patients || []).map(patient => ({
      encounterId: String(patient.encounterId),
      // activeHospitalizedEncounters already assembles the display name.
      name: String(patient.name || '').trim(),
      run: self.HhrPrescriptionPrint.formatRun(patient.run) || String(patient.run || ''),
      bed: patient.bed || patient.room || '',
      service: patient.service || '',
      isCurrent: String(patient.encounterId) === String(currentEncId || ''),
    })),
  };
};

// Census-wide latest-vitals view. The service worker reuses one verified Ficha Médico session and
// bounds parallel reads so the UI can show every hospitalized patient without opening N independent
// extension message flows or overwhelming Eloísa.
const handleVitalsCensusRequest = async ({ currentEncId, sender }) => {
  const infoResult = await getFichaFetchInfo(sender);
  if (infoResult.error) return infoResult;
  const result = await fetchActiveHospitalizedPatients(infoResult.info);
  if (result.error) return result;
  const patients = await mapWithConcurrency(result.patients || [], 4, async patient => {
    const report = await fetchScalesReportWithInfo(patient.encounterId, infoResult.info);
    return {
      encounterId: String(patient.encounterId),
      name: String(patient.name || '').trim(),
      run: self.HhrPrescriptionPrint.formatRun(patient.run) || String(patient.run || ''),
      bed: patient.bed || patient.room || '',
      service: patient.service || '',
      birthDate: patient.birthDate || '',
      isCurrent: String(patient.encounterId) === String(currentEncId || ''),
      forms: report.error ? [] : report.forms,
      unavailableReason: report.error || '',
    };
  });
  return { ok: true, patients };
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
const SCALE_FORM_RE = /braden|downton/i;
const handleHistoryScalesRequest = async ({ encId }) => {
  if (!encId) return { error: 'Falta enc_id para el historial de escalas.' };
  const infoResp = await sendToMatchingTab(
    FICHAMEDICO_MATCH,
    { type: 'RAYEN_FM_GET_FETCH_INFO' },
    'No hay una pestaña de Ficha Médico abierta. Ábrela e inicia sesión.',
    'No se pudo obtener el token de Ficha Médico. Recarga la lista de pacientes (Cmd+R) y reintenta.'
  );
  if (infoResp.error) return { error: infoResp.error };
  const info = infoResp.info;
  if (!info || !info.token || !info.apiOrigin) {
    return { error: 'Sin token de Ficha Médico. Recarga la lista de pacientes e inicia sesión.' };
  }
  const url =
    `${info.apiOrigin}/api/encounter/${encodeURIComponent(encId)}/` +
    `getPatientEncounterHistoryReportServer/false/0/0/-14`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
    });
    if (res.status === 204) return { ok: true, events: [] };
    if (!res.ok) return { error: 'El servidor de Ficha Médico respondió HTTP ' + res.status + '.' };
    const raw = await res.json();
    const events = [];
    for (const ev of Array.isArray(raw) ? raw : []) {
      const resume = ev && Array.isArray(ev.evaluationInstrumentsResume)
        ? ev.evaluationInstrumentsResume.filter(c => c && SCALE_FORM_RE.test(String(c.FORM_NAME || '')))
        : [];
      if (resume.length === 0) continue;
      events.push({
        publishDatetime: ev.publishDatetime || '',
        evaluationInstrumentsResume: resume.map(c => ({
          FORM_NAME: c.FORM_NAME,
          LABEL: c.LABEL,
          VALUE: c.VALUE,
          ARCHIVED: c.ARCHIVED,
          MCAM_ID: c.MCAM_ID,
          PUBLISH_DATE_HCP_NAME: c.PUBLISH_DATE_HCP_NAME,
          PRACTITIONER_ROLE: c.PRACTITIONER_ROLE,
        })),
      });
    }
    return { ok: true, events };
  } catch (error) {
    return { error: 'Falló la descarga del historial de escalas: ' + String((error && error.message) || error) };
  }
};

// Fetch medication indication history and keep it inside the extension. The page UI receives only
// the active groups already normalized by author; print requests re-fetch the source instead of
// trusting rows sent back by the DOM.
const fetchPrescriptionEvents = async (encId, knownInfo) => {
  if (!/^\d+$/.test(String(encId || ''))) return { error: 'El episodio clínico no es válido.' };
  const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  const url =
    `${info.apiOrigin}/api/encounter/${encodeURIComponent(encId)}/` +
    'getPatientEncounterHistoryReportServer/false/0/0/-120';
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
    });
    if (res.status === 204) return { events: [] };
    if (!res.ok) return { error: 'Eloísa respondió HTTP ' + res.status + ' al buscar recetas.' };
    return { events: await res.json() };
  } catch (error) {
    return { error: 'No se pudieron leer las fechas de recetas: ' + String((error && error.message) || error) };
  }
};

// Eloisa's history report does not consistently include `is_external`. Read the same active
// medication endpoint that feeds the on-screen table and reconcile only its stable entry id with
// the history response. This is read-only and uses the event type already authorized for the
// signed-in clinical role.
const fetchCurrentMedicationEntries = async (encId, knownInfo) => {
  if (!/^\d+$/.test(String(encId || ''))) return { error: 'El episodio clínico no es válido.' };
  const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  if (!info || !info.token || !info.apiOrigin || !info.practitionerId) {
    return { error: 'La sesión no contiene los datos necesarios para consultar los fármacos activos.' };
  }
  const encounterEventTypeId = /enfermer/i.test(String(info.role || '')) ? '2' : '1';
  try {
    const response = await fetchWithTimeout(
      `${info.apiOrigin}/api/encounter/entrySummary/medicationRequestEntry/` +
        `${encodeURIComponent(encId)}/${encounterEventTypeId}/${encodeURIComponent(info.practitionerId)}`,
      {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
      }
    );
    if (response.status === 204) return { entries: [] };
    if (!response.ok) {
      return { error: 'Eloísa respondió HTTP ' + response.status + ' al consultar los fármacos activos.' };
    }
    const payload = await response.json();
    const entries = Array.isArray(payload)
      ? payload
      : Array.isArray(payload && payload.data) ? payload.data : [];
    return { entries };
  } catch (error) {
    return { error: 'No se pudieron consultar los fármacos activos: ' + String((error && error.message) || error) };
  }
};

const fetchEvaluationForms = async (encId, knownInfo) => {
  if (!/^\d+$/.test(String(encId || ''))) return { error: 'El episodio clínico no es válido.' };
  const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  if (!info || !info.token || !info.apiOrigin || !info.practitionerId) {
    return { error: 'La sesión no contiene los datos necesarios para consultar BRADEN.' };
  }
  try {
    const encounterEventTypes = /enfermer/i.test(String(info.role || '')) ? ['2'] : ['2', '1'];
    const results = await Promise.all(encounterEventTypes.map(async eventType => {
      const response = await fetchWithTimeout(
        `${info.apiOrigin}/api/encounter/entrySummary/encounterFormEntry/` +
          `${encodeURIComponent(encId)}/${eventType}/0/${encodeURIComponent(info.practitionerId)}`,
        {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        }
      );
      if (response.status === 204) return { forms: [] };
      if (!response.ok) return { error: 'HTTP ' + response.status };
      const forms = await response.json();
      return { forms: Array.isArray(forms) ? forms : [] };
    }));
    const failures = results.filter(result => result.error);
    if (failures.length) {
      return {
        error: 'Eloísa no permitió verificar todas las fuentes de instrumentos (' +
          failures.map(result => result.error).join(', ') + ').',
      };
    }
    const byIdentity = new Map();
    results.flatMap(result => result.forms).forEach(form => {
      if (!form) return;
      const key = String(form.guid || form.id || form.encounterEventId || JSON.stringify(form));
      byIdentity.set(key, form);
    });
    return { forms: [...byIdentity.values()] };
  } catch (error) {
    return { error: 'No se pudieron leer los instrumentos: ' + String((error && error.message) || error) };
  }
};

const fetchScaleHistoryEvents = async (encId, knownInfo, lookbackDays = 30) => {
  if (!/^\d+$/.test(String(encId || ''))) return { error: 'El episodio clínico no es válido.' };
  const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  try {
    const response = await fetchWithTimeout(
      `${info.apiOrigin}/api/encounter/${encodeURIComponent(encId)}/` +
        'getPatientEncounterHistoryReportServer/false/0/0/-' + Math.min(180, Math.max(1, Number(lookbackDays) || 30)),
      {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
      }
    );
    if (response.status === 204) return { events: [] };
    if (!response.ok) return { error: 'Eloísa respondió HTTP ' + response.status + ' al buscar instrumentos.' };
    const raw = await response.json();
    const events = (Array.isArray(raw) ? raw : []).flatMap(event => {
      const rows = (Array.isArray(event && event.evaluationInstrumentsResume)
        ? event.evaluationInstrumentsResume
        : []).filter(row => row && /braden|downton/i.test(String(row.FORM_NAME || '')));
      if (!rows.length) return [];
      return [{
        publishDatetime: event.publishDatetime || '',
        encounterEventId: event.encounterEventId || event.id || 0,
        evaluationInstrumentsResume: rows.map(row => ({
          FORM_NAME: row.FORM_NAME,
          LABEL: row.LABEL,
          VALUE: row.VALUE,
          VALUE_NAME: row.VALUE_NAME,
          ARCHIVED: row.ARCHIVED,
          MCAM_ID: row.MCAM_ID,
          PUBLISH_DATE_HCP_NAME: row.PUBLISH_DATE_HCP_NAME,
          HCP_NAME: row.HCP_NAME,
        })),
      }];
    });
    return { events };
  } catch (error) {
    return { error: 'No se pudo leer el historial de instrumentos: ' + String((error && error.message) || error) };
  }
};

const fetchBradenHistoryEvents = (encId, knownInfo) => fetchScaleHistoryEvents(encId, knownInfo, 30);

const fetchNutritionOrderEntry = async (encId, knownInfo) => {
  if (!/^\d+$/.test(String(encId || ''))) return { error: 'El episodio clínico no es válido.' };
  const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  if (!info.practitionerId) return { error: 'La sesión no informó el profesional lector.' };
  try {
    const response = await fetchWithTimeout(
      `${info.apiOrigin}/api/encounter/entrySummary/nutritionOrderEntry/` +
        `${encodeURIComponent(encId)}/${encodeURIComponent(info.practitionerId)}`,
      {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
      }
    );
    if (response.status === 204) return { entry: null };
    if (!response.ok) return { error: 'Eloísa respondió HTTP ' + response.status + ' al consultar el régimen.' };
    return { entry: await response.json() };
  } catch (error) {
    return { error: 'No se pudo consultar el régimen: ' + String((error && error.message) || error) };
  }
};

const fetchTreatmentValidation = async (encId, knownInfo) => {
  if (!/^\d+$/.test(String(encId || ''))) return { error: 'El episodio clínico no es válido.' };
  const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  if (!info || !info.token || !info.apiOrigin) return { validation: null };
  try {
    const response = await fetchWithTimeout(
      `${info.apiOrigin}/api/encounter/validateTreatment/${encodeURIComponent(encId)}`,
      {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
      }
    );
    if (response.status === 204 || response.status === 404) return { validation: null };
    if (!response.ok) return { error: 'Eloísa respondió HTTP ' + response.status + ' al buscar la validación.' };
    return { validation: await response.json() };
  } catch (error) {
    return { error: 'No se pudo leer la última validación: ' + String((error && error.message) || error) };
  }
};

const clinicalPanelRuntime = self.HhrClinicalPanelRuntime.create({
  fetchImpl: fetch,
  fetchJsonWithTimeout: self.HhrClinicalPanelFetch.fetchJsonWithTimeout,
  fetchMedicationPages: self.HhrClinicalPanelFetch.fetchMedicationPages,
  unwrapRequiredSources: self.HhrClinicalPanelFetch.unwrapRequiredSources,
  resolveSession: () => sendToMatchingTab(
    FICHAMEDICO_MATCH,
    { type: 'RAYEN_FM_GET_FETCH_INFO' },
    'No hay una pestaña de Ficha Médico abierta. Ábrela e inicia sesión.',
    'No se pudo obtener el token de Ficha Médico. Recarga la lista de pacientes (Cmd+R) y reintenta.'
  ),
  fetchCurrentValidation: fetchTreatmentValidation,
  timeoutMs: CLINICAL_PANEL_REQUEST_TIMEOUT_MS,
});
const handleClinicalPanelRequest = clinicalPanelRuntime.handleRequest;

const handlePrescriptionOptionsRequest = async ({ encId }) => {
  const infoResult = await getFichaFetchInfo();
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

const getClinicalReportContext = async (encId, knownInfo, referenceDateTime, sender) => {
  if (!/^\d+$/.test(String(encId || ''))) return { error: 'El episodio clínico no es válido.' };
  const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo(sender);
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  if (!info || !info.token || !info.apiOrigin || !info.practitionerId) {
    return { error: 'La sesión de Ficha Médico no contiene los datos necesarios para imprimir.' };
  }
  let patientId = '';
  let patient = null;
  try {
    const headerResponse = await fetchWithTimeout(
      `${info.apiOrigin}/api/encounter/patientHeaderData/${encodeURIComponent(encId)}/false`,
      {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
      }
    );
    if (!headerResponse.ok) {
      return { error: 'Eloísa respondió HTTP ' + headerResponse.status + ' al identificar al paciente.' };
    }
    const header = await headerResponse.json();
    const candidate =
      header && (header.patID || header.patId || header.patientId || (header.patient && header.patient.id));
    patientId = /^\d+$/.test(String(candidate || '')) ? String(candidate) : '';
    const calculatedAge = self.HhrPrescriptionPrint.formatAgeLabel(
      header.birthDate || '',
      referenceDateTime || new Date()
    );
    const estimatedAge = Number(header.estimatedAge);
    const estimatedAgeUnit = String(header.ageUnit || '').replace(/\s+/g, ' ').trim();
    const fallbackAge = Number.isFinite(estimatedAge) && estimatedAge > 0 &&
      estimatedAgeUnit && !/^0+$/.test(estimatedAgeUnit)
      ? estimatedAge + ' ' + estimatedAgeUnit
      : '';
    patient = {
      name: [header.firstGivenName, header.nextGivenNames, header.firstFamilyName, header.secondFamilyName]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      run: header.preferredIdentifierCode || '',
      sex: header.gendName || '',
      birthDate: header.birthDate || '',
      age: calculatedAge || fallbackAge,
      bed: header.bedShortName || '',
      room: header.roomShortName || '',
      service: header.hdeShortName || header.serviceName || '',
      diagnosis: header.principalDiagName || header.haoDiagName || '',
    };
  } catch (error) {
    return { error: 'No se pudo identificar al paciente: ' + String((error && error.message) || error) };
  }
  if (!patientId) {
    return { error: 'Eloísa no informó el identificador interno del paciente.' };
  }
  return { info, patientId, patient };
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

const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
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

const NURSING_WORKLISTS = ['noveltyNurseList', 'uneventfulNurseList', 'incomeNurseList'];
const fetchNursingWorklistRows = async info => {
  const results = await Promise.all(NURSING_WORKLISTS.map(async list => {
    try {
      const response = await fetchWithTimeout(
        `${info.apiOrigin}/api/encounter/${list}/${encodeURIComponent(info.facId)}`,
        {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        }
      );
      if (!response.ok) return { list, error: 'HTTP ' + response.status };
      const rows = await response.json();
      return { list, rows: Array.isArray(rows) ? rows : [] };
    } catch (error) {
      return { list, error: String((error && error.message) || error) };
    }
  }));
  const failures = results.filter(result => result.error);
  if (failures.length) {
    return {
      error: 'Eloísa no permitió verificar las tres listas de hospitalizados: ' +
        failures.map(result => result.list + ' (' + result.error + ')').join(', ') + '.',
    };
  }
  const byEncounter = new Map();
  results.forEach(result => result.rows.forEach(item => {
    if (item && item.id != null) byEncounter.set(String(item.id), item);
  }));
  return { rows: [...byEncounter.values()] };
};

const fetchActiveEncounterRows = async info => {
  if (!info || !info.token || !info.apiOrigin) {
    return { error: 'La sesión no informó el origen clínico activo.' };
  }
  if (info.listSource === 'nursing' || !info.listUrl) return fetchNursingWorklistRows(info);
  try {
    const listUrl = new URL(info.listUrl);
    listUrl.searchParams.set('filterType', '3');
    const response = await fetchWithTimeout(listUrl.toString(), {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) return { error: 'Eloísa respondió HTTP ' + response.status + ' al listar hospitalizados.' };
    const rows = await response.json();
    return { rows: Array.isArray(rows) ? rows : [] };
  } catch (error) {
    return { error: 'No se pudo leer la lista activa: ' + String((error && error.message) || error) };
  }
};

const fetchActiveHospitalizedPatients = async info => {
  const rowResult = await fetchActiveEncounterRows(info);
  if (rowResult.error) return rowResult;
  try {
    const normalized = await mapWithConcurrency(rowResult.rows, 6, async item => {
      const encId = String(item && item.id || '');
      const fallback = item && item.patient || {};
      let header = null;
      if (/^\d+$/.test(encId)) {
        try {
          const headerResponse = await fetchWithTimeout(
            `${info.apiOrigin}/api/encounter/patientHeaderData/${encodeURIComponent(encId)}/false`,
            {
              headers: { Authorization: info.token, Accept: 'application/json' },
              credentials: 'omit',
            }
          );
          if (headerResponse.ok) header = await headerResponse.json();
        } catch (_error) {}
      }
      const patient = header || fallback;
      return {
        encounterId: encId,
        run: patient.preferredIdentifierCode || fallback.identifier || item && item.patientIdentifier || '',
        firstGivenName: patient.firstGivenName || patient.givenName || fallback.firstGivenName ||
          item && item.patientName || '',
        nextGivenNames: patient.nextGivenNames || fallback.nextGivenNames || '',
        firstFamilyName: patient.firstFamilyName || patient.familyName || fallback.firstFamilyName || '',
        secondFamilyName: patient.secondFamilyName || fallback.secondFamilyName || '',
        service: item && (item.hospitalDepartmentShortName || item.hospitalDepartmentName || item.serviceName) || patient.hdeShortName || '',
        room: item && (item.roomShortName || item.roomName) || patient.roomShortName || '',
        bed: item && (item.bedShortName || item.bedName) || patient.bedShortName || '',
        birthDate: patient.birthDate || fallback.birthDate || item && item.birthDate || '',
        administrativeSexId: patient.adseId || item && item.patientAdministrativeSexId || '',
        hospitalDepartmentId: item && item.hospitalDepartmentId || patient.hospitalDepartmentId || '',
        nurseStationId: item && item.nurseStationId || '',
        patientId: patient.patID || patient.patientId || item && item.patientId || '',
        diagnosis: patient.principalDiagName || patient.haoDiagName ||
          item && (item.principalDiagName || item.haoDiagName || item.diagnosisName) || '',
        hasMedicalDischarge: Boolean(item && (item.hasMedicalDischarge || item.medicalDischarge)),
        dischargeDatetime: item && item.medicalDischargeDateTime || '',
        isDead: Boolean(item && item.isDead),
      };
    });
    return { patients: self.HhrPrescriptionPrint.activeHospitalizedEncounters({ encounters: normalized }) };
  } catch (error) {
    return { error: 'No se pudo leer la lista activa: ' + String((error && error.message) || error) };
  }
};

const verifyEncounterStillHospitalized = async (encId, info) => {
  if (!/^\d+$/.test(String(encId || '')) || !info || !info.token) {
    return { error: 'No se pudo verificar que el paciente siga hospitalizado.' };
  }
  try {
    const rowResult = await fetchActiveEncounterRows(info);
    if (rowResult.error) return rowResult;
    const active = rowResult.rows.find(item =>
      String(item && (item.id || item.encounterId) || '') === String(encId) &&
      !Boolean(item && (item.hasMedicalDischarge || item.medicalDischarge)) &&
      !String(item && item.medicalDischargeDateTime || '').trim() &&
      !Boolean(item && item.isDead)
    );
    return active
      ? { ok: true, encounter: active }
      : { error: 'El paciente ya no figura hospitalizado. Actualiza el módulo antes de registrar.' };
  } catch (error) {
    return { error: 'No se pudo confirmar la hospitalización: ' + String((error && error.message) || error) };
  }
};

const verifySelectedEncountersStillHospitalized = async (encIds, info) => {
  const rowResult = await fetchActiveEncounterRows(info);
  if (rowResult.error) return rowResult;
  const activeIds = new Set(rowResult.rows
    .filter(item => item &&
      !Boolean(item.hasMedicalDischarge || item.medicalDischarge) &&
      !String(item.medicalDischargeDateTime || '').trim() &&
      !Boolean(item.isDead)
    )
    .map(item => String(item.id || item.encounterId || ''))
    .filter(id => /^\d+$/.test(id)));
  const unavailable = (Array.isArray(encIds) ? encIds : [])
    .map(String)
    .filter(encId => !activeIds.has(encId));
  return unavailable.length
    ? {
        error: 'La hospitalización cambió para ' + unavailable.length +
          (unavailable.length === 1 ? ' paciente seleccionado. ' : ' pacientes seleccionados. ') +
          'Actualiza el módulo antes de imprimir.',
      }
    : { ok: true };
};

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
});

const {
  acknowledge: acknowledgeClinicalWrite,
  recover: handleClinicalWriteRecoveryRequest,
  serializeProtection: serializeClinicalWriteProtection,
  withWriteLock: withClinicalWriteLock,
} = clinicalWriteRuntime;

const fetchHospitalizedBradenSummaries = async (patients, info, currentEncId) =>
  mapWithConcurrency(patients, 4, async patient => {
    const [history, forms] = await Promise.all([
      fetchBradenHistoryEvents(patient.encounterId, info),
      fetchEvaluationForms(patient.encounterId, info),
    ]);
    const bradenReadErrors = [history.error, forms.error].filter(Boolean).join(' ');
    const braden = bradenReadErrors ? null : self.HhrPrescriptionPrint.deriveLatestBraden(
      history.error ? [] : history.events,
      forms.error ? [] : forms.forms
    );
    return {
      ...patient,
      braden,
      isCurrent: String(patient.encounterId) === String(currentEncId || ''),
      bradenUnavailableReason: bradenReadErrors,
    };
  });

const fetchHospitalizedRegimenSummaries = async (patients, info, currentEncId) =>
  mapWithConcurrency(patients, 4, async patient => {
    const [nutrition, history, forms] = await Promise.all([
      fetchNutritionOrderEntry(patient.encounterId, info),
      fetchBradenHistoryEvents(patient.encounterId, info),
      fetchEvaluationForms(patient.encounterId, info),
    ]);
    const bradenReadErrors = [history.error, forms.error].filter(Boolean).join(' ');
    const braden = bradenReadErrors ? null : self.HhrPrescriptionPrint.deriveLatestBraden(
      history.error ? [] : history.events,
      forms.error ? [] : forms.forms
    );
    return {
      ...patient,
      regimen: nutrition.error ? null : self.HhrPrescriptionPrint.deriveLatestNutritionOrder(nutrition.entry),
      regimenUnavailableReason: nutrition.error || '',
      braden,
      isCurrent: String(patient.encounterId) === String(currentEncId || ''),
      bradenUnavailableReason: bradenReadErrors,
    };
  });

const getActiveHospitalizedPatientsWithFallback = async info => {
  let patientResult = await fetchActiveHospitalizedPatients(info);
  if (!patientResult.error) return patientResult;
  const snapshotResult = await handleSnapshotRequest();
  if (snapshotResult.error) return { error: patientResult.error + ' ' + snapshotResult.error };
  return {
    patients: self.HhrPrescriptionPrint.activeHospitalizedEncounters(snapshotResult.snapshot),
  };
};

const handleHospitalizedIndicationsOptionsRequest = async ({ currentEncId }) => {
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const patientResult = await getActiveHospitalizedPatientsWithFallback(infoResult.info);
  if (patientResult.error) return patientResult;
  const patients = patientResult.patients.map(patient => ({
    ...patient,
    isCurrent: String(patient.encounterId) === String(currentEncId || ''),
  }));
  const batchId = crypto.randomUUID();
  await chrome.storage.session.set({
    [`hhr-indications-batch-${batchId}`]: {
      allowedEncounterIds: patients.map(patient => patient.encounterId),
      createdAt: Date.now(),
    },
  });
  return { ok: true, batchId, patients };
};

const handleHospitalizedIndicationsPrintRequest = async ({ batchId, encIds }) => {
  self.HhrExtensionRuntime.ensurePdf();
  if (!/^[a-f0-9-]{20,}$/i.test(String(batchId || ''))) {
    return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
  }
  const storageKey = `hhr-indications-batch-${batchId}`;
  const stored = await chrome.storage.session.get(storageKey);
  const batch = stored && stored[storageKey];
  if (!batch || Date.now() - Number(batch.createdAt || 0) > 30 * 60 * 1000) {
    return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
  }
  const allowed = new Set(Array.isArray(batch.allowedEncounterIds) ? batch.allowedEncounterIds : []);
  const selected = Array.from(new Set(Array.isArray(encIds) ? encIds.map(String) : []))
    .filter(encId => /^\d+$/.test(encId) && allowed.has(encId));
  if (selected.length === 0) return { error: 'Selecciona al menos un paciente.' };
  if (selected.length > 120) return { error: 'La selección supera el máximo seguro de 120 pacientes.' };

  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const activeSelection = await verifySelectedEncountersStillHospitalized(selected, infoResult.info);
  if (activeSelection.error) return activeSelection;
  const generated = await mapWithConcurrency(selected, 2, async encId => {
    const result = await fetchIndicationsReportBuffer({ encId, info: infoResult.info });
    return result.error ? { encId, error: result.error } : { encId, buffer: result.buffer };
  });
  const completed = generated.filter(item => item.buffer);
  const skipped = generated.filter(item => item.error).map(item => ({ encId: item.encId, error: item.error }));
  if (completed.length === 0) {
    return { error: 'No se pudo generar ninguna de las indicaciones seleccionadas.', skipped };
  }
  let combinedBuffer;
  try {
    combinedBuffer = await self.HhrPdfPrint.mergePdfBuffers(completed.map(item => item.buffer));
  } catch (error) {
    return { error: 'No se pudieron unir las indicaciones: ' + String((error && error.message) || error) };
  }
  const opened = await openPdfPrintDialog({
    buffer: combinedBuffer,
    filename: self.HhrPrescriptionPrint.buildBatchIndicationsFilename(
      completed.length,
      new Date().toISOString()
    ),
  });
  if (opened.error) return opened;
  await chrome.storage.session.remove(storageKey);
  return { ...opened, count: completed.length, skipped };
};

const handleHospitalizedRegimenOptionsRequest = async ({ currentEncId }) => {
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const patientResult = await fetchActiveHospitalizedPatients(infoResult.info);
  if (patientResult.error) return patientResult;
  const patients = await fetchHospitalizedRegimenSummaries(
    patientResult.patients,
    infoResult.info,
    currentEncId
  );
  return {
    ok: true,
    patients,
    bradenCount: patients.filter(patient => patient.braden).length,
    regimenCount: patients.filter(patient => patient.regimen).length,
    regimenErrorCount: patients.filter(patient => patient.regimenUnavailableReason).length,
    unavailableCount: patients.filter(patient => patient.bradenUnavailableReason).length,
  };
};

const handleHospitalizedRegimenPrintRequest = async () => {
  self.HhrExtensionRuntime.ensurePdf();
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const patientResult = await fetchActiveHospitalizedPatients(infoResult.info);
  if (patientResult.error) return patientResult;
  if (patientResult.patients.length === 0) return { error: 'No hay pacientes hospitalizados para imprimir.' };

  const patients = await fetchHospitalizedRegimenSummaries(
    patientResult.patients,
    infoResult.info,
    ''
  );
  const regimenErrors = patients.filter(patient => patient.regimenUnavailableReason);
  const bradenErrors = patients.filter(patient => patient.bradenUnavailableReason);
  if (regimenErrors.length || bradenErrors.length) {
    const failures = [];
    if (regimenErrors.length) failures.push('el régimen de ' + regimenErrors.length + (regimenErrors.length === 1 ? ' paciente' : ' pacientes'));
    if (bradenErrors.length) failures.push('BRADEN de ' + bradenErrors.length + (bradenErrors.length === 1 ? ' paciente' : ' pacientes'));
    return {
      error: 'No se imprimió: Eloísa no permitió verificar ' + failures.join(' ni ') + '. Reintenta la consulta.',
    };
  }
  let integrated;
  try {
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000)
      .toISOString()
      .slice(0, 19);
    integrated = self.HhrPrescriptionPdf.generateIntegratedRegimenPdf({
      patients,
      generatedAt: localIso,
    });
  } catch (error) {
    return { error: 'No se pudo generar el régimen integrado: ' + String((error && error.message) || error) };
  }
  const opened = await openPdfPrintDialog({
    buffer: integrated,
    filename: self.HhrPrescriptionPrint.buildRegimenFilename(new Date().toISOString()),
  });
  if (opened.error) return opened;
  return {
    ...opened,
    count: patients.length,
    regimenCount: patients.filter(patient => patient.regimen).length,
    bradenCount: patients.filter(patient => patient.braden).length,
  };
};

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

const fetchShiftChangeEntries = async (encId, info) => {
  if (!/^\d+$/.test(String(encId || '')) || !info || !info.practitionerId) {
    return { error: 'Faltan datos para leer la entrega de turno.' };
  }
  try {
    const response = await fetchWithTimeout(
      `${info.apiOrigin}/api/encounter/entrySummary/shiftChangeObservationEntry/` +
        `${encodeURIComponent(encId)}/${encodeURIComponent(info.practitionerId)}`,
      {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
      }
    );
    if (response.status === 204) return { entries: [] };
    if (!response.ok) return { error: 'Eloísa respondió HTTP ' + response.status + ' al leer la entrega.' };
    const payload = await response.json();
    return { entries: Array.isArray(payload) ? payload : payload ? [payload] : [] };
  } catch (error) {
    return { error: 'No se pudo leer la entrega de turno: ' + String((error && error.message) || error) };
  }
};

const fetchNurseStations = async info => {
  try {
    const url = new URL('/api/bedManagement/nurseStation', info.apiOrigin);
    url.searchParams.set('facilityId', info.facId);
    url.searchParams.set('tid', '0');
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const rows = await response.json();
    return (Array.isArray(rows) ? rows : []).map(row => ({
      id: String(row && row.id || ''),
      name: String(row && (row.name || row.shortName) || '').trim(),
    })).filter(row => /^\d+$/.test(row.id) && row.name);
  } catch (_error) {
    return [];
  }
};

const resolveSessionHandoffKind = info => self.HhrPrescriptionPrint.resolveHandoffKind(
  info && info.role,
  info && info.practitionerRoleId
);

const handoffPresentation = kind => kind === 'medical'
  ? { label: 'Entrega de turno médica', role: 'Médico' }
  : { label: 'Entrega de turno de enfermería', role: 'Enfermería' };

const handoffClinicalWriteKey = (kind, encId) => kind === 'medical'
  ? 'handoff:medical:' + String(encId || '')
  : 'handoff:' + String(encId || '');

const handleHandoffOptionsRequest = async ({ currentEncId }) => {
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  const handoffKind = resolveSessionHandoffKind(info);
  const handoffEventTypeId = self.HhrPrescriptionPrint.handoffEncounterEventTypeId(handoffKind);
  const identityReady = Boolean(
    info.identityVerified && /^\d+$/.test(String(info.practitionerId || '')) &&
      /^\d+$/.test(String(info.practitionerRoleId || '')) && handoffKind && handoffEventTypeId
  );
  if (!identityReady) return { error: 'No se pudo verificar un rol médico o de enfermería en la sesión.' };
  const claimsResult = await fetchFichaClaims(info);
  if (claimsResult.error) return claimsResult;
  const canViewHandoff = hasFichaClaim(claimsResult, 'Ver_Cambio_Turno');
  if (!canViewHandoff) {
    return { error: 'El perfil no tiene permiso para ver entregas de turno.' };
  }
  const patientResult = await fetchActiveHospitalizedPatients(info);
  if (patientResult.error) return patientResult;
  const [nurseStations, summaries] = await Promise.all([
    handoffKind === 'nursing' ? fetchNurseStations(info) : Promise.resolve([]),
    mapWithConcurrency(patientResult.patients, 4, async patient => {
      const [result, clinicalWriteProtection] = await Promise.all([
        fetchShiftChangeEntries(patient.encounterId, info),
        serializeClinicalWriteProtection(handoffClinicalWriteKey(handoffKind, patient.encounterId)),
      ]);
      return {
        ...patient,
        isCurrent: String(patient.encounterId) === String(currentEncId || ''),
        latestHandoff: result.error
          ? null
          : self.HhrPrescriptionPrint.deriveLatestShiftChange(result.entries, { kind: handoffKind }),
        // Both lanes are shared reading: every profile sees the latest medical AND nursing
        // handoff; writing stays restricted to the session's own lane.
        latestMedical: result.error
          ? null
          : self.HhrPrescriptionPrint.deriveLatestShiftChange(result.entries, { kind: 'medical' }),
        latestNursing: result.error
          ? null
          : self.HhrPrescriptionPrint.deriveLatestShiftChange(result.entries, { kind: 'nursing' }),
        handoffUnavailableReason: result.error || '',
        clinicalWriteProtection,
      };
    }),
  ]);
  const canWrite = hasFichaClaim(claimsResult, 'Ingresar_Cambio_Turno');
  const batchId = crypto.randomUUID();
  await chrome.storage.session.set({
    [`hhr-handoff-batch-${batchId}`]: {
      allowedEncounterIds: summaries.map(patient => patient.encounterId),
      createdAt: Date.now(),
      handoffKind,
      practitionerRoleId: String(info.practitionerRoleId),
    },
  });
  const presentation = handoffPresentation(handoffKind);
  return {
    ok: true,
    batchId,
    patients: summaries,
    nurseStations,
    canWrite,
    canPrint: handoffKind === 'nursing',
    handoffKind,
    handoffLabel: presentation.label,
    currentProfessional: info.fullName || '',
    currentProfessionalRole: presentation.role,
    writeBlockedReason: canWrite
      ? ''
      : 'El perfil no tiene permiso para ingresar entregas de turno.',
  };
};

const readHandoffBatch = async (batchId, encId) => {
  if (!/^[a-f0-9-]{20,}$/i.test(String(batchId || '')) || !/^\d+$/.test(String(encId || ''))) {
    return { error: 'La sesión de entrega de turno no es válida.' };
  }
  const storageKey = `hhr-handoff-batch-${batchId}`;
  const stored = await chrome.storage.session.get(storageKey);
  const batch = stored && stored[storageKey];
  if (!batch || Date.now() - Number(batch.createdAt || 0) > 30 * 60 * 1000) {
    return { error: 'La sesión de entrega expiró. Actualiza el módulo y vuelve a intentarlo.' };
  }
  if (!(Array.isArray(batch.allowedEncounterIds) ? batch.allowedEncounterIds : []).map(String).includes(String(encId))) {
    return { error: 'El paciente no pertenece a esta lista de hospitalizados.' };
  }
  return { ok: true, batch };
};

const readFinishRegisterEvent = async (encId, info) => {
  const url =
    `${info.apiOrigin}/api/encounter/${encodeURIComponent(encId)}/` +
    'encounterEvent/0/getFinishRegister';
  try {
    const response = await fetchWithTimeout(url, {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (response.status === 204) return { event: null };
    if (!response.ok) {
      return { error: 'Eloísa respondió HTTP ' + response.status + ' al preparar la confirmación final.' };
    }
    const raw = (await response.text()).trim();
    if (!raw || raw === 'false' || raw === 'null') return { event: null };
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_error) {
      return { error: 'Eloísa devolvió una confirmación final con formato no reconocido.' };
    }
    const event = parsed && parsed.data && typeof parsed.data === 'object'
      ? parsed.data
      : parsed;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      return { error: 'Eloísa no devolvió el evento pendiente que debe finalizarse.' };
    }
    if (!/^\d+$/.test(String(event.id || '')) ||
        String(event.encounterId || '') !== String(encId) ||
        String(event.facilityId || '') !== String(info.facId) ||
        String(event.healthCarePractitionerRoleId || '') !== String(info.practitionerRoleId)) {
      return { error: 'El evento pendiente no coincide con este episodio, establecimiento o rol clínico.' };
    }
    const legalId = String(event.healthCarePractitionerLegalId || '');
    if (legalId && legalId !== String(info.practitionerId)) {
      return { error: 'El evento pendiente pertenece a otro profesional y no se confirmó.' };
    }
    return { event };
  } catch (error) {
    return {
      error: 'No se pudo preparar la confirmación final en Eloísa: ' +
        String((error && error.message) || error),
    };
  }
};

const confirmFinishRegisterEvent = async (encId, info, event) => {
  const url = new URL(
    `/api/encounter/${encodeURIComponent(encId)}/encounterEvent/` +
      `${encodeURIComponent(event.id)}/confirmedEncounterEvent`,
    info.apiOrigin
  );
  url.searchParams.set('healthCarePractitionerRoleId', String(info.practitionerRoleId));
  url.searchParams.set('facilityId', String(info.facId));
  try {
    const response = await fetchWithTimeout(url.toString(), {
      method: 'PUT',
      headers: {
        Authorization: info.token,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'omit',
      cache: 'no-store',
      body: JSON.stringify(event),
    });
    if (!response.ok) {
      return { error: 'Eloísa respondió HTTP ' + response.status + ' al finalizar los cambios ingresados.' };
    }
    return { ok: true };
  } catch (error) {
    return {
      error: 'Se perdió la confirmación del paso Terminar: ' +
        String((error && error.message) || error),
    };
  }
};

const performHandoffSaveRequest = async ({ batchId, encId, observation }, writeGuard) => {
  const batch = await readHandoffBatch(batchId, encId);
  if (batch.error) return batch;
  const safeObservation = String(observation || '').replace(/\r\n?/g, '\n').trim();
  const normalizedObservation = safeObservation.replace(/\s+/g, ' ').trim();
  if (!safeObservation || safeObservation.length > 255) {
    return { error: 'La entrega debe contener entre 1 y 255 caracteres.' };
  }
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  const handoffKind = resolveSessionHandoffKind(info);
  const handoffEventTypeId = self.HhrPrescriptionPrint.handoffEncounterEventTypeId(handoffKind);
  const identityReady = Boolean(
    info.identityVerified && /^\d+$/.test(String(info.practitionerId || '')) &&
      /^\d+$/.test(String(info.practitionerRoleId || '')) && handoffKind && handoffEventTypeId
  );
  if (!identityReady) return { error: 'No se pudo verificar el rol clínico. Recarga Eloísa.' };
  if (batch.batch.handoffKind !== handoffKind ||
      String(batch.batch.practitionerRoleId) !== String(info.practitionerRoleId)) {
    return { error: 'El rol de la sesión cambió. Actualiza la entrega de turno antes de guardar.' };
  }
  const activeEncounter = await verifyEncounterStillHospitalized(encId, info);
  if (activeEncounter.error) return activeEncounter;
  const claimsResult = await fetchFichaClaims(info);
  if (claimsResult.error) return claimsResult;
  const canWriteHandoff = (
    hasFichaClaim(claimsResult, 'Ver_Cambio_Turno') &&
    hasFichaClaim(claimsResult, 'Ingresar_Cambio_Turno')
  );
  if (!canWriteHandoff) {
    return { error: 'El perfil no tiene permiso para ingresar entregas de turno.' };
  }

  const baselineResult = await fetchShiftChangeEntries(encId, info);
  if (baselineResult.error) {
    return {
      error: 'No se pudo establecer el estado previo de la entrega; no se guardó. ' + baselineResult.error,
    };
  }
  const baselineEntries = baselineResult.entries.filter(entry =>
    entry && self.HhrPrescriptionPrint.entryMatchesHandoffKind(entry, handoffKind)
  );
  const handoffEntryKey = entry => clinicalRecordKey(
    'handoff',
    entry,
    entry && (entry.startDateTime || entry.createDateTime || ''),
    [
      String(entry && entry.observation || '').replace(/\s+/g, ' ').trim(),
      entry && (entry.authorHealthCarePractitionerId || entry.healthCarePractitionerId),
    ]
  );
  const baselineKeys = new Set(baselineEntries.map(handoffEntryKey));
  const timestampBaseline = collectClinicalTimestampBaseline(
    baselineEntries,
    entry => entry && (entry.startDateTime || entry.createDateTime || '')
  );
  const startedAt = Date.now();
  let created = null;
  let postAcknowledged = false;
  let uncertainPostError = '';
  const begun = await writeGuard.beginWrite();
  if (begun.error) return begun;
  try {
    const response = await fetchWithTimeout(
      `${info.apiOrigin}/api/encounter/entrySummary/shiftChangeObservationEntry`,
      {
        method: 'POST',
        headers: {
          Authorization: info.token,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'omit',
        body: JSON.stringify({
          archived: false,
          authorHealthCarePractitionerId: Number(info.practitionerId),
          authorHealthCarePractitionerRoleId: Number(info.practitionerRoleId),
          confidentialityLevelId: 4,
          encounterEventId: 0,
          encounterId: Number(encId),
          healthCarePractitionerId: Number(info.practitionerId),
          healthCarePractitionerRoleId: Number(info.practitionerRoleId),
          observation: safeObservation,
          encounterEventTypeId: handoffEventTypeId,
        }),
      }
    );
    if (!response.ok) {
      const message = 'Eloísa respondió HTTP ' + response.status + ' al guardar la entrega.';
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        return { error: message, definitelyNotApplied: true };
      }
      uncertainPostError = message;
    } else {
      postAcknowledged = true;
      const raw = await response.text();
      if (raw) {
        try { created = JSON.parse(raw); } catch (_error) { created = null; }
      }
    }
  } catch (error) {
    uncertainPostError = 'Se perdió la confirmación al guardar: ' + String((error && error.message) || error);
  }

  const createdId = String(created && (created.id || created.data && created.data.id) || '');
  const createdGuid = String(created && (created.guid || created.data && created.data.guid) || '');
  let verifiedRecord = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    const refreshed = await fetchShiftChangeEntries(encId, info);
    if (refreshed.error) continue;
    const matches = refreshed.entries.filter(entry => {
      if (!postAcknowledged) return false;
      if (!entry) return false;
      if (!self.HhrPrescriptionPrint.entryMatchesHandoffKind(entry, handoffKind)) return false;
      if (createdId && String(entry.id || '') !== createdId) return false;
      if (createdGuid && String(entry.guid || '') !== createdGuid) return false;
      if (baselineKeys.has(handoffEntryKey(entry))) return false;
      const entryDateTime = entry.startDateTime || entry.createDateTime || '';
      if (!hasNewClinicalTimestamp(entryDateTime, timestampBaseline, startedAt)) return false;
      const authorId = String(
        entry.authorHealthCarePractitionerId || entry.healthCarePractitionerId || ''
      );
      const authorMatches = authorId
        ? authorId === String(info.practitionerId)
        : Boolean(createdId || createdGuid);
      return String(entry.observation || '').replace(/\s+/g, ' ').trim() === normalizedObservation &&
        authorMatches;
    });
    if (matches.length === 1) {
      verifiedRecord = self.HhrPrescriptionPrint.deriveLatestShiftChange(matches, { kind: handoffKind });
      break;
    }
  }
  if (verifiedRecord) {
    const finishRegister = await readFinishRegisterEvent(encId, info);
    if (finishRegister.error) {
      return {
        error: 'La entrega quedó registrada, pero no se completó el paso Terminar. ' + finishRegister.error,
        writeMayHaveSucceeded: true,
      };
    }
    if (!finishRegister.event) {
      return {
        error: 'La entrega quedó registrada, pero Eloísa no expuso el evento necesario para completar Terminar.',
        writeMayHaveSucceeded: true,
      };
    }
    const finished = await confirmFinishRegisterEvent(encId, info, finishRegister.event);
    if (finished.error) {
      return {
        error: 'La entrega quedó registrada, pero no se completó el paso Terminar. ' + finished.error,
        writeMayHaveSucceeded: true,
      };
    }
    return {
      ok: true,
      verified: true,
      finishConfirmed: true,
      record: { ...verifiedRecord, isSigned: true, requiresValidation: false },
    };
  }
  return {
    error: (uncertainPostError ? uncertainPostError + ' ' : '') +
      'La entrega pudo haberse guardado, pero Eloísa aún no permitió verificarla. Actualiza antes de reintentar.',
    writeMayHaveSucceeded: true,
  };
};

const handleHandoffSaveRequest = async args => {
  const request = args || {};
  const batch = await readHandoffBatch(request.batchId, request.encId);
  if (batch.error) return batch;
  return withClinicalWriteLock(
    handoffClinicalWriteKey(batch.batch.handoffKind, request.encId),
    writeGuard => performHandoffSaveRequest(request, writeGuard)
  );
};

const handleHandoffReportRequest = async ({ nurseStationId }) => {
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  if (!info.identityVerified || !/^\d+$/.test(String(info.practitionerRoleId || '')) ||
      resolveSessionHandoffKind(info) !== 'nursing') {
    return { error: 'No se pudo verificar la identidad necesaria para el reporte de turno.' };
  }
  const claimsResult = await fetchFichaClaims(info);
  if (claimsResult.error) return claimsResult;
  if (!hasFichaClaim(claimsResult, 'Ver_Cambio_Turno')) {
    return { error: 'El perfil no tiene permiso para imprimir entregas de turno.' };
  }
  const station = /^\d+$/.test(String(nurseStationId || '')) ? String(nurseStationId) : '0';
  const url = new URL('/api/report/Reporte_Entrega_Turno_Enfermera.pdf', info.apiOrigin);
  url.searchParams.set('fac_id', info.facId);
  url.searchParams.set('hcp_id', info.practitionerId);
  url.searchParams.set('nus_id', station);
  url.searchParams.set('hcpr_id', info.practitionerRoleId);
  const report = await fetchOfficialPdf({ url: url.toString(), token: info.token, label: 'la entrega de turno' });
  if (report.error) return report;
  return openPdfPrintDialog({
    buffer: report.buffer,
    filename: 'Entrega_turno_enfermeria_' + new Date().toISOString().slice(0, 10) + '.pdf',
  });
};

const clinicalScoreRuntime = self.HhrClinicalScoreRuntime.create({
  chrome,
  crypto,
  fetchWithTimeout,
  getFichaFetchInfo,
  resolveGestionCamasSession,
  classifyGestionCamasRejection,
  nursingWorklists: NURSING_WORKLISTS,
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
  fetchCudyrDefinitions,
  getScaleDefinition,
  resolveCudyrFormId,
  readScoresBatch,
  handleOptionsRequest: handleScoresOptionsRequest,
  handleFormRequest: handleScoreFormRequest,
  handleCudyrCategoriesRequest,
} = clinicalScoreRuntime;
const buildClinicalAge = (birthDate, referenceDate = new Date()) => {
  const rawBirthDate = String(birthDate || '').trim();
  const dateOnly = rawBirthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const birth = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 0, 0, 0)
    : new Date(rawBirthDate);
  if (Number.isNaN(birth.getTime())) return '';
  if (dateOnly && (
    birth.getFullYear() !== Number(dateOnly[1]) ||
    birth.getMonth() !== Number(dateOnly[2]) - 1 ||
    birth.getDate() !== Number(dateOnly[3])
  )) return '';
  const now = new Date(referenceDate.getTime());
  if (Number.isNaN(now.getTime())) return '';
  if (birth.getTime() > now.getTime()) return '';
  const addCalendarYearsClamped = (date, count) => {
    const result = new Date(date.getTime());
    const month = result.getMonth();
    const day = result.getDate();
    result.setDate(1);
    result.setFullYear(result.getFullYear() + count);
    result.setMonth(month);
    result.setDate(Math.min(day, new Date(result.getFullYear(), month + 1, 0).getDate()));
    return result;
  };
  const addCalendarMonthsClamped = (date, count) => {
    const result = new Date(date.getTime());
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + count);
    result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
    return result;
  };
  let years = Math.max(0, now.getFullYear() - birth.getFullYear());
  let cursor = addCalendarYearsClamped(birth, years);
  if (cursor.getTime() > now.getTime()) {
    years = Math.max(0, years - 1);
    cursor = addCalendarYearsClamped(birth, years);
  }
  let months = Math.max(
    0,
    (now.getFullYear() - cursor.getFullYear()) * 12 + now.getMonth() - cursor.getMonth()
  );
  let monthCursor = addCalendarMonthsClamped(cursor, months);
  while (months > 0 && monthCursor.getTime() > now.getTime()) {
    months -= 1;
    monthCursor = addCalendarMonthsClamped(cursor, months);
  }
  const remainingMs = Math.max(0, now.getTime() - monthCursor.getTime());
  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remainingMs - days * 24 * 60 * 60 * 1000) / (60 * 60 * 1000));
  return String(years) + String(months).padStart(2, '0') +
    String(days).padStart(2, '0') + String(hours).padStart(2, '0');
};

const parseJsonResponseSafely = async response => {
  const raw = await response.text();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_error) { return null; }
};

const handleCudyrSave = async ({ encId, answers, patient, info, writeGuard }) => {
  const definitionResult = await fetchCudyrDefinitions(info);
  if (definitionResult.error) return definitionResult;
  const departmentId = String(patient.hospitalDepartmentId || '');
  if (!/^\d+$/.test(departmentId)) {
    return { error: 'Eloísa no informó el servicio clínico; no se guardó CUDYR.' };
  }
  const formId = resolveCudyrFormId(departmentId);
  const fields = definitionResult.rows.filter(row => String(row.formId) === formId);
  if (fields.length !== 14) return { error: 'El formulario CUDYR vigente cambió y no puede guardarse con seguridad.' };
  const normalized = [];
  for (const field of fields) {
    const answerKey = String(field.id);
    if (!answers || !Object.prototype.hasOwnProperty.call(answers, answerKey) ||
        String(answers[answerKey]).trim() === '') {
      return { error: 'Completa todos los ítems CUDYR con una opción válida.' };
    }
    const value = Number(answers[answerKey]);
    const allowed = (Array.isArray(field.categorizationFormOptionList) ? field.categorizationFormOptionList : [])
      .some(option => Number(option.value) === value);
    if (!allowed) return { error: 'Completa todos los ítems CUDYR con una opción válida.' };
    normalized.push({ id: field.id, typeId: field.typeId, value });
  }
  const score = self.HhrPrescriptionPrint.calculateCudyrCategory(normalized);
  const baselineResult = await fetchCudyrCategories(info);
  if (baselineResult.error) {
    return {
      error: 'No se pudo establecer el estado previo de CUDYR; no se guardó. ' + baselineResult.error,
    };
  }
  const baselineItem = baselineResult.items.find(item => String(item.encId) === String(encId));
  const timestampBaseline = collectClinicalTimestampBaseline(
    baselineItem ? [baselineItem] : [],
    item => item && item.crdDateTime || ''
  );
  const startedAt = Date.now();
  let postAcknowledged = false;
  let uncertainPostError = '';
  const begun = await writeGuard.beginWrite();
  if (begun.error) return begun;
  try {
    const response = await fetchWithTimeout(`${info.apiOrigin}/api/categorizationForm/save`, {
      method: 'POST',
      headers: { Authorization: info.token, Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        id: 0,
        formId: Number(formId),
        encounterId: String(encId),
        creationDate: new Date().toISOString(),
        value: score.value,
        healthCarePractitionerId: Number(info.practitionerId),
        healthCarePractitionerRoleId: Number(info.practitionerRoleId),
        isDeleted: false,
        isNew: false,
        categorizationFormDetailList: normalized.map(field => ({
          formRegistrationSummaryId: 0,
          fieldFormId: Number(field.id),
          value: field.value,
        })),
      }),
    });
    if (!response.ok) {
      const message = 'Eloísa respondió HTTP ' + response.status + ' al guardar CUDYR.';
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        return { error: message, definitelyNotApplied: true };
      }
      uncertainPostError = message;
    } else {
      postAcknowledged = true;
      await parseJsonResponseSafely(response);
    }
  } catch (error) {
    uncertainPostError = 'Se perdió la confirmación al guardar CUDYR: ' + String((error && error.message) || error);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    const refreshed = await fetchCudyrCategories(info);
    if (refreshed.error) continue;
    const item = refreshed.items.find(candidate => String(candidate.encId) === String(encId));
    if (postAcknowledged && item && item.crdValue === score.value &&
        hasNewClinicalTimestamp(item.crdDateTime, timestampBaseline, startedAt)) {
      return { ok: true, verified: true, record: { total: score.value, severity: '', dateTime: item.crdDateTime, author: info.fullName } };
    }
  }
  return {
    error: (uncertainPostError ? uncertainPostError + ' ' : '') +
      'CUDYR pudo haberse guardado, pero Eloísa aún no permitió verificarlo. Actualiza antes de reintentar.',
    writeMayHaveSucceeded: true,
  };
};

const handleEvaluationScaleSave = async ({ encId, instrument, answers, patient, info, writeGuard }) => {
  const definitionResult = await getScaleDefinition(instrument, info);
  if (definitionResult.error) return definitionResult;
  const definition = definitionResult.definition;
  const values = {};
  let total = 0;
  for (const field of definition.fields) {
    const value = String(answers && answers[field.id] != null ? answers[field.id] : '').trim();
    const required = field.required !== false;
    if (field.options.length) {
      if (!value && !required) continue;
      const selected = field.type === 7 ? value.split(',').filter(Boolean) : [value];
      if (!selected.length || selected.some(selectedId => !field.options.some(option => option.id === selectedId))) {
        return { error: 'Completa todas las respuestas de ' + instrument + ' con opciones válidas.' };
      }
      for (const selectedId of selected) {
        const option = field.options.find(item => item.id === selectedId);
        if (!Number.isFinite(option && option.score)) {
          return { error: 'El esquema de ' + instrument + ' no informó el puntaje de una respuesta.' };
        }
        total += option.score;
      }
      values[field.id] = value;
    } else {
      if (!value && required) {
        return { error: 'Completa todos los campos obligatorios de ' + instrument + '.' };
      }
      if (value) values[field.id] = value;
    }
  }
  const result = definition.results.find(item => total >= item.minScore && total <= item.maxScore);
  if (!result) return { error: 'El puntaje calculado no coincide con un rango oficial de ' + instrument + '.' };
  values[definition.scoreFieldId] = String(total);
  values[definition.resultFieldId] = String(result.valueId);
  const metaCampList = Object.keys(values).map(id => ({ id, value: values[id] }));
  const clinicalAge = buildClinicalAge(patient.birthDate);
  const administrativeSexId = Number(patient.administrativeSexId || 0);
  if (!clinicalAge || !Number.isFinite(administrativeSexId) || administrativeSexId <= 0) {
    return { error: 'Eloísa no informó edad o sexo administrativo; no se guardó el instrumento.' };
  }
  const [historyBaselineResult, baselineResult] = await Promise.all([
    fetchScaleHistoryEvents(encId, info, 120),
    fetchEvaluationForms(encId, info),
  ]);
  if (historyBaselineResult.error || baselineResult.error) {
    return {
      error: 'No se pudo establecer el historial completo previo de ' + instrument +
        '; no se guardó. ' +
        [historyBaselineResult.error, baselineResult.error].filter(Boolean).join(' '),
    };
  }
  const baselineForms = baselineResult.forms.filter(form =>
    form && String(form.formId || '') === String(definition.formId)
  );
  const evaluationFormKey = form => clinicalRecordKey(
    'evaluation-form',
    form,
    form && (form.createDateTime || form.startDateTime || ''),
    [
      form && form.formId,
      form && (form.authorHealthCarePractitionerId || form.healthCarePractitionerId),
    ]
  );
  const baselineKeys = new Set(baselineForms.map(evaluationFormKey));
  const timestampBaseline = collectClinicalTimestampBaseline(
    baselineForms,
    form => form && (form.createDateTime || form.startDateTime || '')
  );
  const startedAt = Date.now();
  let created = null;
  let postAcknowledged = false;
  let uncertainPostError = '';
  const begun = await writeGuard.beginWrite();
  if (begun.error) return begun;
  try {
    const response = await fetchWithTimeout(
      `${info.apiOrigin}/api/encounter/entrySummary/encounterFormEntry/${encodeURIComponent(encId)}`,
      {
        method: 'POST',
        headers: { Authorization: info.token, Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          encounterFormEntryTransport: {
            administrativeSexId,
            age: clinicalAge,
            facilityId: Number(info.facId),
            healthCarePractitionerId: Number(info.practitionerId),
            healthCarePractitionerRoleId: Number(info.practitionerRoleId),
            metaFormId: Number(definition.metaFormId),
            formId: Number(definition.formId),
            metaCampList,
            isRedo: false,
            encounterEventTypeId: 2,
          },
          confidentialityLevelId: 4,
          encounterEventId: 0,
          healthCarePractitionerRoleId: Number(info.practitionerRoleId),
          authorHealthCarePractitionerId: Number(info.practitionerId),
          authorHealthCarePractitionerRoleId: Number(info.practitionerRoleId),
          healthCarePractitionerId: Number(info.practitionerId),
          encounterId: Number(encId),
        }),
      }
    );
    if (!response.ok) {
      const message = 'Eloísa respondió HTTP ' + response.status + ' al guardar ' + instrument + '.';
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        return { error: message, definitelyNotApplied: true };
      }
      uncertainPostError = message;
    } else {
      postAcknowledged = true;
      created = await parseJsonResponseSafely(response);
    }
  } catch (error) {
    uncertainPostError = 'Se perdió la confirmación al guardar ' + instrument + ': ' +
      String((error && error.message) || error);
  }
  const createdId = String(created && (created.id || created.data && created.data.id) || '');
  const createdGuid = String(created && (created.guid || created.data && created.data.guid) || '');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    const refreshed = await fetchEvaluationForms(encId, info);
    if (refreshed.error) continue;
    const matches = refreshed.forms.filter(form => {
      if (!postAcknowledged) return false;
      if (!form || String(form.formId || '') !== String(definition.formId)) return false;
      if (createdId && String(form.id || '') !== createdId) return false;
      if (createdGuid && String(form.guid || '') !== createdGuid) return false;
      if (baselineKeys.has(evaluationFormKey(form))) return false;
      const authorId = String(
        form.authorHealthCarePractitionerId || form.healthCarePractitionerId || ''
      );
      if (!createdId && !createdGuid && authorId !== String(info.practitionerId)) return false;
      if (authorId && authorId !== String(info.practitionerId)) return false;
      const formValues = new Map((Array.isArray(form.metaCampList) ? form.metaCampList : [])
        .map(item => [String(item && (item.id || item.metaFieldName) || ''), String(item && (item.value != null ? item.value : item.VALUE) || '')]));
      if (metaCampList.some(item => formValues.get(item.id) !== item.value)) return false;
      return hasNewClinicalTimestamp(
        form.createDateTime || form.startDateTime || '',
        timestampBaseline,
        startedAt
      );
    });
    if (matches.length === 1) {
      return {
        ok: true,
        verified: true,
        record: {
          total,
          severity: result.valueName,
          dateTime: matches[0].createDateTime || matches[0].startDateTime || new Date().toISOString(),
          author: matches[0].authorHealthCarePractitionerName || info.fullName,
        },
      };
    }
  }
  return {
    error: (uncertainPostError ? uncertainPostError + ' ' : '') + instrument +
      ' pudo haberse guardado, pero Eloísa aún no permitió verificarlo. Actualiza antes de reintentar.',
    writeMayHaveSucceeded: true,
  };
};

const performScoreSaveRequest = async ({ batchId, encId, instrument, answers }, writeGuard) => {
  const normalizedInstrument = ['CUDYR', 'BRADEN', 'DOWNTON'].includes(String(instrument || '').toUpperCase())
    ? String(instrument).toUpperCase()
    : '';
  if (!normalizedInstrument) return { error: 'El instrumento no es válido.' };
  const batch = await readScoresBatch(batchId, encId);
  if (batch.error) return batch;
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  if (!info.identityVerified || !/enfermer/i.test(String(info.role || '')) ||
      !/^\d+$/.test(String(info.practitionerId || '')) ||
      !/^\d+$/.test(String(info.practitionerRoleId || ''))) {
    return { error: 'No se pudo verificar una sesión activa de enfermería.' };
  }
  const activeEncounter = await verifyEncounterStillHospitalized(encId, info);
  if (activeEncounter.error) return activeEncounter;
  const currentPatient = { ...batch.patient };
  if (normalizedInstrument === 'CUDYR') {
    const currentDepartmentId = String(
      activeEncounter.encounter && activeEncounter.encounter.hospitalDepartmentId || ''
    );
    if (!/^\d+$/.test(currentDepartmentId)) {
      return { error: 'Eloísa no informó el servicio clínico actual; no se guardó CUDYR.' };
    }
    if (String(batch.patient.hospitalDepartmentId || '') !== currentDepartmentId) {
      return {
        error: 'El paciente cambió de servicio desde que abriste CUDYR. Cierra el formulario y vuelve a abrirlo.',
      };
    }
    currentPatient.hospitalDepartmentId = currentDepartmentId;
  }
  const claimsResult = await fetchFichaClaims(info);
  if (claimsResult.error) return claimsResult;
  if (!hasFichaClaim(claimsResult, 'Ver_Instrumento_Evaluacion')) {
    return { error: 'El perfil no tiene permiso para ver instrumentos de evaluación.' };
  }
  if (!hasFichaClaim(claimsResult, 'Ingresar_Instrumento_Evaluacion')) {
    return { error: 'El perfil no tiene permiso para ingresar instrumentos de evaluación.' };
  }
  return normalizedInstrument === 'CUDYR'
    ? handleCudyrSave({ encId, answers, patient: currentPatient, info, writeGuard })
    : handleEvaluationScaleSave({
        encId,
        instrument: normalizedInstrument,
        answers,
        patient: currentPatient,
        info,
        writeGuard,
      });
};

const handleScoreSaveRequest = args => withClinicalWriteLock(
  'score:' + String(args && args.encId || '') + ':' +
    String(args && args.instrument || '').toUpperCase(),
  writeGuard => performScoreSaveRequest(args || {}, writeGuard)
);

const readClinicalWriteRecoveryReview = async ({ kind, encId, instrument, info }) => {
  if (kind === 'handoff') {
    const handoffKind = resolveSessionHandoffKind(info);
    if (!handoffKind) return { error: 'No se pudo verificar un rol médico o de enfermería en la sesión.' };
    const refreshed = await fetchShiftChangeEntries(encId, info);
    if (refreshed.error) return refreshed;
    const latest = self.HhrPrescriptionPrint.deriveLatestShiftChange(
      refreshed.entries,
      { kind: handoffKind }
    );
    return {
      review: {
        kind: 'handoff',
        handoffKind,
        present: Boolean(latest),
        value: String(latest && latest.observation || ''),
        dateTime: String(latest && latest.dateTime || ''),
        author: String(latest && latest.author || ''),
      },
    };
  }
  if (instrument === 'CUDYR') {
    const refreshed = await fetchCudyrCategories(info);
    if (refreshed.error) return refreshed;
    const latest = refreshed.items.find(item => String(item && item.encId || '') === String(encId));
    return {
      review: {
        kind: 'score',
        instrument,
        present: Boolean(latest && latest.crdValue),
        value: String(latest && latest.crdValue || ''),
        classification: '',
        dateTime: String(latest && latest.crdDateTime || ''),
        author: '',
      },
    };
  }
  const [history, forms] = await Promise.all([
    fetchScaleHistoryEvents(encId, info, 120),
    fetchEvaluationForms(encId, info),
  ]);
  if (history.error || forms.error) {
    return { error: [history.error, forms.error].filter(Boolean).join(' ') };
  }
  const latest = self.HhrPrescriptionPrint.deriveScaleHistory(
    history.events,
    forms.forms,
    instrument
  )[0] || null;
  return {
    review: {
      kind: 'score',
      instrument,
      present: Boolean(latest),
      value: latest ? String(latest.total) : '',
      classification: String(latest && latest.severity || ''),
      dateTime: String(latest && latest.dateTime || ''),
      author: String(latest && latest.author || ''),
    },
  };
};

const PRESCRIPTION_BATCH_PREFIX = 'hhr-prescription-batch-';
const PRESCRIPTION_BATCH_LIMIT = 24;
const sweepPrescriptionBatches = async (now = Date.now()) => {
  const stored = await chrome.storage.session.get(null);
  const entries = Object.entries(stored || {})
    .filter(([key]) => key.startsWith(PRESCRIPTION_BATCH_PREFIX));
  const expiredKeys = entries
    .filter(([, batch]) => {
      const expiresAt = Number(batch && batch.expiresAt || 0);
      return !batch || !batch.sessionKey || !Number.isFinite(Number(batch.createdAt)) ||
        expiresAt > 0 && now >= expiresAt;
    })
    .map(([key]) => key);
  const expired = new Set(expiredKeys);
  const overflowKeys = entries
    .filter(([key]) => !expired.has(key))
    .sort((left, right) =>
      Number(right[1].lastUsedAt || right[1].createdAt || 0) -
      Number(left[1].lastUsedAt || left[1].createdAt || 0)
    )
    .slice(Math.max(0, PRESCRIPTION_BATCH_LIMIT))
    .map(([key]) => key);
  const removable = [...expiredKeys, ...overflowKeys];
  if (removable.length) await chrome.storage.session.remove(removable);
};

const handleHospitalizedPrescriptionOptionsRequest = async ({ currentEncId, sender }) => {
  const infoResult = await getFichaFetchInfo(sender);
  if (infoResult.error) return infoResult;
  let patientResult = await fetchActiveHospitalizedPatients(infoResult.info);
  if (patientResult.error) {
    const snapshotResult = await handleSnapshotRequest();
    if (snapshotResult.error) return { error: patientResult.error + ' ' + snapshotResult.error };
    patientResult = {
      patients: self.HhrPrescriptionPrint.activeHospitalizedEncounters(snapshotResult.snapshot),
    };
  }
  const patients = patientResult.patients;
  if (patients.length === 0) return { ok: true, batchId: '', patients: [], unavailableCount: 0 };

  const summaries = await mapWithConcurrency(patients, 4, async patient => {
    const history = await fetchPrescriptionEvents(patient.encounterId, infoResult.info);
    if (history.error) {
      return {
        ...self.HhrPrescriptionPrint.buildHospitalizedPrescriptionSummary(patient, [], currentEncId),
        unavailableReason: history.error,
      };
    }
    const groups = self.HhrPrescriptionPrint.applyProfessionalValidationDates(
      self.HhrPrescriptionPrint.deriveProfessionalPrescriptionGroups(history.events),
      history.events,
      null
    );
    return self.HhrPrescriptionPrint.buildHospitalizedPrescriptionSummary(patient, groups, currentEncId);
  });

  const printableIds = summaries
    .filter(patient => patient.medicationCount > 0 && !patient.unavailableReason)
    .map(patient => patient.encounterId);
  const sessionKey = await fichaSessionCacheKey(infoResult.info, sender);
  const expiresAt = Number(infoResult.info && infoResult.info.expiresAt);
  await sweepPrescriptionBatches();
  const batchId = crypto.randomUUID();
  await chrome.storage.session.set({
    [`${PRESCRIPTION_BATCH_PREFIX}${batchId}`]: {
      allowedEncounterIds: printableIds,
      createdAt: Date.now(),
      sessionKey,
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
    },
  });
  return {
    ok: true,
    batchId,
    patients: summaries,
    unavailableCount: summaries.filter(patient => patient.unavailableReason).length,
  };
};

const handleHospitalizedPrescriptionPrintRequest = async ({ batchId, encIds, printFormat, sender }) => {
  self.HhrExtensionRuntime.ensurePdf();
  if (!/^[a-f0-9-]{20,}$/i.test(String(batchId || ''))) {
    return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
  }
  const storageKey = `${PRESCRIPTION_BATCH_PREFIX}${batchId}`;
  const stored = await chrome.storage.session.get(storageKey);
  const batch = stored && stored[storageKey];
  if (!batch) {
    return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
  }
  const infoResult = await getFichaFetchInfo(sender);
  if (infoResult.error) return infoResult;
  const sessionKey = await fichaSessionCacheKey(infoResult.info, sender);
  if (!self.HhrPrescriptionPrint.isPrescriptionBatchSessionValid(batch, sessionKey, Date.now())) {
    await chrome.storage.session.remove(storageKey);
    return { error: 'La sesión clínica cambió o venció. Actualiza la lista y vuelve a intentarlo.' };
  }
  const allowed = new Set(Array.isArray(batch.allowedEncounterIds) ? batch.allowedEncounterIds : []);
  const selected = Array.from(new Set(Array.isArray(encIds) ? encIds.map(String) : []))
    .filter(encId => /^\d+$/.test(encId) && allowed.has(encId));
  if (selected.length === 0) return { error: 'Selecciona al menos un paciente con receta disponible.' };
  if (selected.length > 120) return { error: 'La selección supera el máximo seguro de 120 pacientes.' };

  const activeSelection = await verifySelectedEncountersStillHospitalized(selected, infoResult.info);
  if (activeSelection.error) return activeSelection;
  const format = printFormat === 'compact' ? 'compact' : 'standard';
  const generated = await mapWithConcurrency(selected, 2, async encId => {
    const result = await createCompletePrescriptionPdf({
      encId,
      printFormat: format,
      info: infoResult.info,
      allowOfficialFallback: format === 'compact',
    });
    return result.error
      ? { encId, error: result.error }
      : { encId, buffer: result.buffer, compactFallbackReason: result.compactFallbackReason || '' };
  });
  const completed = generated.filter(item => item.buffer);
  const skipped = generated.filter(item => item.error).map(item => ({ encId: item.encId, error: item.error }));
  const compactFallbacks = completed
    .filter(item => item.compactFallbackReason)
    .map(item => ({ encId: item.encId, reason: item.compactFallbackReason }));
  if (completed.length === 0) {
    return { error: 'No se pudo generar ninguna de las recetas seleccionadas.', skipped };
  }

  let combinedBuffer;
  try {
    combinedBuffer = await self.HhrPdfPrint.mergePdfBuffers(completed.map(item => item.buffer));
  } catch (error) {
    return { error: 'No se pudieron unir las recetas: ' + String((error && error.message) || error) };
  }
  const opened = await openPdfPrintDialog({
    buffer: combinedBuffer,
    filename: self.HhrPrescriptionPrint.buildBatchPrescriptionFilename(
      completed.length,
      format,
      new Date().toISOString()
    ),
  });
  if (opened.error) return opened;
  await chrome.storage.session.set({
    [storageKey]: { ...batch, lastUsedAt: Date.now() },
  });
  return { ...opened, count: completed.length, skipped, compactFallbacks };
};

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
  if (!officialMetadata.emissionDateTime) {
    return { error: 'La receta oficial no informó su fecha y hora de emisión.' };
  }
  const group = selectedGroup;
  if (group.medications.length === 0) return { error: 'No se encontraron fármacos activos.' };
  const context = await getClinicalReportContext(
    encId,
    infoResult.info,
    group.printDateTime || group.validationDateTime
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
      emissionDateTime: officialMetadata.emissionDateTime,
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
      group.external ? 'externa-' + group.medication + '-' + group.professional : group.professional,
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
    () => handleSnapshotRequest(),
    'No se pudo leer el censo de Ficha Médico.'
  ),
  [RUNTIME_MESSAGES.OPEN_ENCOUNTER_REQUEST]: runtimeRoute(
    message => handleOpenEncounter(message.encId),
    'No se pudo abrir el episodio clínico.'
  ),
  [RUNTIME_MESSAGES.EGRESO_LOOKUP_REQUEST]: runtimeRoute(
    message => handleEgresoLookup(message.runs),
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
      handleNursingMedicalEpicrisisPrintRequest({
        encId: message.encId,
        patientRun: message.patientRun,
        sender,
      }),
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

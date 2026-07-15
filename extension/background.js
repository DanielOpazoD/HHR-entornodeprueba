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
  'encounter-navigation.js',
  'health-check.js',
  'clinical-panel-fetch.js',
  'prescription-print.js',
  'xlsx.full.min.js',
  'report-parser.js',
  'jspdf.umd.min.js',
  'pdf-lib.min.js',
  'prescription-pdf.js',
  'pdf-print.js',
  'runtime-loader.js',
);

const FICHAMEDICO_MATCH = 'https://fichamedico.rayensalud.cl/*';
const GESTIONCAMAS_MATCH = 'https://hospitalizado.rayensalud.cl/*';

const REPORT_FILE = 'Lista_Pacientes_Alta_Administrativa_Rango_Fecha.xls';
const EXTENSION_PROTOCOL_VERSION = 3;
const BACKEND_REQUEST_TIMEOUT_MS = 45_000;
const TAB_MESSAGE_TIMEOUT_MS = 50_000;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;

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

const fetchWithTimeout = async (url, options, timeoutMs = BACKEND_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Tiempo de espera agotado consultando Eloísa. Reintenta la operación.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const sendHealthProbe = (tabId, message) => withTimeout(
  chrome.tabs.sendMessage(tabId, message),
  HEALTH_PROBE_TIMEOUT_MS,
  'La pestaña no respondió a la verificación de conexión.'
);

// Try every matching tab (active/most-recent first): some may be stale tabs whose content
// script isn't injected. The first one that answers wins.
const sendToMatchingTab = async (urlMatch, message, noTabError, noAnswerError) => {
  const tabs = await chrome.tabs.query({ url: urlMatch });
  if (!tabs.length) return { error: noTabError };
  const ordered = tabs.slice().sort((a, b) => Number(b.active) - Number(a.active));
  let lastError = 'Sin respuesta de la pestaña.';
  for (const tab of ordered) {
    try {
      const response = await withTimeout(
        chrome.tabs.sendMessage(tab.id, message),
        TAB_MESSAGE_TIMEOUT_MS,
        'La pestaña de Ficha Médico no respondió dentro del tiempo esperado.'
      );
      if (response) return response;
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
  }
  return { error: noAnswerError + ' Detalle: ' + lastError };
};

const handleSnapshotRequest = () =>
  sendToMatchingTab(
    FICHAMEDICO_MATCH,
    { type: 'RAYEN_READ' },
    'No hay una pestaña de Rayen (Ficha Médico) abierta. Ábrela e inicia sesión.',
    'No se pudo leer Rayen. Recarga la pestaña de Ficha Médico (Cmd+R) para activar la extensión y reintenta.'
  );

const handleOpenEncounter = async encId => {
  const normalizedEncounterId = self.HhrEncounterNavigation.normalizeEncounterId(encId);
  if (!normalizedEncounterId) {
    return { ok: false, reused: false, error: 'El episodio clínico no es válido.' };
  }

  try {
    const matchingTabs = await chrome.tabs.query({ url: FICHAMEDICO_MATCH });
    const orderedTabs = self.HhrEncounterNavigation.orderEncounterTabs(matchingTabs);
    const existingTab = orderedTabs[0];
    const reused = Boolean(existingTab && existingTab.id != null);
    const targetUrl = self.HhrEncounterNavigation.buildEncounterUrl(
      normalizedEncounterId,
      existingTab && existingTab.url
    );
    const tab = reused
      ? await chrome.tabs.update(existingTab.id, { url: targetUrl, active: true })
      : await chrome.tabs.create({ url: targetUrl, active: true });

    if (tab && tab.windowId != null) {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (_error) {
        // The encounter is already open; failure to foreground its window is non-blocking.
      }
    }

    return { ok: true, reused };
  } catch (error) {
    return {
      ok: false,
      reused: false,
      error: 'No se pudo abrir Ficha Médico: ' + String((error && error.message) || error),
    };
  }
};

const handleExtensionHealth = async () => {
  const [fichaMedico, gestionCamas] = await Promise.all([
    chrome.tabs.query({ url: FICHAMEDICO_MATCH }).then(tabs =>
      self.HhrExtensionHealth.probeTabs({
        tabs,
        sendMessage: sendHealthProbe,
        missingMessage: 'Abre Ficha Médico e inicia sesión para sincronizar.',
        staleMessage: 'Recarga la pestaña de Ficha Médico para activar la extensión.',
      })
    ),
    chrome.tabs.query({ url: GESTIONCAMAS_MATCH }).then(tabs =>
      self.HhrExtensionHealth.probeTabs({
        tabs,
        sendMessage: sendHealthProbe,
        missingMessage: 'Gestión de Camas no está abierta.',
        staleMessage: 'Recarga Gestión de Camas para activar la extensión.',
      })
    ),
  ]);

  return {
    version: chrome.runtime.getManifest().version,
    protocolVersion: EXTENSION_PROTOCOL_VERSION,
    checkedAt: new Date().toISOString(),
    fichaMedico,
    gestionCamas,
  };
};

const handleEgresoLookup = runs =>
  sendToMatchingTab(
    GESTIONCAMAS_MATCH,
    { type: 'RAYEN_GC_LOOKUP', runs },
    'No hay una pestaña de Gestión de Camas (hospitalizado.rayensalud.cl) abierta. Ábrela e inicia sesión.',
    'No se pudo consultar Gestión de Camas. Recarga esa pestaña (Cmd+R) para activar la extensión y reintenta.'
  );

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

// Fetch the report .xls bytes for a date range. Dates are ISO (YYYY-MM-DD); the server's params
// are fac_id / start_datetime / end_datetime (confirmed live — the older FAC_ID/DATE_START/
// DATE_END form silently returns an EMPTY report). Token + API base come from the open Gestión de
// Camas tab; the GET runs here in the background, where host_permissions bypass the CORS that
// blocks a page fetch.
const fetchReportBuffer = async ({ dateStart, dateEnd }) => {
  if (!dateStart || !dateEnd) return { error: 'Faltan fechas para el reporte.' };
  const infoResp = await sendToMatchingTab(
    GESTIONCAMAS_MATCH,
    { type: 'RAYEN_GC_GET_FETCH_INFO' },
    'No hay una pestaña de Gestión de Camas (hospitalizado.rayensalud.cl) abierta. Ábrela e inicia sesión.',
    'No se pudo obtener el token de Gestión de Camas. Recarga esa pestaña (Cmd+R) y reintenta.'
  );
  if (infoResp.error) return { error: infoResp.error };
  const info = infoResp.info;
  if (!info || !info.token || !info.apiBase) {
    return { error: 'Sin token de Gestión de Camas. Recarga esa pestaña e inicia sesión.' };
  }
  const url =
    `${info.apiBase}/report/${REPORT_FILE}` +
    `?fac_id=${encodeURIComponent(info.facId)}` +
    `&start_datetime=${encodeURIComponent(dateStart)}&end_datetime=${encodeURIComponent(dateEnd)}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: info.token } });
    if (!res.ok) return { error: 'El servidor de reportes respondió HTTP ' + res.status + '.' };
    return { buffer: await res.arrayBuffer() };
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
const handleScalesReportRequest = async ({ encId }) => {
  if (!encId) return { error: 'Falta enc_id para las escalas de evaluación.' };
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

// Fetch one patient's clinical history report (same endpoint as the scales history) and return the
// events slimmed to the CLINICAL PANEL resumes: medical evolutions, nursing shift-change notes and
// active indications (pharma / free-text / diet / rest). Each resume keeps ONLY the whitelisted
// fields HHR renders — author, timestamp, status flags and the clinical text — nothing else leaves
// the page. Deliberately excluded (unused at HHR): procedure indications, nurse physical exams,
// invasive devices (those come from the PDF report) and diagnosis resumes.
const pickFields = (list, fields) =>
  Array.isArray(list)
    ? list.map(item => {
        const out = {};
        for (const f of fields) out[f] = item ? item[f] : undefined;
        return out;
      })
    : [];
const CLINICAL_PANEL_RESUMES = {
  evolutionResume: [
    'OBE_NOTES', 'OBE_PUBLISH_DATETIME', 'OBE_START_DATETIME',
    // HCPR_NAME is the practitioner's ROLE (Médico/Enfermera/…); the person's name arrives split
    // in the HCP_* name parts — HHR composes "Nombre Apellido" from them and files the evolution
    // under Médicas / Enfermería / Otros by the role.
    'HCPR_NAME', 'HCP_FGN', 'HCP_NGN', 'HCP_FFN', 'HCP_SFN',
    'HCP_LEGAL', 'ARCHIVED', 'IS_CROSSED_OUT', 'OBE_AMENDED', 'id',
  ],
  shiftChangeResume: [
    'OBSERVATION', 'HCPR_NAME', 'HCP_FGN', 'HCP_NGN', 'HCP_FFN', 'HCP_SFN',
    'HCP_LEGAL', 'PUBLISH_DATETIME', 'ARCHIVED', 'ID',
  ],
  patientPharmaIndicationResume: [
    'DESCRIPTOR', 'VIRTUAL_MEDICAL_PRODUCT', 'POSOLOGY', 'ROUTE_ADMINISTRATION',
    'MRE_ADMINISTRATION_NOTE', 'SUSPENDED', 'IS_NEW', 'IS_DISCHARGE',
    'HCP_NAME', 'HCP_ROLE', 'PUBLISH_DATETIME', 'MRE_ID', 'ARCHIVED',
    'IS_EXTERNAL', 'is_external', 'ALL_MEDICATION', 'allMedication',
  ],
  patientFreeIndicationResume: [
    'INDICATION', 'HCP_NAME', 'HCP_ROLE', 'PUBLISH_DATETIME',
    'SUSPENDED', 'IS_NEW', 'IS_DISCHARGE', 'AMRE_ID', 'ARCHIVED',
  ],
  nutritionOrderResume: ['DIET_type', 'OBSERVATION', 'HCPR_NAME', 'HCP_LEGAL', 'PUBLISH_DATETIME', 'ARCHIVED'],
  restResume: ['rest_type', 'OBSERVATION', 'HCPR_NAME', 'HCP_LEGAL', 'PUBLISH_DATETIME', 'ARCHIVED'],
};

const slimCarePlanHeaders = payload =>
  Array.isArray(payload && payload.carePlanHeader)
    ? payload.carePlanHeader.map(header => ({
        label: header && header.label,
        labelDate: header && header.labelDate,
        scheduledDate: header && header.scheduledDate,
        isSuspended: header && header.isSuspended,
        carePlanBody: pickFields(header && header.carePlanBody, [
          'entryGuid',
          'activityId',
          'activity',
          'title',
          'tag',
          'hoursRange',
          'hoursRangeActi',
          'administrationDate',
          'timestamp',
          'user',
          'isPerformed',
          'isPerformedOutSidePlanning',
          'isFinished',
          'isSuspended',
          'doNotExecute',
        ]),
      }))
    : [];

const slimMedicationStates = payload =>
  pickFields(payload && payload.Medication, [
    'id',
    'suspended',
    'archived',
    'finalized',
    'programmingEndDatetime',
  ]);

const fetchFichaJson = (url, token) =>
  self.HhrClinicalPanelFetch.fetchJsonWithTimeout({ url, token, fetchImpl: fetch });

const fetchMedicationStates = async (baseUrl, isSuspended, token) => {
  const rows = await self.HhrClinicalPanelFetch.fetchMedicationPages({
    fetchPage: (page, limit) =>
      fetchFichaJson(`${baseUrl}?page=${page}&limit=${limit}&isSuspended=${isSuspended}`, token),
  });
  return slimMedicationStates({ Medication: rows });
};

const handleClinicalPanelRequest = async ({ encId }) => {
  if (!encId) return { error: 'Falta enc_id para el panel clínico.' };
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
  const historyUrl =
    `${info.apiOrigin}/api/encounter/${encodeURIComponent(encId)}/` +
    `getPatientEncounterHistoryReportServer/false/0/0/-14`;
  const encodedEncounter = encodeURIComponent(encId);
  const careUrl = `${info.apiOrigin}/api/carePlanAssignedCare/${encodedEncounter}?page=0&limit=100&showAll=false`;
  const medicationBase = `${info.apiOrigin}/api/carePlanMedication/${encodedEncounter}`;

  const [historyResult, careResult, activeMedicationResult, suspendedMedicationResult] =
    await Promise.allSettled([
      fetchFichaJson(historyUrl, info.token),
      fetchFichaJson(careUrl, info.token),
      fetchMedicationStates(medicationBase, false, info.token),
      fetchMedicationStates(medicationBase, true, info.token),
    ]);

  let sources;
  try {
    sources = self.HhrClinicalPanelFetch.unwrapRequiredSources([
      { label: 'historial clínico', result: historyResult },
      { label: 'plan de cuidados', result: careResult },
      { label: 'medicamentos activos', result: activeMedicationResult },
      { label: 'medicamentos inactivos', result: suspendedMedicationResult },
    ]);
  } catch (error) {
    return {
      error:
        'Falló la descarga del panel clínico: ' +
        String((error && error.message) || error),
    };
  }

  const [rawHistory, carePayload, activeMedicationStates, suspendedMedicationStates] = sources;

  const events = [];
  for (const ev of Array.isArray(rawHistory) ? rawHistory : []) {
    if (!ev) continue;
    const slim = { publishDatetime: ev.publishDatetime || '' };
    let hasContent = false;
    for (const [resume, fields] of Object.entries(CLINICAL_PANEL_RESUMES)) {
      const picked = pickFields(ev[resume], fields);
      slim[resume] = picked;
      if (picked.length > 0) hasContent = true;
    }
    if (hasContent) events.push(slim);
  }

  return {
    ok: true,
    events,
    carePlan: {
      carePlanHeaders: slimCarePlanHeaders(carePayload),
      medicationStates: [...activeMedicationStates, ...suspendedMedicationStates],
    },
  };
};

// Fetch medication indication history and keep it inside the extension. The page UI receives only
// the active groups already normalized by author; print requests re-fetch the source instead of
// trusting rows sent back by the DOM.
const getFichaFetchInfo = async () => {
  const infoResp = await sendToMatchingTab(
    FICHAMEDICO_MATCH,
    { type: 'RAYEN_FM_GET_FETCH_INFO' },
    'No hay una pestaña de Ficha Médico abierta. Ábrela e inicia sesión.',
    'No se pudo obtener la sesión de Ficha Médico. Recarga la página (Cmd+R) y reintenta.'
  );
  if (infoResp.error) return { error: infoResp.error };
  const info = infoResp.info;
  if (!info || !info.token || !info.apiOrigin) {
    return { error: 'Sin sesión de Ficha Médico. Recarga la página e inicia sesión.' };
  }
  return { info };
};

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

const getClinicalReportContext = async (encId, knownInfo, referenceDateTime) => {
  if (!/^\d+$/.test(String(encId || ''))) return { error: 'El episodio clínico no es válido.' };
  const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo();
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

const fetchOfficialPdf = async ({ url, token, label }) => {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: token, Accept: 'application/pdf' },
      credentials: 'omit',
    });
    if (res.status === 401 || res.status === 403) {
      return { fatal: true, status: res.status, error: 'Eloísa no autorizó ' + label + ' para la sesión actual.' };
    }
    if (!res.ok) {
      let detail = '';
      try {
        const contentType = res.headers.get('content-type') || '';
        if (/text|json/i.test(contentType)) detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 180);
      } catch (_error) {}
      return { status: res.status, error: 'HTTP ' + res.status + (detail ? ': ' + detail : '') };
    }
    const buffer = await res.arrayBuffer();
    const signature = String.fromCharCode.apply(null, new Uint8Array(buffer).slice(0, 4));
    if (signature !== '%PDF') return { status: res.status, error: 'La respuesta no es un PDF válido.' };
    return { buffer };
  } catch (error) {
    return { error: 'Falló la conexión con Eloísa: ' + String((error && error.message) || error) };
  }
};

const fetchPrescriptionReportBuffer = async ({ encId, info: knownInfo }) => {
  const context = await getClinicalReportContext(encId, knownInfo);
  if (context.error) return context;
  const { info, patientId } = context;
  const url = self.HhrPrescriptionPrint.buildPrescriptionReportUrl(
    info.apiOrigin,
    encId,
    info.practitionerId,
    patientId
  );
  if (!url) return { error: 'No se pudo construir la solicitud de receta.' };
  const result = await fetchOfficialPdf({ url, token: info.token, label: 'la impresión de la receta' });
  return result.buffer ? { buffer: result.buffer } : { error: result.error };
};

const fetchIndicationsReportBuffer = async ({ encId, info: knownInfo }) => {
  const context = await getClinicalReportContext(encId, knownInfo);
  if (context.error) return context;
  const { info, patientId } = context;
  const url = self.HhrPrescriptionPrint.buildIndicationsReportUrl(
    info.apiOrigin,
    encId,
    info.practitionerId,
    patientId
  );
  if (!url) return { error: 'No se pudo construir la solicitud de indicaciones.' };
  const result = await fetchOfficialPdf({ url, token: info.token, label: 'el reporte de indicaciones' });
  return result.buffer ? { buffer: result.buffer } : { error: result.error };
};

const fetchRegimenReportBuffer = async ({ info: knownInfo }) => {
  const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  const url = self.HhrPrescriptionPrint.buildRegimenReportUrl(
    info.apiOrigin,
    info.facId
  );
  if (!url) return { error: 'No se pudo construir la solicitud del reporte de regímenes.' };
  const result = await fetchOfficialPdf({
    url,
    token: info.token,
    label: 'el reporte de regímenes para Nutrición',
  });
  return result.buffer ? { buffer: result.buffer } : { error: result.error };
};

const downloadPdfBuffer = async ({ buffer, filename }) => {
  try {
    const id = await chrome.downloads.download({
      url: 'data:application/pdf;base64,' + bufferToBase64(buffer),
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    return { ok: true, downloadId: id };
  } catch (error) {
    return { error: 'No se pudo descargar el PDF: ' + String((error && error.message) || error) };
  }
};

const openPdfPrintDialog = async ({ buffer, filename }) => {
  try {
    self.HhrExtensionRuntime.ensurePdf();
    const printableBuffer = await self.HhrPdfPrint.preparePdfForBrowserPrint(buffer);
    const jobId = crypto.randomUUID();
    const storageKey = `hhr-pdf-print-${jobId}`;
    await chrome.storage.session.set({
      [storageKey]: {
        base64: bufferToBase64(printableBuffer),
        filename,
        createdAt: Date.now(),
      },
    });
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`print-pdf.html?job=${encodeURIComponent(jobId)}`),
      active: true,
    });
    return { ok: true, printTabId: tab && tab.id };
  } catch (error) {
    return { error: 'No se pudo abrir el diálogo de impresión: ' + String((error && error.message) || error) };
  }
};

const createCompletePrescriptionPdf = async ({ encId, printFormat, info }) => {
  const format = printFormat === 'compact' ? 'compact' : 'standard';
  const officialResult = await fetchPrescriptionReportBuffer({ encId, info });
  if (officialResult.error) return officialResult;
  if (format === 'standard') {
    return {
      buffer: officialResult.buffer,
      filename: self.HhrPrescriptionPrint.buildPrescriptionFilename(encId),
    };
  }

  self.HhrExtensionRuntime.ensurePdf();

  let officialContent;
  try {
    officialContent = await self.HhrPrescriptionPrint.extractOfficialPrescriptionContent(
      officialResult.buffer
    );
  } catch (error) {
    return { error: 'No se pudo compactar la receta oficial: ' + String((error && error.message) || error) };
  }
  if (!officialContent || !officialContent.folio || !officialContent.emissionDateTime) {
    return { error: 'La receta oficial no informó todo el contenido necesario para su versión compacta.' };
  }
  if (!officialContent.medications.length) {
    return { error: 'La receta oficial no contiene fármacos para compactar.' };
  }

  try {
    return {
      buffer: self.HhrPrescriptionPdf.generateProfessionalPrescriptionPdf({
        patient: officialContent.patient,
        professional: officialContent.professional,
        professionalRun: officialContent.professionalRun,
        medications: officialContent.medications,
        validationDate: officialContent.prescriptionDate,
        emissionDateTime: officialContent.emissionDateTime,
        folio: officialContent.folio,
        printedBy: officialContent.printedBy,
        address: officialContent.address,
        officialEquivalent: true,
        printFormat: format,
      }),
      filename: self.HhrPrescriptionPrint.buildPrescriptionFilename(
        encId,
        officialContent.professional || 'vigente',
        format
      ),
    };
  } catch (error) {
    return { error: 'No se pudo generar la receta compacta: ' + String((error && error.message) || error) };
  }
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

const clinicalWriteLocks = new Set();
const clinicalWriteAckLocks = new Set();
const CLINICAL_WRITE_RECOVERY_DELAY_MS = 60 * 1000;
const CLINICAL_WRITE_RECOVERY_PREVIEW_TTL_MS = 5 * 60 * 1000;
const clinicalWriteStorage = chrome.storage.local;

const clinicalWriteAmbiguityStorageKey = async key => {
  const bytes = new TextEncoder().encode(String(key || ''));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  return 'hhr-clinical-write-guard-' + hash;
};

const readClinicalWriteAmbiguity = async key => {
  try {
    const storageKey = await clinicalWriteAmbiguityStorageKey(key);
    const stored = await clinicalWriteStorage.get(storageKey);
    const marker = stored && stored[storageKey];
    if (marker) {
      return {
        active: true,
        marker,
      };
    }
    return { active: false };
  } catch (error) {
    return {
      error: 'No se pudo comprobar la protección contra duplicados: ' +
        String((error && error.message) || error),
    };
  }
};

const persistClinicalWriteAmbiguity = async (key, details = {}) => {
  const now = Date.now();
  const createdAt = Number(details.createdAt || now);
  const marker = {
    schemaVersion: 3,
    state: String(details.state || 'ambiguous'),
    generationId: String(details.generationId || ''),
    receiptId: String(details.receiptId || ''),
    recoveryTokenHash: String(details.recoveryTokenHash || ''),
    recoveryReviewMac: String(details.recoveryReviewMac || ''),
    recoveryPreviewedAt: Number(details.recoveryPreviewedAt || 0),
    recoveryPreviewExpiresAt: Number(details.recoveryPreviewExpiresAt || 0),
    createdAt,
    updatedAt: now,
  };
  try {
    const storageKey = await clinicalWriteAmbiguityStorageKey(key);
    await clinicalWriteStorage.set({ [storageKey]: marker });
    return { ok: true, marker };
  } catch (error) {
    return {
      error: 'No se pudo persistir el bloqueo preventivo: ' +
        String((error && error.message) || error),
    };
  }
};

const transitionClinicalWriteAmbiguity = async (key, generationId, details = {}) => {
  try {
    const storageKey = await clinicalWriteAmbiguityStorageKey(key);
    const stored = await clinicalWriteStorage.get(storageKey);
    const marker = stored && stored[storageKey];
    if (!marker || marker.generationId !== generationId) {
      return { error: 'La generación del guardado clínico cambió; se mantuvo su protección.' };
    }
    return persistClinicalWriteAmbiguity(key, {
      ...marker,
      ...details,
      generationId,
      createdAt: marker.createdAt,
    });
  } catch (error) {
    return {
      error: 'No se pudo actualizar la protección del guardado clínico: ' +
        String((error && error.message) || error),
    };
  }
};

const createClinicalWriteReceiptId = () => {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint32Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(8, '0')).join('-');
};

const acknowledgeClinicalWrite = async ({ key, generationId, receiptId }) => {
  const normalizedKey = String(key || '');
  const normalizedGenerationId = String(generationId || '');
  const normalizedReceiptId = String(receiptId || '');
  if (!/^(?:handoff:\d+|score:\d+:(?:CUDYR|BRADEN|DOWNTON))$/.test(normalizedKey) ||
      !/^[a-f0-9-]{20,}$/i.test(normalizedGenerationId) ||
      !/^[a-f0-9-]{20,}$/i.test(normalizedReceiptId)) {
    return { error: 'El acuse del guardado clínico no es válido.' };
  }
  if (clinicalWriteLocks.has(normalizedKey) || clinicalWriteAckLocks.has(normalizedKey)) {
    return { error: 'El guardado clínico todavía está procesando otra confirmación.' };
  }
  clinicalWriteAckLocks.add(normalizedKey);
  try {
    const storageKey = await clinicalWriteAmbiguityStorageKey(normalizedKey);
    const stored = await clinicalWriteStorage.get(storageKey);
    const marker = stored && stored[storageKey];
    if (!marker || marker.state !== 'awaiting-client-ack' ||
        marker.generationId !== normalizedGenerationId ||
        marker.receiptId !== normalizedReceiptId) {
      return { error: 'El acuse no coincide con el guardado clínico pendiente.' };
    }
    const cleared = await clearClinicalWriteAmbiguity(normalizedKey, {
      generationId: normalizedGenerationId,
      receiptId: normalizedReceiptId,
    });
    return cleared.error ? cleared : { ok: true };
  } catch (error) {
    return {
      error: 'No se pudo confirmar localmente la recepción del guardado: ' +
        String((error && error.message) || error),
    };
  } finally {
    clinicalWriteAckLocks.delete(normalizedKey);
  }
};

const clearClinicalWriteAmbiguity = async (key, expected = {}) => {
  try {
    const storageKey = await clinicalWriteAmbiguityStorageKey(key);
    if (expected.state || expected.generationId || expected.receiptId ||
        expected.recoveryTokenHash || expected.recoveryReviewMac) {
      const stored = await clinicalWriteStorage.get(storageKey);
      const marker = stored && stored[storageKey];
      if (!marker || expected.state && marker.state !== expected.state ||
          expected.generationId && marker.generationId !== expected.generationId ||
          expected.receiptId && marker.receiptId !== expected.receiptId ||
          expected.recoveryTokenHash && marker.recoveryTokenHash !== expected.recoveryTokenHash ||
          expected.recoveryReviewMac && marker.recoveryReviewMac !== expected.recoveryReviewMac) {
        return { error: 'La protección pertenece a otro guardado clínico y no se liberó.' };
      }
    }
    await clinicalWriteStorage.remove(storageKey);
    return { ok: true };
  } catch (error) {
    return {
      error: 'No se pudo liberar la protección local del guardado: ' +
        String((error && error.message) || error),
    };
  }
};

const serializeClinicalWriteProtection = async key => {
  const result = await readClinicalWriteAmbiguity(key);
  if (result.error) return { state: 'unavailable', error: result.error };
  if (!result.active) return null;
  const marker = result.marker || {};
  return {
    key,
    state: String(marker.state || 'ambiguous'),
    generationId: String(marker.generationId || ''),
    receiptId: marker.state === 'awaiting-client-ack' ? String(marker.receiptId || '') : '',
    createdAt: Number(marker.createdAt || 0),
  };
};

const withClinicalWriteLock = async (key, task) => {
  const ambiguity = await readClinicalWriteAmbiguity(key);
  if (ambiguity.error) return ambiguity;
  if (ambiguity.active) {
    return {
      error: 'Existe un guardado clínico pendiente de confirmación. Actualiza los datos y revisa ' +
        'su estado en Eloísa antes de volver a registrar.',
      writeMayHaveSucceeded: true,
      clinicalWriteProtection: {
        state: String(ambiguity.marker && ambiguity.marker.state || 'ambiguous'),
        generationId: String(ambiguity.marker && ambiguity.marker.generationId || ''),
      },
    };
  }
  if (clinicalWriteLocks.has(key) || clinicalWriteAckLocks.has(key)) {
    return { error: 'Ya hay un guardado clínico en curso para este paciente.' };
  }
  let generationId = '';
  try {
    generationId = createClinicalWriteReceiptId();
  } catch (error) {
    return {
      error: 'No se pudo preparar el identificador seguro del guardado: ' +
        String((error && error.message) || error),
    };
  }
  clinicalWriteLocks.add(key);
  let writeBegun = false;
  const writeGuard = {
    generationId,
    beginWrite: async () => {
      if (writeBegun) return { ok: true };
      const persisted = await persistClinicalWriteAmbiguity(key, {
        state: 'in-flight',
        generationId,
      });
      if (persisted.error) return persisted;
      writeBegun = true;
      return { ok: true };
    },
  };
  try {
    const result = await task(writeGuard);
    if (!writeBegun) return result;
    const publicResult = result && typeof result === 'object'
      ? Object.fromEntries(Object.entries(result).filter(([name]) => name !== 'definitelyNotApplied'))
      : result;
    if (result && result.definitelyNotApplied) {
      const cleared = await clearClinicalWriteAmbiguity(key, { generationId });
      if (cleared.error) {
        return {
          ...publicResult,
          error: String(result.error || '') + ' ' + cleared.error,
        };
      }
      return publicResult;
    }
    if (result && result.ok && result.verified) {
      let receiptId = '';
      try {
        receiptId = createClinicalWriteReceiptId();
      } catch (error) {
        const protectedResult = await transitionClinicalWriteAmbiguity(key, generationId, {
          state: 'ambiguous',
        });
        return {
          error: 'El guardado fue verificado en Eloísa, pero no se pudo crear su acuse local. ' +
            String((error && error.message) || error) +
            (protectedResult.error ? ' ' + protectedResult.error : '') +
            ' Actualiza antes de reintentar.',
          writeMayHaveSucceeded: true,
        };
      }
      const persisted = await transitionClinicalWriteAmbiguity(key, generationId, {
        state: 'awaiting-client-ack',
        receiptId,
      });
      if (persisted.error) {
        return {
          error: 'El guardado fue verificado en Eloísa, pero no se pudo proteger su confirmación local. ' +
            persisted.error + ' Actualiza antes de reintentar.',
          writeMayHaveSucceeded: true,
        };
      }
      return {
        ...publicResult,
        clinicalWriteReceipt: { key, generationId, receiptId },
      };
    }
    const persisted = await transitionClinicalWriteAmbiguity(key, generationId, {
      state: 'ambiguous',
    });
    if (persisted.error) {
      return {
        ...(publicResult && typeof publicResult === 'object' ? publicResult : {}),
        error: String(publicResult && publicResult.error || 'El guardado no pudo confirmarse.') +
          ' ' + persisted.error,
        writeMayHaveSucceeded: true,
      };
    }
    return {
      ...(publicResult && typeof publicResult === 'object' ? publicResult : {}),
      writeMayHaveSucceeded: true,
    };
  } catch (error) {
    if (!writeBegun) {
      return { error: 'No se pudo preparar el guardado clínico: ' + String((error && error.message) || error) };
    }
    const persisted = await transitionClinicalWriteAmbiguity(key, generationId, {
      state: 'ambiguous',
    });
    return {
      error: 'Se perdió la confirmación del guardado clínico: ' + String((error && error.message) || error) +
        (persisted.error ? ' ' + persisted.error : ''),
      writeMayHaveSucceeded: true,
    };
  } finally {
    clinicalWriteLocks.delete(key);
  }
};

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

const handleHandoffOptionsRequest = async ({ currentEncId }) => {
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  const identityReady = Boolean(
    info.identityVerified && /^\d+$/.test(String(info.practitionerId || '')) &&
      /^\d+$/.test(String(info.practitionerRoleId || '')) && /enfermer/i.test(String(info.role || ''))
  );
  if (!identityReady) return { error: 'No se pudo verificar la identidad y rol de enfermería de la sesión.' };
  const claimsResult = await fetchFichaClaims(info);
  if (claimsResult.error) return claimsResult;
  if (!hasFichaClaim(claimsResult, 'Ver_Cambio_Turno')) {
    return { error: 'El perfil no tiene permiso para ver entregas de turno.' };
  }
  const patientResult = await fetchActiveHospitalizedPatients(info);
  if (patientResult.error) return patientResult;
  const [nurseStations, summaries] = await Promise.all([
    fetchNurseStations(info),
    mapWithConcurrency(patientResult.patients, 4, async patient => {
      const [result, clinicalWriteProtection] = await Promise.all([
        fetchShiftChangeEntries(patient.encounterId, info),
        serializeClinicalWriteProtection('handoff:' + String(patient.encounterId)),
      ]);
      return {
        ...patient,
        isCurrent: String(patient.encounterId) === String(currentEncId || ''),
        latestHandoff: result.error
          ? null
          : self.HhrPrescriptionPrint.deriveLatestShiftChange(result.entries),
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
    },
  });
  return {
    ok: true,
    batchId,
    patients: summaries,
    nurseStations,
    canWrite,
    currentProfessional: info.fullName || '',
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
  return { ok: true };
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
  const identityReady = Boolean(
    info.identityVerified && /^\d+$/.test(String(info.practitionerId || '')) &&
      /^\d+$/.test(String(info.practitionerRoleId || '')) && /enfermer/i.test(String(info.role || ''))
  );
  if (!identityReady) return { error: 'No se pudo verificar la identidad de enfermería. Recarga Eloísa.' };
  const activeEncounter = await verifyEncounterStillHospitalized(encId, info);
  if (activeEncounter.error) return activeEncounter;
  const claimsResult = await fetchFichaClaims(info);
  if (claimsResult.error) return claimsResult;
  if (!hasFichaClaim(claimsResult, 'Ver_Cambio_Turno') ||
      !hasFichaClaim(claimsResult, 'Ingresar_Cambio_Turno')) {
    return { error: 'El perfil no tiene permiso para ingresar entregas de turno.' };
  }

  const baselineResult = await fetchShiftChangeEntries(encId, info);
  if (baselineResult.error) {
    return {
      error: 'No se pudo establecer el estado previo de la entrega; no se guardó. ' + baselineResult.error,
    };
  }
  const baselineEntries = baselineResult.entries.filter(entry =>
    entry && (!entry.encounterEventTypeId || Number(entry.encounterEventTypeId) === 2)
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
          encounterEventTypeId: 2,
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    const refreshed = await fetchShiftChangeEntries(encId, info);
    if (refreshed.error) continue;
    const matches = refreshed.entries.filter(entry => {
      if (!postAcknowledged) return false;
      if (!entry || Number(entry.encounterEventTypeId || 0) !== 2) return false;
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
      const verified = self.HhrPrescriptionPrint.deriveLatestShiftChange(matches);
      return { ok: true, verified: true, record: verified };
    }
  }
  return {
    error: (uncertainPostError ? uncertainPostError + ' ' : '') +
      'La entrega pudo haberse guardado, pero Eloísa aún no permitió verificarla. Actualiza antes de reintentar.',
    writeMayHaveSucceeded: true,
  };
};

const handleHandoffSaveRequest = args => withClinicalWriteLock(
  'handoff:' + String(args && args.encId || ''),
  writeGuard => performHandoffSaveRequest(args || {}, writeGuard)
);

const handleHandoffReportRequest = async ({ nurseStationId }) => {
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  if (!info.identityVerified || !/^\d+$/.test(String(info.practitionerRoleId || '')) ||
      !/enfermer/i.test(String(info.role || ''))) {
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

const CLINICAL_FORMS_ORIGIN = 'https://formulariosclinicosback.rayensalud.cl';
const CUDYR_MENTAL_DEPARTMENT_IDS = new Set(['45', '46', '47', '49', '50', '51']);

const fetchCudyrCategories = async info => {
  if (!/^\d+$/.test(String(info && info.facId || ''))) {
    return { error: 'La sesión no informó un establecimiento verificable para consultar CUDYR.' };
  }
  const byEnc = new Map();
  let successfulLists = 0;
  for (const list of NURSING_WORKLISTS) {
    try {
      const response = await fetchWithTimeout(
        `${info.apiOrigin}/api/encounter/${list}/${encodeURIComponent(info.facId)}`,
        {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        }
      );
      if (!response.ok) continue;
      successfulLists += 1;
      const rows = await response.json();
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || row.id == null) continue;
        byEnc.set(String(row.id), {
          encId: String(row.id),
          crdValue: String(row.crdValue || '').trim(),
          crdDateTime: String(row.crdDateTime || '').trim(),
        });
      }
    } catch (_error) {}
  }
  if (successfulLists !== NURSING_WORKLISTS.length) {
    return { error: 'Eloísa no permitió verificar las tres listas CUDYR; los valores podrían estar incompletos.' };
  }
  return { items: [...byEnc.values()] };
};

const fetchCudyrDefinitions = async info => {
  try {
    const response = await fetchWithTimeout(
      `${info.apiOrigin}/api/categorizationForm/getAllCategorizationForm`,
      {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
      }
    );
    if (!response.ok) return { error: 'Eloísa respondió HTTP ' + response.status + ' al leer CUDYR.' };
    const rows = await response.json();
    return { rows: Array.isArray(rows) ? rows : [] };
  } catch (error) {
    return { error: 'No se pudo leer el formulario CUDYR: ' + String((error && error.message) || error) };
  }
};

const normalizeApiArray = payload => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.content)) return payload.content;
  return [];
};

const fetchClinicalFormsCatalog = async info => {
  try {
    const url = new URL('/api/Form', CLINICAL_FORMS_ORIGIN);
    url.searchParams.set('hcpr_id', info.practitionerRoleId);
    url.searchParams.set('fac_id', info.facId);
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) return { error: 'Formularios Clínicos respondió HTTP ' + response.status + '.' };
    return { forms: normalizeApiArray(await response.json()) };
  } catch (error) {
    return { error: 'No se pudo leer el catálogo de instrumentos: ' + String((error && error.message) || error) };
  }
};

const fetchClinicalFormSchema = async (formId, info) => {
  if (!/^\d+$/.test(String(formId || ''))) return { error: 'El instrumento seleccionado no es válido.' };
  try {
    const response = await fetchWithTimeout(`${CLINICAL_FORMS_ORIGIN}/api/Form/${encodeURIComponent(formId)}`, {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) return { error: 'Formularios Clínicos respondió HTTP ' + response.status + '.' };
    const payload = await response.json();
    return { schema: payload && payload.data ? payload.data : payload };
  } catch (error) {
    return { error: 'No se pudo leer el instrumento: ' + String((error && error.message) || error) };
  }
};

const flattenClinicalFormFields = sections => {
  const fields = [];
  const visit = section => {
    if (!section || typeof section !== 'object') return;
    const direct = Array.isArray(section.fields) ? section.fields : [];
    direct.forEach(field => fields.push(field));
    const children = [
      ...(Array.isArray(section.subSections) ? section.subSections : []),
      ...(Array.isArray(section.sections) ? section.sections : []),
    ];
    children.forEach(visit);
  };
  (Array.isArray(sections) ? sections : []).forEach(visit);
  return fields;
};

const resolveClinicalFieldRequired = (field, meta) => {
  const requirementFlags = [
    field && field.required,
    field && field.isRequired,
    field && field.mandatory,
    field && field.isMandatory,
    meta && meta.required,
    meta && meta.isRequired,
    meta && meta.mandatory,
    meta && meta.isMandatory,
  ];
  const explicitRequirement = requirementFlags.find(value =>
    value !== undefined && value !== null && String(value).trim() !== ''
  );
  if (explicitRequirement !== undefined) {
    return !['false', '0', 'no', 'n'].includes(String(explicitRequirement).trim().toLowerCase());
  }
  const explicitlyOptional = [
    field && field.optional,
    field && field.allowNull,
    field && field.nullable,
    meta && meta.optional,
    meta && meta.allowNull,
    meta && meta.nullable,
  ].some(value => ['true', '1', 'yes', 'y', 'si', 'sí'].includes(String(value).trim().toLowerCase()));
  if (explicitlyOptional || Number(field && field.minOccurs) === 0 || Number(meta && meta.minOccurs) === 0) {
    return false;
  }
  // Clinical score schemas are safer when an unclassified input fails closed. Eloísa's explicit
  // optional/nullable metadata above still permits legitimately optional observations.
  return true;
};

const normalizeScaleDefinition = (instrument, catalogEntry, rawSchema) => {
  let schema = rawSchema && rawSchema.formJson ? rawSchema.formJson : rawSchema;
  if (typeof schema === 'string') {
    try { schema = JSON.parse(schema); } catch (_error) { return { error: 'El esquema del instrumento no es JSON válido.' }; }
  }
  if (!schema || typeof schema !== 'object') return { error: 'El instrumento no informó su esquema.' };
  const metaFormCode = String(schema.metaFormCode || '').trim();
  const fields = flattenClinicalFormFields(schema.sections).map(field => {
    const meta = field && field.metaField || {};
    const scores = new Map((Array.isArray(field && field.listValueScore) ? field.listValueScore : [])
      .map(item => [String(item && item.listValueId || ''), Number(item && item.score)]));
    return {
      id: String(meta.metaFieldName || field && field.id || '').trim(),
      label: String(meta.label || meta.metaFieldName || '').replace(/\s+/g, ' ').trim(),
      explanation: String(meta.explanation || '').replace(/\s+/g, ' ').trim(),
      type: Number(meta.metaDataType),
      required: resolveClinicalFieldRequired(field, meta),
      options: (Array.isArray(meta.listValues) ? meta.listValues : [])
        .filter(option => option && option.active !== false)
        .map(option => ({
          id: String(option.id),
          description: String(option.description || option.name || option.id).replace(/\s+/g, ' ').trim(),
          score: scores.has(String(option.id)) ? scores.get(String(option.id)) : null,
        })),
    };
  }).filter(field => field.id);
  const scoreField = fields.find(field => /_puntaje$/i.test(field.id));
  const resultField = fields.find(field => /_resultadoscore$/i.test(field.id));
  const results = (Array.isArray(schema.results) ? schema.results : []).map(result => ({
    minScore: Number(result && result.minScore),
    maxScore: Number(result && result.maxScore),
    valueId: String(result && result.listValueResult && result.listValueResult.id || ''),
    valueName: String(
      result && result.listValueResult &&
        (result.listValueResult.description || result.listValueResult.name || result.listValueResult.valueName) || ''
    ).replace(/\s+/g, ' ').trim(),
  })).filter(result => Number.isFinite(result.minScore) && Number.isFinite(result.maxScore) && result.valueId);
  if (!scoreField || !resultField || !results.length) {
    return { error: 'El instrumento no informó campos de puntaje y clasificación verificables.' };
  }
  return {
    instrument,
    formId: String(catalogEntry.id || catalogEntry.formId || ''),
    metaFormId: String(schema.metaFormId || catalogEntry.metaFormId || ''),
    metaFormCode,
    name: String(catalogEntry.name || catalogEntry.formName || instrument).replace(/\s+/g, ' ').trim(),
    fields: fields.filter(field => field.id !== scoreField.id && field.id !== resultField.id),
    scoreFieldId: scoreField.id,
    resultFieldId: resultField.id,
    results,
  };
};

const getScaleDefinition = async (instrument, info) => {
  const pattern = instrument === 'DOWNTON' ? /downton/i : /braden/i;
  const catalog = await fetchClinicalFormsCatalog(info);
  if (catalog.error) return catalog;
  const candidates = catalog.forms.filter(form => pattern.test(String(form && (form.name || form.formName) || '')));
  for (const candidate of candidates) {
    const schemaResult = await fetchClinicalFormSchema(candidate.id || candidate.formId, info);
    if (schemaResult.error) continue;
    const definition = normalizeScaleDefinition(instrument, candidate, schemaResult.schema);
    if (!definition.error) return { definition };
  }
  return { error: 'Eloísa no informó un formulario vigente para ' + instrument + '.' };
};

const handleScoresOptionsRequest = async ({ currentEncId }) => {
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  const identityReady = Boolean(
    info.identityVerified && /^\d+$/.test(String(info.practitionerId || '')) &&
      /^\d+$/.test(String(info.practitionerRoleId || '')) && /enfermer/i.test(String(info.role || ''))
  );
  if (!identityReady) return { error: 'No se pudo verificar una sesión activa de enfermería.' };
  const claimsResult = await fetchFichaClaims(info);
  if (claimsResult.error) return claimsResult;
  if (!hasFichaClaim(claimsResult, 'Ver_Instrumento_Evaluacion')) {
    return { error: 'El perfil no tiene permiso para ver instrumentos de evaluación.' };
  }
  const patientResult = await fetchActiveHospitalizedPatients(info);
  if (patientResult.error) return patientResult;
  const cudyrResult = await fetchCudyrCategories(info);
  const cudyrByEncounter = new Map((cudyrResult.error ? [] : cudyrResult.items)
    .map(item => [String(item.encId), item]));
  const patients = await mapWithConcurrency(patientResult.patients, 3, async patient => {
    const [history, forms, protectionEntries] = await Promise.all([
      fetchScaleHistoryEvents(patient.encounterId, info, 120),
      fetchEvaluationForms(patient.encounterId, info),
      Promise.all(['CUDYR', 'BRADEN', 'DOWNTON'].map(async instrument => [
        instrument,
        await serializeClinicalWriteProtection(
          'score:' + String(patient.encounterId) + ':' + instrument
        ),
      ])),
    ]);
    const bradenHistory = self.HhrPrescriptionPrint.deriveScaleHistory(
      history.error ? [] : history.events,
      forms.error ? [] : forms.forms,
      'BRADEN'
    );
    const downtonHistory = self.HhrPrescriptionPrint.deriveScaleHistory(
      history.error ? [] : history.events,
      forms.error ? [] : forms.forms,
      'DOWNTON'
    );
    const evaluationReadErrors = [history.error, forms.error].filter(Boolean).join(' ');
    return {
      ...patient,
      isCurrent: String(patient.encounterId) === String(currentEncId || ''),
      scores: {
        CUDYR: cudyrByEncounter.get(String(patient.encounterId)) || null,
        BRADEN: evaluationReadErrors ? [] : bradenHistory.slice(0, 8),
        DOWNTON: evaluationReadErrors ? [] : downtonHistory.slice(0, 8),
      },
      scoreUnavailableReasons: {
        CUDYR: cudyrResult.error || '',
        BRADEN: evaluationReadErrors,
        DOWNTON: evaluationReadErrors,
      },
      scoreProtections: Object.fromEntries(protectionEntries),
    };
  });
  const canWriteEvaluation = hasFichaClaim(claimsResult, 'Ingresar_Instrumento_Evaluacion');
  const batchId = crypto.randomUUID();
  await chrome.storage.session.set({
    [`hhr-scores-batch-${batchId}`]: {
      createdAt: Date.now(),
      patients: patients.map(patient => ({
        encounterId: patient.encounterId,
        birthDate: patient.birthDate,
        administrativeSexId: patient.administrativeSexId,
        hospitalDepartmentId: patient.hospitalDepartmentId,
      })),
    },
  });
  return {
    ok: true,
    batchId,
    patients,
    canWrite: canWriteEvaluation,
    canWriteByInstrument: {
      CUDYR: canWriteEvaluation,
      BRADEN: canWriteEvaluation,
      DOWNTON: canWriteEvaluation,
    },
    currentProfessional: info.fullName || '',
    writeBlockedReason: canWriteEvaluation ? '' : 'El perfil no tiene permiso para ingresar instrumentos de evaluación.',
    cudyrHistoryAvailable: false,
    cudyrUnavailableReason: cudyrResult.error || '',
  };
};

const readScoresBatch = async (batchId, encId) => {
  if (!/^[a-f0-9-]{20,}$/i.test(String(batchId || '')) || !/^\d+$/.test(String(encId || ''))) {
    return { error: 'La sesión de Scores no es válida.' };
  }
  const key = `hhr-scores-batch-${batchId}`;
  const stored = await chrome.storage.session.get(key);
  const batch = stored && stored[key];
  if (!batch || Date.now() - Number(batch.createdAt || 0) > 30 * 60 * 1000) {
    return { error: 'La sesión de Scores expiró. Actualiza el módulo.' };
  }
  const patient = (Array.isArray(batch.patients) ? batch.patients : [])
    .find(item => String(item.encounterId) === String(encId));
  return patient
    ? { patient, storageKey: key, batch }
    : { error: 'El paciente no pertenece a esta lista activa.' };
};

const handleScoreFormRequest = async ({ batchId, encId, instrument }) => {
  const normalizedInstrument = ['CUDYR', 'BRADEN', 'DOWNTON'].includes(String(instrument || '').toUpperCase())
    ? String(instrument).toUpperCase()
    : '';
  if (!normalizedInstrument) return { error: 'El instrumento no es válido.' };
  const batch = await readScoresBatch(batchId, encId);
  if (batch.error) return batch;
  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const info = infoResult.info;
  if (!info.identityVerified || !/enfermer/i.test(String(info.role || ''))) {
    return { error: 'No se pudo verificar la sesión de enfermería.' };
  }
  const claimsResult = await fetchFichaClaims(info);
  if (claimsResult.error) return claimsResult;
  if (!hasFichaClaim(claimsResult, 'Ver_Instrumento_Evaluacion')) {
    return { error: 'El perfil no tiene permiso para ver instrumentos de evaluación.' };
  }
  const activeEncounter = await verifyEncounterStillHospitalized(encId, info);
  if (activeEncounter.error) return activeEncounter;
  if (normalizedInstrument === 'CUDYR') {
    const result = await fetchCudyrDefinitions(info);
    if (result.error) return result;
    const departmentId = String(activeEncounter.encounter && activeEncounter.encounter.hospitalDepartmentId || '');
    if (!/^\d+$/.test(departmentId)) {
      return { error: 'Eloísa no informó el servicio clínico; no se puede elegir el formulario CUDYR con seguridad.' };
    }
    batch.patient.hospitalDepartmentId = departmentId;
    await chrome.storage.session.set({ [batch.storageKey]: batch.batch });
    const formId = CUDYR_MENTAL_DEPARTMENT_IDS.has(departmentId) ? '2' : '1';
    const fields = result.rows.filter(row => String(row.formId) === formId).map(row => ({
      id: String(row.id),
      typeId: Number(row.typeId),
      label: String(row.label || '').replace(/\s+/g, ' ').trim(),
      options: (Array.isArray(row.categorizationFormOptionList) ? row.categorizationFormOptionList : [])
        .map(option => ({
          id: String(option.id),
          value: Number(option.value),
          description: String(option.description || '').replace(/\s+/g, ' ').trim(),
        })),
    }));
    if (fields.length !== 14) return { error: 'El formulario CUDYR vigente no contiene sus 14 ítems.' };
    return { ok: true, definition: { instrument: 'CUDYR', formId, name: 'CUDYR', fields } };
  }
  const scale = await getScaleDefinition(normalizedInstrument, info);
  return scale.error ? scale : { ok: true, definition: scale.definition };
};

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
  const formId = CUDYR_MENTAL_DEPARTMENT_IDS.has(departmentId) ? '2' : '1';
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

const hashClinicalWriteRecoveryToken = async token => {
  const bytes = new TextEncoder().encode(String(token || ''));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
};

const createClinicalWriteRecoveryToken = () => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
};

const signClinicalWriteRecoveryReview = async (review, token, generationId) => {
  const encoder = new TextEncoder();
  const signingKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(String(token || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    signingKey,
    encoder.encode(JSON.stringify({ generationId: String(generationId || ''), review }))
  );
  return Array.from(new Uint8Array(signature), value => value.toString(16).padStart(2, '0')).join('');
};

const readClinicalWriteRecoveryReview = async ({ kind, encId, instrument, info }) => {
  if (kind === 'handoff') {
    const refreshed = await fetchShiftChangeEntries(encId, info);
    if (refreshed.error) return refreshed;
    const latest = self.HhrPrescriptionPrint.deriveLatestShiftChange(refreshed.entries);
    return {
      review: {
        kind: 'handoff',
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

const handleClinicalWriteRecoveryRequest = async ({
  key,
  generationId,
  phase,
  recoveryToken,
}) => {
  const normalizedKey = String(key || '');
  const normalizedGenerationId = String(generationId || '');
  const normalizedPhase = String(phase || '');
  const normalizedRecoveryToken = String(recoveryToken || '');
  const match = normalizedKey.match(/^(handoff):(\d+)$/) ||
    normalizedKey.match(/^(score):(\d+):(CUDYR|BRADEN|DOWNTON)$/);
  if (!match || !/^[a-f0-9-]{20,}$/i.test(normalizedGenerationId) ||
      !['preview', 'confirm'].includes(normalizedPhase) ||
      normalizedPhase === 'confirm' && !/^[a-f0-9-]{20,}$/i.test(normalizedRecoveryToken)) {
    return { error: 'La solicitud para liberar la protección clínica no es válida.' };
  }
  if (clinicalWriteLocks.has(normalizedKey) || clinicalWriteAckLocks.has(normalizedKey)) {
    return { error: 'La escritura clínica todavía está procesando otra operación.' };
  }
  clinicalWriteAckLocks.add(normalizedKey);
  try {
    const protection = await readClinicalWriteAmbiguity(normalizedKey);
    const marker = protection.marker || {};
    const markerState = String(marker.state || '');
    const allowedPreviewStates = [
      'in-flight',
      'ambiguous',
      'awaiting-client-ack',
      'awaiting-recovery-confirm',
    ];
    if (!protection.active || marker.generationId !== normalizedGenerationId ||
        normalizedPhase === 'preview' && !allowedPreviewStates.includes(markerState) ||
        normalizedPhase === 'confirm' && markerState !== 'awaiting-recovery-confirm') {
      return { error: 'La protección cambió y no se liberó.' };
    }
    let confirmedTokenHash = '';
    if (normalizedPhase === 'confirm') {
      confirmedTokenHash = await hashClinicalWriteRecoveryToken(normalizedRecoveryToken);
      if (!marker.recoveryTokenHash || !marker.recoveryReviewMac ||
          confirmedTokenHash !== marker.recoveryTokenHash) {
        return { error: 'La lectura revisada ya no coincide con esta protección. Actualiza y revísala nuevamente.' };
      }
      const previewExpiresAt = Number(marker.recoveryPreviewExpiresAt);
      if (!Number.isFinite(previewExpiresAt) || previewExpiresAt <= Date.now()) {
        const reset = await transitionClinicalWriteAmbiguity(normalizedKey, normalizedGenerationId, {
          state: 'ambiguous',
          receiptId: '',
          recoveryTokenHash: '',
          recoveryReviewMac: '',
          recoveryPreviewedAt: 0,
          recoveryPreviewExpiresAt: 0,
        });
        return {
          error: 'La lectura fresca expiró y la protección se mantuvo. Actualiza y revísala nuevamente.' +
            (reset.error ? ' ' + reset.error : ''),
        };
      }
    }
    const markerCreatedAt = Number(marker.createdAt);
    if (!Number.isFinite(markerCreatedAt) || markerCreatedAt <= 0) {
      return {
        error: 'La protección no informó una fecha válida y no se liberó. Recarga la extensión para conservar el bloqueo preventivo.',
      };
    }
    const recoveryAge = Date.now() - markerCreatedAt;
    if (!Number.isFinite(recoveryAge) || recoveryAge < CLINICAL_WRITE_RECOVERY_DELAY_MS) {
      const waitSeconds = Math.max(
        1,
        Math.ceil((CLINICAL_WRITE_RECOVERY_DELAY_MS - Math.max(0, recoveryAge)) / 1000)
      );
      return {
        error: 'Eloísa aún puede estar actualizando el registro. Espera ' + waitSeconds +
          ' s, actualiza la tabla y vuelve a revisar antes de liberar.',
      };
    }
    const infoResult = await getFichaFetchInfo();
    if (infoResult.error) return infoResult;
    const info = infoResult.info;
    if (!info.identityVerified || !/enfermer/i.test(String(info.role || '')) ||
        !/^\d+$/.test(String(info.practitionerRoleId || ''))) {
      return { error: 'No se pudo verificar una sesión activa de enfermería.' };
    }
    const encId = match[2];
    const activeEncounter = await verifyEncounterStillHospitalized(encId, info);
    if (activeEncounter.error) return activeEncounter;
    const claimsResult = await fetchFichaClaims(info);
    if (claimsResult.error) return claimsResult;
    if (match[1] === 'handoff') {
      if (!hasFichaClaim(claimsResult, 'Ver_Cambio_Turno')) {
        return { error: 'El perfil no tiene permiso para verificar entregas de turno.' };
      }
    } else {
      if (!hasFichaClaim(claimsResult, 'Ver_Instrumento_Evaluacion')) {
        return { error: 'El perfil no tiene permiso para verificar instrumentos.' };
      }
    }
    const reviewResult = await readClinicalWriteRecoveryReview({
      kind: match[1],
      encId,
      instrument: match[3] || '',
      info,
    });
    if (reviewResult.error) return reviewResult;
    if (normalizedPhase === 'preview') {
      const previewToken = createClinicalWriteRecoveryToken();
      const [tokenHash, reviewMac] = await Promise.all([
        hashClinicalWriteRecoveryToken(previewToken),
        signClinicalWriteRecoveryReview(reviewResult.review, previewToken, normalizedGenerationId),
      ]);
      const persisted = await transitionClinicalWriteAmbiguity(normalizedKey, normalizedGenerationId, {
        state: 'awaiting-recovery-confirm',
        receiptId: '',
        recoveryTokenHash: tokenHash,
        recoveryReviewMac: reviewMac,
        recoveryPreviewedAt: Date.now(),
        recoveryPreviewExpiresAt: Date.now() + CLINICAL_WRITE_RECOVERY_PREVIEW_TTL_MS,
      });
      if (persisted.error) return persisted;
      return {
        ok: true,
        recoveryPreview: {
          challenge: previewToken,
          review: reviewResult.review,
        },
      };
    }
    const reviewMac = await signClinicalWriteRecoveryReview(
      reviewResult.review,
      normalizedRecoveryToken,
      normalizedGenerationId
    );
    if (reviewMac !== marker.recoveryReviewMac) {
      const reset = await transitionClinicalWriteAmbiguity(normalizedKey, normalizedGenerationId, {
        state: 'ambiguous',
        receiptId: '',
        recoveryTokenHash: '',
        recoveryReviewMac: '',
        recoveryPreviewedAt: 0,
        recoveryPreviewExpiresAt: 0,
      });
      return {
        error: 'El registro cambió después de mostrar la lectura fresca. ' +
          'La protección se mantuvo; actualiza y revisa nuevamente.' +
          (reset.error ? ' ' + reset.error : ''),
      };
    }
    const cleared = await clearClinicalWriteAmbiguity(normalizedKey, {
      state: 'awaiting-recovery-confirm',
      generationId: normalizedGenerationId,
      recoveryTokenHash: confirmedTokenHash,
      recoveryReviewMac: reviewMac,
    });
    return cleared.error ? cleared : { ok: true };
  } catch (error) {
    return {
      error: 'No se pudo verificar y liberar la protección: ' +
        String((error && error.message) || error),
    };
  } finally {
    clinicalWriteAckLocks.delete(normalizedKey);
  }
};

const handleHospitalizedPrescriptionOptionsRequest = async ({ currentEncId }) => {
  const infoResult = await getFichaFetchInfo();
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
  const batchId = crypto.randomUUID();
  await chrome.storage.session.set({
    [`hhr-prescription-batch-${batchId}`]: {
      allowedEncounterIds: printableIds,
      createdAt: Date.now(),
    },
  });
  return {
    ok: true,
    batchId,
    patients: summaries,
    unavailableCount: summaries.filter(patient => patient.unavailableReason).length,
  };
};

const handleHospitalizedPrescriptionPrintRequest = async ({ batchId, encIds, printFormat }) => {
  self.HhrExtensionRuntime.ensurePdf();
  if (!/^[a-f0-9-]{20,}$/i.test(String(batchId || ''))) {
    return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
  }
  const storageKey = `hhr-prescription-batch-${batchId}`;
  const stored = await chrome.storage.session.get(storageKey);
  const batch = stored && stored[storageKey];
  if (!batch || Date.now() - Number(batch.createdAt || 0) > 30 * 60 * 1000) {
    return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
  }
  const allowed = new Set(Array.isArray(batch.allowedEncounterIds) ? batch.allowedEncounterIds : []);
  const selected = Array.from(new Set(Array.isArray(encIds) ? encIds.map(String) : []))
    .filter(encId => /^\d+$/.test(encId) && allowed.has(encId));
  if (selected.length === 0) return { error: 'Selecciona al menos un paciente con receta disponible.' };
  if (selected.length > 120) return { error: 'La selección supera el máximo seguro de 120 pacientes.' };

  const infoResult = await getFichaFetchInfo();
  if (infoResult.error) return infoResult;
  const activeSelection = await verifySelectedEncountersStillHospitalized(selected, infoResult.info);
  if (activeSelection.error) return activeSelection;
  const format = printFormat === 'compact' ? 'compact' : 'standard';
  const generated = await mapWithConcurrency(selected, 2, async encId => {
    const result = await createCompletePrescriptionPdf({ encId, printFormat: format, info: infoResult.info });
    return result.error ? { encId, error: result.error } : { encId, buffer: result.buffer };
  });
  const completed = generated.filter(item => item.buffer);
  const skipped = generated.filter(item => item.error).map(item => ({ encId: item.encId, error: item.error }));
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
  await chrome.storage.session.remove(storageKey);
  return { ...opened, count: completed.length, skipped };
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

// Fetch the CUDYR (CRD) composite result of every patient from Ficha Médico's nurse worklists
// (con novedad + sin novedad + egresados). Rayen only exposes the aggregate `crdValue` (e.g. "D3")
// + `crdDateTime` per encounter, not the 14 variables — so that composite is all HHR can sync.
const handleCudyrCategoriesRequest = async () => {
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
  const facId = String(info.facId || '').trim();
  if (!/^\d+$/.test(facId)) {
    return { error: 'No se pudo verificar el establecimiento activo de Ficha Médico.' };
  }
  const byEnc = new Map();
  try {
    for (const list of NURSING_WORKLISTS) {
      const url = `${info.apiOrigin}/api/encounter/${list}/${encodeURIComponent(facId)}`;
      const res = await fetchWithTimeout(url, {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
      });
      if (!res.ok) continue;
      const rows = await res.json();
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row && row.id != null) {
          byEnc.set(String(row.id), {
            encId: String(row.id),
            crdValue: row.crdValue || '',
            crdDateTime: row.crdDateTime || '',
          });
        }
      }
    }
    return { ok: true, items: [...byEnc.values()] };
  } catch (error) {
    return { error: 'Falló la lectura de CUDYR: ' + String((error && error.message) || error) };
  }
};

const respondAsync = (promise, sendResponse, fallbackMessage) => {
  Promise.resolve(promise)
    .then(response => sendResponse(response || { error: fallbackMessage }))
    .catch(error => {
      console.error('[HHR] Falló una operación asíncrona de la extensión:', error);
      sendResponse({
        error: fallbackMessage + ' ' + String((error && error.message) || error || '').trim(),
      });
    });
  return true;
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const respond = (promise, fallbackMessage = 'La operación de la extensión no pudo completarse.') =>
    respondAsync(promise, sendResponse, fallbackMessage);
  if (msg && msg.type === 'RAYEN_EXTENSION_HEALTH_REQUEST') {
    return respond(handleExtensionHealth(), 'No se pudo verificar el estado de la extensión.');
  }
  if (msg && msg.type === 'RAYEN_SNAPSHOT_REQUEST') {
    return respond(handleSnapshotRequest(), 'No se pudo leer el censo de Ficha Médico.');
  }
  if (msg && msg.type === 'RAYEN_OPEN_ENCOUNTER_REQUEST') {
    return respond(handleOpenEncounter(msg.encId), 'No se pudo abrir el episodio clínico.');
  }
  if (msg && msg.type === 'RAYEN_EGRESO_LOOKUP_REQUEST') {
    return respond(handleEgresoLookup(Array.isArray(msg.runs) ? msg.runs : []), 'No se pudo consultar el egreso.');
  }
  if (msg && msg.type === 'RAYEN_EGRESO_REPORT_REQUEST') {
    return respond(handleReportRequest({ dateStart: msg.dateStart, dateEnd: msg.dateEnd }), 'No se pudo leer el reporte de egresos.');
  }
  if (msg && msg.type === 'RAYEN_EGRESO_REPORT_SAVE') {
    return respond(handleReportSave({ dateStart: msg.dateStart, dateEnd: msg.dateEnd }), 'No se pudo guardar el reporte de egresos.');
  }
  if (msg && msg.type === 'RAYEN_DEVICE_REPORT_REQUEST') {
    return respond(handleDeviceReportRequest({ encId: msg.encId, fecha: msg.fecha }), 'No se pudo leer el reporte de dispositivos.');
  }
  if (msg && msg.type === 'RAYEN_DEVICE_REPORT_SAVE') {
    return respond(handleDeviceReportSave({ encId: msg.encId, fecha: msg.fecha }), 'No se pudo guardar el reporte de dispositivos.');
  }
  if (msg && msg.type === 'RAYEN_SCALES_REPORT_REQUEST') {
    return respond(handleScalesReportRequest({ encId: msg.encId }), 'No se pudo leer el reporte de escalas.');
  }
  if (msg && msg.type === 'RAYEN_HISTORY_SCALES_REQUEST') {
    return respond(handleHistoryScalesRequest({ encId: msg.encId }), 'No se pudo leer el historial de escalas.');
  }
  if (msg && msg.type === 'RAYEN_CLINICAL_PANEL_REQUEST') {
    return respond(handleClinicalPanelRequest({ encId: msg.encId }), 'No se pudo cargar el panel clínico.');
  }
  if (msg && msg.type === 'RAYEN_PRESCRIPTION_OPTIONS_REQUEST') {
    return respondAsync(
      handlePrescriptionOptionsRequest({ encId: msg.encId }),
      sendResponse,
      'No se pudieron preparar las opciones de receta.'
    );
  }
  if (msg && msg.type === 'RAYEN_PRESCRIPTION_PRINT_REQUEST') {
    return respondAsync(
      handlePrescriptionPrintRequest({
        encId: msg.encId,
        selectionKey: msg.selectionKey,
        printFormat: msg.printFormat,
      }),
      sendResponse,
      'No se pudo generar la receta.'
    );
  }
  if (msg && msg.type === 'RAYEN_HOSPITALIZED_PRESCRIPTION_OPTIONS_REQUEST') {
    return respondAsync(
      handleHospitalizedPrescriptionOptionsRequest({ currentEncId: msg.currentEncId }),
      sendResponse,
      'No se pudieron revisar las recetas de pacientes hospitalizados.'
    );
  }
  if (msg && msg.type === 'RAYEN_HOSPITALIZED_PRESCRIPTION_PRINT_REQUEST') {
    return respondAsync(
      handleHospitalizedPrescriptionPrintRequest({
        batchId: msg.batchId,
        encIds: msg.encIds,
        printFormat: msg.printFormat,
      }),
      sendResponse,
      'No se pudo generar la impresión de pacientes hospitalizados.'
    );
  }
  if (msg && msg.type === 'RAYEN_INDICATIONS_PRINT_REQUEST') {
    return respond(handleIndicationsPrintRequest({ encId: msg.encId }), 'No se pudieron preparar las indicaciones.');
  }
  if (msg && msg.type === 'RAYEN_HOSPITALIZED_INDICATIONS_OPTIONS_REQUEST') {
    return respond(
      handleHospitalizedIndicationsOptionsRequest({ currentEncId: msg.currentEncId }),
      'No se pudieron revisar las indicaciones de pacientes hospitalizados.'
    );
  }
  if (msg && msg.type === 'RAYEN_HOSPITALIZED_INDICATIONS_PRINT_REQUEST') {
    return respond(
      handleHospitalizedIndicationsPrintRequest({ batchId: msg.batchId, encIds: msg.encIds }),
      'No se pudo generar la impresión de indicaciones.'
    );
  }
  if (msg && msg.type === 'RAYEN_HOSPITALIZED_REGIMEN_OPTIONS_REQUEST') {
    return respond(
      handleHospitalizedRegimenOptionsRequest({ currentEncId: msg.currentEncId }),
      'No se pudieron revisar los regímenes hospitalizados.'
    );
  }
  if (msg && msg.type === 'RAYEN_HOSPITALIZED_REGIMEN_PRINT_REQUEST') {
    return respond(handleHospitalizedRegimenPrintRequest(), 'No se pudo generar el reporte de regímenes.');
  }
  if (msg && msg.type === 'RAYEN_HANDOFF_OPTIONS_REQUEST') {
    return respond(handleHandoffOptionsRequest({ currentEncId: msg.currentEncId }), 'No se pudo cargar la entrega de turno.');
  }
  if (msg && msg.type === 'RAYEN_HANDOFF_SAVE_REQUEST') {
    return respond(
      handleHandoffSaveRequest({ batchId: msg.batchId, encId: msg.encId, observation: msg.observation }),
      'No se pudo completar el guardado de la entrega de turno.'
    );
  }
  if (msg && msg.type === 'RAYEN_HANDOFF_REPORT_REQUEST') {
    return respond(handleHandoffReportRequest({ nurseStationId: msg.nurseStationId }), 'No se pudo preparar el reporte de turno.');
  }
  if (msg && msg.type === 'RAYEN_SCORES_OPTIONS_REQUEST') {
    return respond(handleScoresOptionsRequest({ currentEncId: msg.currentEncId }), 'No se pudieron cargar los instrumentos clínicos.');
  }
  if (msg && msg.type === 'RAYEN_SCORE_FORM_REQUEST') {
    return respond(
      handleScoreFormRequest({ batchId: msg.batchId, encId: msg.encId, instrument: msg.instrument }),
      'No se pudo cargar el formulario clínico.'
    );
  }
  if (msg && msg.type === 'RAYEN_SCORE_SAVE_REQUEST') {
    return respond(
      handleScoreSaveRequest({
        batchId: msg.batchId,
        encId: msg.encId,
        instrument: msg.instrument,
        answers: msg.answers,
      }),
      'No se pudo completar el guardado del instrumento.'
    );
  }
  if (msg && msg.type === 'RAYEN_CLINICAL_WRITE_ACK') {
    return respond(
      acknowledgeClinicalWrite({ key: msg.key, generationId: msg.generationId, receiptId: msg.receiptId }),
      'No se pudo confirmar localmente el guardado clínico.'
    );
  }
  if (msg && msg.type === 'RAYEN_CLINICAL_WRITE_RECOVERY_REQUEST') {
    return respond(
      handleClinicalWriteRecoveryRequest({
        key: msg.key,
        generationId: msg.generationId,
        phase: msg.phase,
        recoveryToken: msg.recoveryToken,
      }),
      'No se pudo revisar el estado del guardado clínico.'
    );
  }
  if (msg && msg.type === 'RAYEN_CUDYR_CATEGORIES_REQUEST') {
    return respond(handleCudyrCategoriesRequest(), 'No se pudo consultar CUDYR.');
  }
  return undefined;
});

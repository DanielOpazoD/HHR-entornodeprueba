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

// SheetJS + the Jasper .xls row parser, loaded once into the service worker. importScripts must
// run at top level (MV3 classic SW); parsing itself only happens for report requests.
importScripts('encounter-navigation.js', 'xlsx.full.min.js', 'report-parser.js');

const FICHAMEDICO_MATCH = 'https://fichamedico.rayensalud.cl/*';
const GESTIONCAMAS_MATCH = 'https://hospitalizado.rayensalud.cl/*';

const REPORT_FILE = 'Lista_Pacientes_Alta_Administrativa_Rango_Fecha.xls';

// Try every matching tab (active/most-recent first): some may be stale tabs whose content
// script isn't injected. The first one that answers wins.
const sendToMatchingTab = async (urlMatch, message, noTabError, noAnswerError) => {
  const tabs = await chrome.tabs.query({ url: urlMatch });
  if (!tabs.length) return { error: noTabError };
  const ordered = tabs.slice().sort((a, b) => Number(b.active) - Number(a.active));
  let lastError = 'Sin respuesta de la pestaña.';
  for (const tab of ordered) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message);
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
    const res = await fetch(url, { headers: { Authorization: info.token } });
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
    const res = await fetch(url, { headers: { Authorization: info.token }, credentials: 'omit' });
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
    const res = await fetch(url, {
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
    const res = await fetch(url, {
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
  ],
  patientFreeIndicationResume: [
    'INDICATION', 'HCP_NAME', 'HCP_ROLE', 'PUBLISH_DATETIME',
    'SUSPENDED', 'IS_NEW', 'IS_DISCHARGE', 'AMRE_ID', 'ARCHIVED',
  ],
  nutritionOrderResume: ['DIET_type', 'OBSERVATION', 'HCPR_NAME', 'HCP_LEGAL', 'PUBLISH_DATETIME', 'ARCHIVED'],
  restResume: ['rest_type', 'OBSERVATION', 'HCPR_NAME', 'HCP_LEGAL', 'PUBLISH_DATETIME', 'ARCHIVED'],
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
  const url =
    `${info.apiOrigin}/api/encounter/${encodeURIComponent(encId)}/` +
    `getPatientEncounterHistoryReportServer/false/0/0/-14`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: info.token, Accept: 'application/json' },
      credentials: 'omit',
    });
    if (res.status === 204) return { ok: true, events: [] };
    if (!res.ok) return { error: 'El servidor de Ficha Médico respondió HTTP ' + res.status + '.' };
    const raw = await res.json();
    const events = [];
    for (const ev of Array.isArray(raw) ? raw : []) {
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
    return { ok: true, events };
  } catch (error) {
    return { error: 'Falló la descarga del panel clínico: ' + String((error && error.message) || error) };
  }
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
  const facId = info.facId || '1342';
  const lists = ['noveltyNurseList', 'uneventfulNurseList', 'incomeNurseList'];
  const byEnc = new Map();
  try {
    for (const list of lists) {
      const url = `${info.apiOrigin}/api/encounter/${list}/${encodeURIComponent(facId)}`;
      const res = await fetch(url, {
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'RAYEN_SNAPSHOT_REQUEST') {
    handleSnapshotRequest().then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_OPEN_ENCOUNTER_REQUEST') {
    handleOpenEncounter(msg.encId).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_EGRESO_LOOKUP_REQUEST') {
    handleEgresoLookup(Array.isArray(msg.runs) ? msg.runs : []).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_EGRESO_REPORT_REQUEST') {
    handleReportRequest({ dateStart: msg.dateStart, dateEnd: msg.dateEnd }).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_EGRESO_REPORT_SAVE') {
    handleReportSave({ dateStart: msg.dateStart, dateEnd: msg.dateEnd }).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_DEVICE_REPORT_REQUEST') {
    handleDeviceReportRequest({ encId: msg.encId, fecha: msg.fecha }).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_DEVICE_REPORT_SAVE') {
    handleDeviceReportSave({ encId: msg.encId, fecha: msg.fecha }).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_SCALES_REPORT_REQUEST') {
    handleScalesReportRequest({ encId: msg.encId }).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_HISTORY_SCALES_REQUEST') {
    handleHistoryScalesRequest({ encId: msg.encId }).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_CLINICAL_PANEL_REQUEST') {
    handleClinicalPanelRequest({ encId: msg.encId }).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'RAYEN_CUDYR_CATEGORIES_REQUEST') {
    handleCudyrCategoriesRequest().then(sendResponse);
    return true; // async response
  }
  return undefined;
});

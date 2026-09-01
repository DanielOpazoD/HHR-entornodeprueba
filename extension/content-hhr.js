/**
 * content-hhr.js  (ISOLATED world)
 *
 * Runs on the HHR app (localhost + testinghhr.netlify.app). Bridges the page's
 * postMessage protocol (the `rayen-import` bridge inside the app) and the background.
 *
 * Snapshot (Ficha Médico census):
 *   Page → us:  { type: 'HHR_RAYEN_REQUEST_SNAPSHOT' }
 *   us  → page: { type: 'HHR_RAYEN_CENSUS_SNAPSHOT', snapshot } | { type: 'HHR_RAYEN_IMPORT_ERROR', error }
 * Guarded sync bundle (Ficha Médico + Gestión de Camas):
 *   Page → us:  { type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE', dateStart, dateEnd }
 *   us  → page: { type: 'HHR_RAYEN_CENSUS_SNAPSHOT', snapshot, bundle } | import error
 * Egreso lookup (Gestión de Camas, for late-sync patients absent from Ficha Médico):
 *   Page → us:  { type: 'HHR_RAYEN_EGRESO_LOOKUP_REQUEST', reqId, runs }
 *   us  → page: { type: 'HHR_RAYEN_EGRESO_LOOKUP_RESULT', reqId, results }
 * Egreso report (bulk "Alta Administrativa" list by date — enumerates the day's egresos,
 * including patients HHR never synced; parsed to rows in the background):
 *   Page → us:  { type: 'HHR_RAYEN_EGRESO_REPORT_REQUEST', reqId, dateStart, dateEnd }
 *   us  → page: { type: 'HHR_RAYEN_EGRESO_REPORT_RESULT', reqId, ok, rows }
 *
 * Patient navigation (read-only handoff to the exact Ficha Médico encounter):
 *   Page → us:  { type: 'HHR_RAYEN_OPEN_ENCOUNTER_REQUEST', reqId, encId }
 *   us  → page: { type: 'HHR_RAYEN_OPEN_ENCOUNTER_RESULT', reqId, ok, reused, error? }
 *
 * Capability health (no clinical data or token access):
 *   Page → us:  { type: 'HHR_RAYEN_EXTENSION_HEALTH_REQUEST', reqId }
 *   us  → page: { type: 'HHR_RAYEN_EXTENSION_HEALTH_RESULT', reqId, report, error? }
 * Health heartbeat (background-initiated; same report, no request needed):
 *   bg → us   : { type: 'RAYEN_EXTENSION_HEALTH_PUSH', report, reason }
 *   us → page : { type: 'HHR_RAYEN_EXTENSION_HEALTH_PUSH', report, reason }
 * Gestión de Camas connect (opens the official login window from HHR):
 *   Page → us:  { type: 'HHR_RAYEN_GC_CONNECT_REQUEST', reqId, renew? }
 *   us  → page: { type: 'HHR_RAYEN_GC_CONNECT_RESULT', reqId, ok, error? }
 */
(() => {
  'use strict';
  const runtimeMessages = globalThis.HhrRayenMessageContract &&
    globalThis.HhrRayenMessageContract.types;
  if (!runtimeMessages) return;
  const post = message => window.postMessage(message, window.location.origin);
  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === 'RAYEN_EXTENSION_HEALTH_PUSH' && message.report) {
      post({
        type: 'HHR_RAYEN_EXTENSION_HEALTH_PUSH',
        report: message.report,
        reason: message.reason,
      });
    }
  });
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;
    if (data.type === 'HHR_RAYEN_EXTENSION_HEALTH_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({ type: runtimeMessages.EXTENSION_HEALTH_REQUEST })
        .then(report => {
          post({ type: 'HHR_RAYEN_EXTENSION_HEALTH_RESULT', reqId, report });
        })
        .catch(error => {
          post({
            type: 'HHR_RAYEN_EXTENSION_HEALTH_RESULT',
            reqId,
            error: String(error),
          });
        });
      return;
    }
    if (data.type === 'HHR_RAYEN_GC_CONNECT_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({ type: runtimeMessages.GC_CONNECT_REQUEST, renew: data.renew === true })
        .then(response => {
          post({
            type: 'HHR_RAYEN_GC_CONNECT_RESULT',
            reqId,
            ok: Boolean(response && response.ok),
            error: response && response.error,
          });
        })
        .catch(error => {
          console.warn('[Rayen→HHR] GC connect error:', error);
          post({ type: 'HHR_RAYEN_GC_CONNECT_RESULT', reqId, ok: false, error: String(error) });
        });
      return;
    }
    if (data.type === 'HHR_RAYEN_REQUEST_SNAPSHOT') {
      chrome.runtime
        .sendMessage({ type: runtimeMessages.SNAPSHOT_REQUEST })
        .then(response => {
          if (response && response.snapshot) {
            post({ type: 'HHR_RAYEN_CENSUS_SNAPSHOT', snapshot: response.snapshot });
          } else {
            const error = (response && response.error) || 'Error desconocido leyendo Rayen.';
            console.warn('[Rayen→HHR] Import error:', error);
            post({ type: 'HHR_RAYEN_IMPORT_ERROR', error });
          }
        })
        .catch(error => {
          console.warn('[Rayen→HHR] Bridge error:', error);
          post({ type: 'HHR_RAYEN_IMPORT_ERROR', error: String(error) });
        });
      return;
    }

    if (data.type === 'HHR_RAYEN_OPEN_ENCOUNTER_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({ type: runtimeMessages.OPEN_ENCOUNTER_REQUEST, encId: data.encId, routeHint: data.routeHint })
        .then(response => {
          post({
            type: 'HHR_RAYEN_OPEN_ENCOUNTER_RESULT',
            reqId,
            ok: response && response.ok === true,
            reused: response && response.reused === true,
            error: response && response.error,
          });
        })
        .catch(error => {
          console.warn('[Rayen→HHR] Encounter navigation error:', error);
          post({
            type: 'HHR_RAYEN_OPEN_ENCOUNTER_RESULT',
            reqId,
            ok: false,
            reused: false,
            error: String(error),
          });
        });
      return;
    }
    if (data.type === 'HHR_RAYEN_EGRESO_LOOKUP_REQUEST') {
      const reqId = data.reqId;
      const runs = Array.isArray(data.runs) ? data.runs : [];
      const targets = Array.isArray(data.targets) ? data.targets : [];
      chrome.runtime
        .sendMessage({ type: runtimeMessages.EGRESO_LOOKUP_REQUEST, runs, targets })
        .then(response => {
          const results = (response && Array.isArray(response.results) && response.results) || [];
          post({ type: 'HHR_RAYEN_EGRESO_LOOKUP_RESULT', reqId, results });
        })
        .catch(error => {
          // Degrade gracefully: no egresos recovered → the sync keeps the inferred discharges.
          console.warn('[Rayen→HHR] Egreso lookup error:', error);
          post({ type: 'HHR_RAYEN_EGRESO_LOOKUP_RESULT', reqId, results: [] });
        });
      return;
    }

    if (data.type === 'HHR_RAYEN_EGRESO_REPORT_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({
          type: runtimeMessages.EGRESO_REPORT_REQUEST,
          dateStart: data.dateStart,
          dateEnd: data.dateEnd,
        })
        .then(response => {
          const ok = Boolean(response && response.ok === true && Array.isArray(response.rows));
          const rows = ok ? response.rows : [];
          post({ type: 'HHR_RAYEN_EGRESO_REPORT_RESULT', reqId, ok, rows });
        })
        .catch(error => {
          console.warn('[Rayen→HHR] Egreso report error:', error);
          post({ type: 'HHR_RAYEN_EGRESO_REPORT_RESULT', reqId, ok: false, rows: [] });
        });
      return;
    }

    if (data.type === 'HHR_RAYEN_DEVICE_REPORT_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({ type: runtimeMessages.DEVICE_REPORT_REQUEST, encId: data.encId, fecha: data.fecha, acceptEntries: data.acceptEntries === true })
        .then(response => {
          post({
            type: 'HHR_RAYEN_DEVICE_REPORT_RESULT',
            reqId,
            entries: response && Array.isArray(response.entries) ? response.entries : undefined,
            base64: (response && response.base64) || '',
            source: response && response.source,
            error: response && response.error,
          });
        })
        .catch(error => {
          console.warn('[Rayen→HHR] Device report error:', error); post({ type: 'HHR_RAYEN_DEVICE_REPORT_RESULT', reqId, base64: '', error: String(error) });
        });
      return;
    }

    if (data.type === 'HHR_RAYEN_SCALES_REPORT_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({ type: runtimeMessages.SCALES_REPORT_REQUEST, encId: data.encId })
        .then(response => {
          post({
            type: 'HHR_RAYEN_SCALES_REPORT_RESULT',
            reqId,
            forms: (response && Array.isArray(response.forms) && response.forms) || [],
            error: response && response.error,
          });
        })
        .catch(error => {
          // Degrade gracefully: no forms → no scales synced for this patient.
          console.warn('[Rayen→HHR] Scales report error:', error);
          post({ type: 'HHR_RAYEN_SCALES_REPORT_RESULT', reqId, forms: [], error: String(error) });
        });
      return;
    }
    if (data.type === 'HHR_RAYEN_HISTORY_SCALES_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({ type: runtimeMessages.HISTORY_SCALES_REQUEST, encId: data.encId, censusDate: data.censusDate, lookbackDays: data.lookbackDays })
        .then(response => {
          post({
            type: 'HHR_RAYEN_HISTORY_SCALES_RESULT',
            reqId,
            events: (response && Array.isArray(response.events) && response.events) || [],
            nursingActivity: (response && Array.isArray(response.nursingActivity) && response.nursingActivity) || [],
            effectiveLookbackDays: response && response.effectiveLookbackDays,
            coverageWindowStartIsoDay: response && response.coverageWindowStartIsoDay,
            coverageWindowEndIsoDay: response && response.coverageWindowEndIsoDay,
            error: response && response.error,
          });
        })
        .catch(error => {
          // Degrade gracefully: no events → no scales synced for this patient.
          console.warn('[Rayen→HHR] History scales error:', error);
          post({ type: 'HHR_RAYEN_HISTORY_SCALES_RESULT', reqId, events: [], nursingActivity: [], error: String(error) });
        });
      return;
    }
    if (data.type === 'HHR_RAYEN_PATIENT_CLINICAL_BUNDLE_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({
          type: runtimeMessages.PATIENT_CLINICAL_BUNDLE_REQUEST,
          encId: data.encId,
          fecha: data.fecha,
          censusDate: data.censusDate,
          lookbackDays: data.lookbackDays,
        })
        .then(response => {
          post({
            type: 'HHR_RAYEN_PATIENT_CLINICAL_BUNDLE_RESULT',
            reqId,
            devices: response && response.devices,
            history: response && response.history,
            forms: response && response.forms,
            error: response && response.error,
          });
        })
        .catch(error => {
          // Degrade gracefully: HHR falls back to the three individual channels.
          console.warn('[Rayen→HHR] Patient clinical bundle error:', error);
          post({ type: 'HHR_RAYEN_PATIENT_CLINICAL_BUNDLE_RESULT', reqId, error: String(error) });
        });
      return;
    }
    if (data.type === 'HHR_RAYEN_CLINICAL_PANEL_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({ type: runtimeMessages.CLINICAL_PANEL_REQUEST, encId: data.encId })
        .then(response => {
          post({
            type: 'HHR_RAYEN_CLINICAL_PANEL_RESULT',
            reqId,
            events: (response && Array.isArray(response.events) && response.events) || [],
            carePlan: (response && response.carePlan) || {
              carePlanHeaders: [],
              medicationStates: [],
            },
            error: response && response.error,
          });
        })
        .catch(error => {
          // Degrade gracefully: no events → the panel shows its empty/error state.
          console.warn('[Rayen→HHR] Clinical panel error:', error);
          post({
            type: 'HHR_RAYEN_CLINICAL_PANEL_RESULT',
            reqId,
            events: [],
            carePlan: { carePlanHeaders: [], medicationStates: [] },
            error: String(error),
          });
        });
      return;
    }
    if (data.type === 'HHR_RAYEN_CUDYR_CATEGORIES_REQUEST') {
      const reqId = data.reqId;
      chrome.runtime
        .sendMessage({ type: runtimeMessages.CUDYR_CATEGORIES_REQUEST })
        .then(response => {
          post({
            type: 'HHR_RAYEN_CUDYR_CATEGORIES_RESULT',
            reqId,
            items: (response && Array.isArray(response.items) && response.items) || [],
            source: response && response.source,
            historyAvailable: response && response.historyAvailable,
            warning: response && response.warning,
            error: response && response.error,
          });
        })
        .catch(error => {
          // Degrade gracefully: no categories → no CUDYR synced.
          console.warn('[Rayen→HHR] CUDYR categories error:', error);
          post({ type: 'HHR_RAYEN_CUDYR_CATEGORIES_RESULT', reqId, items: [], error: String(error) });
        });
      return;
    }
  });
})();

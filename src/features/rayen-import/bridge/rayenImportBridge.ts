/**
 * Bridge between the browser extension (which reads Rayen) and the HHR app.
 *
 * The extension's content script posts a `window.postMessage` with the snapshot;
 * this module validates the shape and forwards it to subscribers. `pushRayenSnapshot`
 * lets dev/test code inject a snapshot through the same path.
 *
 * Only the message SHAPE is trusted here; the app still previews/confirms before writing.
 */

import { requestViaBridgeChannel } from './bridgeRequestChannel';
import {
  mapDeviceReportPayload,
  mapHistoryScalesPayload,
  mapScalesFormsPayload,
} from './patientClinicalBundleChannel';
import type { RayenHistoryScaleEvent as HistoryScaleEvent } from '../contracts/patientClinicalBundle';
import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { RayenNursingActivity } from '../contracts/nursingShiftInference';
import type { RayenCudyrCategoriesResponse, RayenCudyrCategory } from '../contracts/rayenCudyr';
import type { RayenInvasiveDeviceEntry } from '../mapping/mapDeviceToInstance';

export type {
  RayenCudyrCategoriesResponse,
  RayenCudyrCategory,
  RayenCudyrHistoryEntry,
  RayenCudyrSource,
} from '../contracts/rayenCudyr';

export {
  RAYEN_IMPORT_MESSAGE_TYPE,
  RAYEN_IMPORT_ERROR_MESSAGE_TYPE,
  RAYEN_SYNC_BUNDLE_REQUEST_MESSAGE_TYPE,
  isRayenCensusSnapshot,
  isRayenSyncBundle,
  subscribeToRayenSnapshots,
  subscribeToRayenImportErrors,
  requestRayenSyncBundle,
  cancelRayenSyncBundleRequest,
} from './rayenSnapshotBridge';
export const RAYEN_EGRESO_LOOKUP_REQUEST_TYPE = 'HHR_RAYEN_EGRESO_LOOKUP_REQUEST';
export const RAYEN_EGRESO_LOOKUP_RESULT_TYPE = 'HHR_RAYEN_EGRESO_LOOKUP_RESULT';
export const RAYEN_EGRESO_REPORT_REQUEST_TYPE = 'HHR_RAYEN_EGRESO_REPORT_REQUEST';
export const RAYEN_EGRESO_REPORT_RESULT_TYPE = 'HHR_RAYEN_EGRESO_REPORT_RESULT';
export const RAYEN_DEVICE_REPORT_REQUEST_TYPE = 'HHR_RAYEN_DEVICE_REPORT_REQUEST';
export const RAYEN_DEVICE_REPORT_RESULT_TYPE = 'HHR_RAYEN_DEVICE_REPORT_RESULT';
export const RAYEN_SCALES_REPORT_REQUEST_TYPE = 'HHR_RAYEN_SCALES_REPORT_REQUEST';
export const RAYEN_SCALES_REPORT_RESULT_TYPE = 'HHR_RAYEN_SCALES_REPORT_RESULT';
export const RAYEN_HISTORY_SCALES_REQUEST_TYPE = 'HHR_RAYEN_HISTORY_SCALES_REQUEST';
export const RAYEN_HISTORY_SCALES_RESULT_TYPE = 'HHR_RAYEN_HISTORY_SCALES_RESULT';
export const RAYEN_CUDYR_CATEGORIES_REQUEST_TYPE = 'HHR_RAYEN_CUDYR_CATEGORIES_REQUEST';
export const RAYEN_CUDYR_CATEGORIES_RESULT_TYPE = 'HHR_RAYEN_CUDYR_CATEGORIES_RESULT';

export type { RayenHistoryScaleEvent } from '../contracts/patientClinicalBundle';
export {
  requestPatientClinicalBundle,
  RAYEN_PATIENT_CLINICAL_BUNDLE_REQUEST_TYPE,
  RAYEN_PATIENT_CLINICAL_BUNDLE_RESULT_TYPE,
} from './patientClinicalBundleChannel';

/**
 * Ask the extension to look up the egresos of the given RUNs in gestión de camas — used to
 * recover definitive discharges for patients absent from Ficha Médico (late sync). Resolves
 * to `[]` if the extension / gestión de camas tab is unavailable or times out, so the caller
 * degrades gracefully (keeps the inferred discharges).
 */
export const requestEgresoLookup = (
  requested: Array<string | EgresoLookupTarget>,
  timeoutMs = 30000
): Promise<EgresoLookupResult[]> => {
  if (typeof window === 'undefined' || !Array.isArray(requested) || requested.length === 0) {
    return Promise.resolve([]);
  }
  const targets = requested
    .map(value => (typeof value === 'string' ? { run: value, encounterId: '' } : value))
    .filter(value => value && typeof value.run === 'string');
  return requestViaBridgeChannel({
    prefix: 'egreso',
    requestType: RAYEN_EGRESO_LOOKUP_REQUEST_TYPE,
    resultType: RAYEN_EGRESO_LOOKUP_RESULT_TYPE,
    payload: { runs: targets.map(target => target.run), targets },
    timeoutMs,
    onTimeout: () => [],
    mapResult: data => (Array.isArray(data.results) ? (data.results as EgresoLookupResult[]) : []),
  });
};

/**
 * Ask the extension to download + parse the bulk "Alta Administrativa" egreso report for a date
 * range (ISO YYYY-MM-DD) in gestión de camas. A successful empty report is deliberately distinct
 * from an unavailable/timed-out report: callers must not treat failed authority lookup as proof
 * that there were no administrative discharges.
 */
export type EgresoReportRequestResult =
  | { ok: true; rows: EgresoReportRow[] }
  | { ok: false; reason: 'invalid-request' | 'unavailable' | 'timeout' };

export const requestEgresoReport = (
  dateStart: string,
  dateEnd: string,
  timeoutMs = 40000
): Promise<EgresoReportRequestResult> => {
  if (typeof window === 'undefined' || !dateStart || !dateEnd) {
    return Promise.resolve({ ok: false, reason: 'invalid-request' });
  }
  return requestViaBridgeChannel<EgresoReportRequestResult>({
    prefix: 'egreso-report',
    requestType: RAYEN_EGRESO_REPORT_REQUEST_TYPE,
    resultType: RAYEN_EGRESO_REPORT_RESULT_TYPE,
    payload: { dateStart, dateEnd },
    timeoutMs,
    onTimeout: () => ({ ok: false, reason: 'timeout' }),
    mapResult: data =>
      data.ok === true && Array.isArray(data.rows)
        ? { ok: true, rows: data.rows as EgresoReportRow[] }
        : { ok: false, reason: 'unavailable' },
  });
};

/**
 * Ask the extension to download one patient's "Resumen diario paciente" PDF (which carries the
 * invasive-devices table) for a date (ISO), returning it base64-encoded for HHR to parse with
 * pdfjs. Resolves to `{ base64: '' }` if the extension / Ficha Médico tab is unavailable or times
 * out, so the caller degrades gracefully (no devices synced for that patient).
 */
export const requestDeviceReport = (
  encId: string,
  fecha: string,
  timeoutMs = 30000
): Promise<{
  entries?: RayenInvasiveDeviceEntry[];
  base64: string;
  source?: 'json' | 'pdf';
  error?: string;
}> => {
  if (typeof window === 'undefined' || !encId || !fecha) {
    return Promise.resolve({ base64: '' });
  }
  return requestViaBridgeChannel<{
    entries?: RayenInvasiveDeviceEntry[];
    base64: string;
    source?: 'json' | 'pdf';
    error?: string;
  }>({
    prefix: 'device',
    requestType: RAYEN_DEVICE_REPORT_REQUEST_TYPE,
    resultType: RAYEN_DEVICE_REPORT_RESULT_TYPE,
    payload: { encId, fecha, acceptEntries: true },
    timeoutMs,
    onTimeout: () => ({
      base64: '',
      error: 'Tiempo de espera agotado bajando el PDF de dispositivos.',
    }),
    mapResult: mapDeviceReportPayload,
  });
};

/**
 * Ask the extension for one patient's evaluation-scale instruments (Braden/Downton) as the raw
 * JSON forms of Ficha Médico's encounter-form-entry endpoint (full history; HHR parses them with
 * `parseEvaluationScales`). Resolves to `{ forms: [] }` if the extension / Ficha Médico tab is
 * unavailable or times out, so the caller degrades gracefully (no scales synced for that patient).
 */
export const requestScalesReport = (
  encId: string,
  timeoutMs = 30000
): Promise<{ forms: unknown[]; error?: string }> => {
  if (typeof window === 'undefined' || !encId) {
    return Promise.resolve({ forms: [] });
  }
  return requestViaBridgeChannel<{ forms: unknown[]; error?: string }>({
    prefix: 'scales',
    requestType: RAYEN_SCALES_REPORT_REQUEST_TYPE,
    resultType: RAYEN_SCALES_REPORT_RESULT_TYPE,
    payload: { encId },
    timeoutMs,
    onTimeout: () => ({
      forms: [],
      error: 'Tiempo de espera agotado bajando las escalas de evaluación.',
    }),
    mapResult: mapScalesFormsPayload,
  });
};

/**
 * Ask the extension for one patient's evaluation scales (Braden/Downton) as clinical-history events
 * from Ficha Médico's "panel de historial" (`getPatientEncounterHistoryReportServer`). The census
 * date lets the extension bound the remote history window without losing D-7 or its morning handoff.
 * Each event's `publishDatetime` is real, so HHR (`parseHistoryScales`) can select the
 * last score applied ON the census day, including same-day re-applications encounterFormEntry
 * misses. Resolves to `{ events: [] }` if the extension / Ficha Médico tab is
 * unavailable or times out, so the caller degrades gracefully (no scales synced for that patient).
 */
export const requestHistoryScales = (
  encId: string,
  censusDate: string,
  optionsOrTimeout: { lookbackDays?: number } | number = {},
  explicitTimeoutMs = 30000
): Promise<{
  events: HistoryScaleEvent[];
  nursingActivity: RayenNursingActivity[];
  effectiveLookbackDays?: number;
  coverageWindowStartIsoDay?: string;
  coverageWindowEndIsoDay?: string;
  error?: string;
}> => {
  const options = typeof optionsOrTimeout === 'number' ? {} : optionsOrTimeout;
  const timeoutMs = typeof optionsOrTimeout === 'number' ? optionsOrTimeout : explicitTimeoutMs;
  if (typeof window === 'undefined' || !encId) {
    return Promise.resolve({ events: [], nursingActivity: [] });
  }
  return requestViaBridgeChannel<{
    events: HistoryScaleEvent[];
    nursingActivity: RayenNursingActivity[];
    effectiveLookbackDays?: number;
    coverageWindowStartIsoDay?: string;
    coverageWindowEndIsoDay?: string;
    error?: string;
  }>({
    prefix: 'hist-scales',
    requestType: RAYEN_HISTORY_SCALES_REQUEST_TYPE,
    resultType: RAYEN_HISTORY_SCALES_RESULT_TYPE,
    payload: { encId, censusDate, lookbackDays: options.lookbackDays },
    timeoutMs,
    onTimeout: () => ({
      events: [],
      nursingActivity: [],
      error: 'Tiempo de espera agotado bajando el historial clínico.',
    }),
    mapResult: mapHistoryScalesPayload,
  });
};

/**
 * Ask the extension for the CUDYR (CRD) composite result of every patient across Ficha Médico's nurse
 * worklists. Rayen exposes only the aggregate category (e.g. "D3") + datetime per encounter, not the
 * 14 variables. Resolves to `[]` if the extension / Ficha Médico tab is unavailable or times out.
 */
export const requestCudyrCategories = (
  timeoutMs = 30000
): Promise<RayenCudyrCategoriesResponse> => {
  if (typeof window === 'undefined') {
    return Promise.resolve({ items: [] });
  }
  return requestViaBridgeChannel<RayenCudyrCategoriesResponse>({
    prefix: 'cudyr',
    requestType: RAYEN_CUDYR_CATEGORIES_REQUEST_TYPE,
    resultType: RAYEN_CUDYR_CATEGORIES_RESULT_TYPE,
    payload: {},
    timeoutMs,
    onTimeout: () => ({ items: [], error: 'Tiempo de espera agotado leyendo CUDYR.' }),
    mapResult: data => ({
      items: Array.isArray(data.items) ? (data.items as RayenCudyrCategory[]) : [],
      source:
        data.source === 'gestion_camas' ||
        data.source === 'gestion_camas+ficha_medico' ||
        data.source === 'ficha_medico'
          ? data.source
          : undefined,
      historyAvailable:
        typeof data.historyAvailable === 'boolean' ? data.historyAvailable : undefined,
      warning: typeof data.warning === 'string' ? data.warning : undefined,
      error: typeof data.error === 'string' ? data.error : undefined,
    }),
  });
};

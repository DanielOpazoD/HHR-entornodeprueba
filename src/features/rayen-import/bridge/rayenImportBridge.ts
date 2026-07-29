/**
 * Bridge between the browser extension (which reads Rayen) and the HHR app.
 *
 * The extension's content script posts a `window.postMessage` with the snapshot;
 * this module validates the shape and forwards it to subscribers. `pushRayenSnapshot`
 * lets dev/test code inject a snapshot through the same path.
 *
 * Only the message SHAPE is trusted here; the app still previews/confirms before writing.
 */

import type { EgresoLookupResult, EgresoLookupTarget } from '../contracts/egresoLookup';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { RayenNursingActivity } from '../contracts/nursingShiftInference';
import type { RayenInvasiveDeviceEntry } from '../mapping/mapDeviceToInstance';

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

export interface RayenCudyrHistoryEntry {
  id?: string;
  category: string;
  recordedAt: string;
  author?: string;
  authorRole?: string;
  dependencyScore?: number | null;
  riskScore?: number | null;
  items?: Array<{ fieldId: string; label: string; typeId: number; value: string }>;
}

/** One patient's official CUDYR history, with a Ficha Médico latest-value fallback. */
export interface RayenCudyrCategory {
  encId: string;
  crdValue: string;
  crdDateTime: string;
  author?: string;
  authorRole?: string;
  source?: 'gestion_camas' | 'ficha_medico';
  history?: RayenCudyrHistoryEntry[];
}

/**
 * One clinical-history event carrying an evaluation-instruments resume (Braden/Downton), slimmed by
 * the extension from Ficha Médico's "panel de historial". `publishDatetime` is the real application
 * timestamp (unlike encounterFormEntry's stale startDateTime) — HHR parses these with
 * `parseHistoryScales` to pick the last score applied on the census day being synced.
 */
export interface RayenHistoryScaleEvent {
  publishDatetime: string;
  evaluationInstrumentsResume: unknown[];
}

/**
 * Ask the extension to look up the egresos of the given RUNs in gestión de camas — used to
 * recover definitive discharges for patients absent from Ficha Médico (late sync). Resolves
 * to `[]` if the extension / gestión de camas tab is unavailable or times out, so the caller
 * degrades gracefully (keeps the inferred discharges).
 */
export const requestEgresoLookup = (
  requested: Array<string | EgresoLookupTarget>,
  timeoutMs = 30000
): Promise<EgresoLookupResult[]> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !Array.isArray(requested) || requested.length === 0) {
      resolve([]);
      return;
    }
    const targets = requested
      .map(value => (typeof value === 'string' ? { run: value, encounterId: '' } : value))
      .filter(value => value && typeof value.run === 'string');
    const runs = targets.map(target => target.run);
    const reqId = `egreso-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_EGRESO_LOOKUP_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve(Array.isArray(data.results) ? (data.results as EgresoLookupResult[]) : []);
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_EGRESO_LOOKUP_REQUEST_TYPE, reqId, runs, targets },
      window.location.origin
    );
    setTimeout(() => {
      cleanup();
      resolve([]);
    }, timeoutMs);
  });

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
): Promise<EgresoReportRequestResult> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !dateStart || !dateEnd) {
      resolve({ ok: false, reason: 'invalid-request' });
      return;
    }
    const reqId = `egreso-report-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      if (timeoutId) clearTimeout(timeoutId);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_EGRESO_REPORT_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      if (data.ok !== true || !Array.isArray(data.rows)) {
        resolve({ ok: false, reason: 'unavailable' });
        return;
      }
      resolve({ ok: true, rows: data.rows as EgresoReportRow[] });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_EGRESO_REPORT_REQUEST_TYPE, reqId, dateStart, dateEnd },
      window.location.origin
    );
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
  });

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
}> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !encId || !fecha) {
      resolve({ base64: '' });
      return;
    }
    const reqId = `device-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_DEVICE_REPORT_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve({
        entries: Array.isArray(data.entries)
          ? (data.entries as RayenInvasiveDeviceEntry[])
          : undefined,
        base64: typeof data.base64 === 'string' ? data.base64 : '',
        source: data.source === 'json' || data.source === 'pdf' ? data.source : undefined,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_DEVICE_REPORT_REQUEST_TYPE, reqId, encId, fecha },
      window.location.origin
    );
    setTimeout(() => {
      cleanup();
      resolve({ base64: '', error: 'Tiempo de espera agotado bajando el PDF de dispositivos.' });
    }, timeoutMs);
  });

/**
 * Ask the extension for one patient's evaluation-scale instruments (Braden/Downton) as the raw
 * JSON forms of Ficha Médico's encounter-form-entry endpoint (full history; HHR parses them with
 * `parseEvaluationScales`). Resolves to `{ forms: [] }` if the extension / Ficha Médico tab is
 * unavailable or times out, so the caller degrades gracefully (no scales synced for that patient).
 */
export const requestScalesReport = (
  encId: string,
  timeoutMs = 30000
): Promise<{ forms: unknown[]; error?: string }> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !encId) {
      resolve({ forms: [] });
      return;
    }
    const reqId = `scales-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_SCALES_REPORT_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve({
        forms: Array.isArray(data.forms) ? (data.forms as unknown[]) : [],
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_SCALES_REPORT_REQUEST_TYPE, reqId, encId },
      window.location.origin
    );
    setTimeout(() => {
      cleanup();
      resolve({ forms: [], error: 'Tiempo de espera agotado bajando las escalas de evaluación.' });
    }, timeoutMs);
  });

/**
 * Ask the extension for one patient's evaluation scales (Braden/Downton) as clinical-history events
 * from Ficha Médico's "panel de historial" (`getPatientEncounterHistoryReportServer`). The census
 * date lets the extension bound the remote history window without losing D-7 or its morning handoff.
 * Each event's
 * `publishDatetime` is the real application timestamp, so HHR (`parseHistoryScales`) can select the
 * last score applied ON the census day — including past days and same-day re-applications that
 * encounterFormEntry misses. Resolves to `{ events: [] }` if the extension / Ficha Médico tab is
 * unavailable or times out, so the caller degrades gracefully (no scales synced for that patient).
 */
export const requestHistoryScales = (
  encId: string,
  censusDate: string,
  optionsOrTimeout: { lookbackDays?: number } | number = {},
  explicitTimeoutMs = 30000
): Promise<{
  events: RayenHistoryScaleEvent[];
  nursingActivity: RayenNursingActivity[];
  effectiveLookbackDays?: number;
  error?: string;
}> =>
  new Promise(resolve => {
    const options = typeof optionsOrTimeout === 'number' ? {} : optionsOrTimeout;
    const timeoutMs = typeof optionsOrTimeout === 'number' ? optionsOrTimeout : explicitTimeoutMs;
    if (typeof window === 'undefined' || !encId) {
      resolve({ events: [], nursingActivity: [] });
      return;
    }
    const reqId = `hist-scales-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_HISTORY_SCALES_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve({
        events: Array.isArray(data.events) ? (data.events as RayenHistoryScaleEvent[]) : [],
        nursingActivity: Array.isArray(data.nursingActivity)
          ? (data.nursingActivity as RayenNursingActivity[])
          : [],
        effectiveLookbackDays: Number.isFinite(Number(data.effectiveLookbackDays))
          ? Number(data.effectiveLookbackDays)
          : undefined,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      {
        type: RAYEN_HISTORY_SCALES_REQUEST_TYPE,
        reqId,
        encId,
        censusDate,
        lookbackDays: options.lookbackDays,
      },
      window.location.origin
    );
    setTimeout(() => {
      cleanup();
      resolve({
        events: [],
        nursingActivity: [],
        error: 'Tiempo de espera agotado bajando el historial clínico.',
      });
    }, timeoutMs);
  });

/**
 * Ask the extension for the CUDYR (CRD) composite result of every patient across Ficha Médico's nurse
 * worklists. Rayen exposes only the aggregate category (e.g. "D3") + datetime per encounter, not the
 * 14 variables. Resolves to `[]` if the extension / Ficha Médico tab is unavailable or times out.
 */
export const requestCudyrCategories = (
  timeoutMs = 30000
): Promise<{ items: RayenCudyrCategory[]; error?: string }> =>
  new Promise(resolve => {
    if (typeof window === 'undefined') {
      resolve({ items: [] });
      return;
    }
    const reqId = `cudyr-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_CUDYR_CATEGORIES_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve({
        items: Array.isArray(data.items) ? (data.items as RayenCudyrCategory[]) : [],
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_CUDYR_CATEGORIES_REQUEST_TYPE, reqId },
      window.location.origin
    );
    setTimeout(() => {
      cleanup();
      resolve({ items: [], error: 'Tiempo de espera agotado leyendo CUDYR.' });
    }, timeoutMs);
  });

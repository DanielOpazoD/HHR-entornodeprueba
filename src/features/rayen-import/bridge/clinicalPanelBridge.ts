/**
 * Bridge request for the per-patient CLINICAL PANEL (evoluciones + indicaciones + cuidados), served
 * by the extension from Ficha Médico's history and current care-plan endpoints. The extension slims
 * every response to a whitelist (see extension/background.js); nothing is persisted in HHR — the
 * panel is fetched on demand when the drawer opens, so the clinical text never enters Firestore.
 */

import { requestViaBridgeChannel } from '@/services/transport/extensionRequestChannel';

export const RAYEN_CLINICAL_PANEL_REQUEST_TYPE = 'HHR_RAYEN_CLINICAL_PANEL_REQUEST';
export const RAYEN_CLINICAL_PANEL_RESULT_TYPE = 'HHR_RAYEN_CLINICAL_PANEL_RESULT';
export const RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST_TYPE = 'HHR_RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST';
export const RAYEN_PATIENT_DOCUMENT_OPEN_RESULT_TYPE = 'HHR_RAYEN_PATIENT_DOCUMENT_OPEN_RESULT';

export interface RayenPatientDocument {
  id: string;
  classification: string;
  fileName: string;
  name: string;
  attachedBy: string;
  facility: string;
  createdAt: string;
}

/**
 * One history event slimmed to the clinical-panel resumes. Items are raw Ficha Médico rows
 * (SCREAMING_CASE fields) — `parseClinicalPanel` normalizes them into typed entries.
 */
export interface RayenClinicalPanelEvent {
  publishDatetime: string;
  /** Treatment validation timestamp for this history event, when Eloisa supplied one. */
  validationDatetime?: string;
  evolutionResume: unknown[];
  shiftChangeResume: unknown[];
  patientPharmaIndicationResume: unknown[];
  patientFreeIndicationResume: unknown[];
  nutritionOrderResume: unknown[];
  restResume: unknown[];
}

/** Slim current-state payload from Ficha Medico's care-plan endpoints. */
export interface RayenClinicalPanelCarePlan {
  carePlanHeaders: unknown[];
  medicationStates: unknown[];
}

export interface RayenClinicalPanelResult {
  /** Present only when the extension read a window reaching this admission date. */
  historyFrom?: string;
  /** Historical admission vitals, read with the same Eloísa session, independent of the live census. */
  forms?: unknown[];
  formError?: string;
  events: RayenClinicalPanelEvent[];
  carePlan: RayenClinicalPanelCarePlan;
  error?: string;
  documents?: RayenPatientDocument[];
  documentError?: string;
}

const EMPTY_CARE_PLAN: RayenClinicalPanelCarePlan = {
  carePlanHeaders: [],
  medicationStates: [],
};

/**
 * Ask the extension for one patient's clinical panel events. Resolves to `{ events: [] }` (with an
 * `error` message) if the extension / Ficha Médico tab is unavailable or times out, so the drawer
 * degrades to its error state instead of hanging.
 */
const panelFailure = (error: string): RayenClinicalPanelResult => ({
  events: [],
  carePlan: EMPTY_CARE_PLAN,
  error,
});

const decodeCarePlan = (value: unknown): RayenClinicalPanelCarePlan => {
  if (!value || typeof value !== 'object') return EMPTY_CARE_PLAN;
  const candidate = value as Record<string, unknown>;
  return {
    carePlanHeaders: Array.isArray(candidate.carePlanHeaders) ? candidate.carePlanHeaders : [],
    medicationStates: Array.isArray(candidate.medicationStates) ? candidate.medicationStates : [],
  };
};

export const requestClinicalPanel = (
  encId: string,
  timeoutMs = 30000,
  signal?: AbortSignal,
  options?: { historyFrom: string }
): Promise<RayenClinicalPanelResult> => {
  if (signal?.aborted) {
    return Promise.resolve(panelFailure('Consulta del panel clínico cancelada.'));
  }
  if (typeof window === 'undefined' || !encId.trim()) {
    return Promise.resolve(
      panelFailure('No hay un episodio válido para consultar el panel clínico.')
    );
  }
  return requestViaBridgeChannel<RayenClinicalPanelResult>({
    prefix: 'clinical-panel',
    requestType: RAYEN_CLINICAL_PANEL_REQUEST_TYPE,
    resultType: RAYEN_CLINICAL_PANEL_RESULT_TYPE,
    payload: { encId, ...(options ? { historyFrom: options.historyFrom } : {}) },
    timeoutMs,
    signal,
    // Cancels the HHR wait; the extension may finish its read in the background.
    onAbort: () => panelFailure('Consulta del panel clínico cancelada.'),
    onTimeout: () => panelFailure('Tiempo de espera agotado bajando el panel clínico.'),
    onDispatchError: () =>
      panelFailure('No se pudo consultar el panel clínico mediante la extensión.'),
    mapResult: data => ({
      historyFrom: typeof data.historyFrom === 'string' ? data.historyFrom : undefined,
      forms: Array.isArray(data.forms) ? data.forms : undefined,
      formError: typeof data.formError === 'string' ? data.formError : undefined,
      events: Array.isArray(data.events) ? (data.events as RayenClinicalPanelEvent[]) : [],
      carePlan: decodeCarePlan(data.carePlan),
      error: typeof data.error === 'string' ? data.error : undefined,
      documents: Array.isArray(data.documents)
        ? data.documents.filter((item: unknown): item is RayenPatientDocument => {
            if (!item || typeof item !== 'object') return false;
            const row = item as Record<string, unknown>;
            return [
              'id',
              'classification',
              'fileName',
              'name',
              'attachedBy',
              'facility',
              'createdAt',
            ].every(field => typeof row[field] === 'string');
          })
        : undefined,
      documentError: typeof data.documentError === 'string' ? data.documentError : undefined,
    }),
  });
};

export interface RayenPatientDocumentOpenResult {
  ok: boolean;
  opened: boolean;
  error?: string;
}

export const requestPatientDocumentOpen = (
  encId: string,
  documentId: string,
  timeoutMs = 20000
): Promise<RayenPatientDocumentOpenResult> => {
  if (typeof window === 'undefined' || !encId.trim() || !documentId.trim()) {
    return Promise.resolve({
      ok: false,
      opened: false,
      error: 'El archivo seleccionado no es válido.',
    });
  }
  return requestViaBridgeChannel<RayenPatientDocumentOpenResult>({
    prefix: 'patient-document',
    requestType: RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST_TYPE,
    resultType: RAYEN_PATIENT_DOCUMENT_OPEN_RESULT_TYPE,
    payload: { encId, documentId },
    timeoutMs,
    onTimeout: () => ({
      ok: false,
      opened: false,
      error: 'La extensión no respondió al abrir el archivo.',
    }),
    onDispatchError: () => ({
      ok: false,
      opened: false,
      error: 'No se pudo abrir el archivo mediante la extensión.',
    }),
    mapResult: data => ({
      ok: data.ok === true,
      opened: data.opened === true,
      error: typeof data.error === 'string' ? data.error : undefined,
    }),
  });
};

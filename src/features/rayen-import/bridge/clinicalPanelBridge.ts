/**
 * Bridge request for the per-patient CLINICAL PANEL (evoluciones + indicaciones + cuidados), served
 * by the extension from Ficha Médico's history and current care-plan endpoints. The extension slims
 * every response to a whitelist (see extension/background.js); nothing is persisted in HHR — the
 * panel is fetched on demand when the drawer opens, so the clinical text never enters Firestore.
 */

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
export const requestClinicalPanel = (
  encId: string,
  timeoutMs = 30000,
  signal?: AbortSignal
): Promise<RayenClinicalPanelResult> =>
  new Promise(resolve => {
    const failure = (error: string): RayenClinicalPanelResult => ({
      events: [],
      carePlan: EMPTY_CARE_PLAN,
      error,
    });
    if (signal?.aborted) {
      resolve(failure('Consulta del panel clínico cancelada.'));
      return;
    }
    if (typeof window === 'undefined' || !encId.trim()) {
      resolve(failure('No hay un episodio válido para consultar el panel clínico.'));
      return;
    }
    const reqId = `clinical-panel-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    // eslint-disable-next-line prefer-const -- assigned once below, but read earlier by cleanup() (forward ref)
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };

    // Cancels the HHR wait only; older extensions may finish their read in the background.
    const onAbort = (): void => {
      cleanup();
      resolve(failure('Consulta del panel clínico cancelada.'));
    };

    const onMessage = (event: MessageEvent): void => {
      if (settled || event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_CLINICAL_PANEL_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve({
        events: Array.isArray(data.events) ? (data.events as RayenClinicalPanelEvent[]) : [],
        carePlan:
          data.carePlan && typeof data.carePlan === 'object'
            ? {
                carePlanHeaders: Array.isArray(data.carePlan.carePlanHeaders)
                  ? data.carePlan.carePlanHeaders
                  : [],
                medicationStates: Array.isArray(data.carePlan.medicationStates)
                  ? data.carePlan.medicationStates
                  : [],
              }
            : EMPTY_CARE_PLAN,
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
      });
    };

    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = setTimeout(() => {
      cleanup();
      resolve(failure('Tiempo de espera agotado bajando el panel clínico.'));
    }, timeoutMs);
    try {
      window.postMessage(
        { type: RAYEN_CLINICAL_PANEL_REQUEST_TYPE, reqId, encId },
        window.location.origin
      );
    } catch {
      cleanup();
      resolve(failure('No se pudo consultar el panel clínico mediante la extensión.'));
    }
  });

export interface RayenPatientDocumentOpenResult {
  ok: boolean;
  opened: boolean;
  error?: string;
}

export const requestPatientDocumentOpen = (
  encId: string,
  documentId: string,
  timeoutMs = 20000
): Promise<RayenPatientDocumentOpenResult> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !encId.trim() || !documentId.trim()) {
      resolve({ ok: false, opened: false, error: 'El archivo seleccionado no es válido.' });
      return;
    }
    const reqId = `patient-document-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    // eslint-disable-next-line prefer-const -- assigned after listener setup, read by cleanup()
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_PATIENT_DOCUMENT_OPEN_RESULT_TYPE || data.reqId !== reqId) {
        return;
      }
      cleanup();
      resolve({
        ok: data.ok === true,
        opened: data.opened === true,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };
    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST_TYPE, reqId, encId, documentId },
      window.location.origin
    );
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        ok: false,
        opened: false,
        error: 'La extensión no respondió al abrir el archivo.',
      });
    }, timeoutMs);
  });

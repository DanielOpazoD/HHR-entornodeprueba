/**
 * Bridge request for the per-patient CLINICAL PANEL (evoluciones + indicaciones + cuidados), served
 * by the extension from Ficha Médico's history and current care-plan endpoints. The extension slims
 * every response to a whitelist (see extension/background.js); nothing is persisted in HHR — the
 * panel is fetched on demand when the drawer opens, so the clinical text never enters Firestore.
 */

export const RAYEN_CLINICAL_PANEL_REQUEST_TYPE = 'HHR_RAYEN_CLINICAL_PANEL_REQUEST';
export const RAYEN_CLINICAL_PANEL_RESULT_TYPE = 'HHR_RAYEN_CLINICAL_PANEL_RESULT';

/**
 * One history event slimmed to the clinical-panel resumes. Items are raw Ficha Médico rows
 * (SCREAMING_CASE fields) — `parseClinicalPanel` normalizes them into typed entries.
 */
export interface RayenClinicalPanelEvent {
  publishDatetime: string;
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
  timeoutMs = 30000
): Promise<RayenClinicalPanelResult> =>
  new Promise(resolve => {
    if (typeof window === 'undefined' || !encId) {
      resolve({ events: [], carePlan: EMPTY_CARE_PLAN });
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
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
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
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_CLINICAL_PANEL_REQUEST_TYPE, reqId, encId },
      window.location.origin
    );
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        events: [],
        carePlan: EMPTY_CARE_PLAN,
        error: 'Tiempo de espera agotado bajando el panel clínico.',
      });
    }, timeoutMs);
  });

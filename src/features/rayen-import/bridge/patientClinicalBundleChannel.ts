import { requestViaBridgeChannel } from './bridgeRequestChannel';
import {
  RAYEN_PATIENT_CLINICAL_BUNDLE_CAPABILITY,
  hasRayenExtensionCapability,
} from './extensionHealthBridge';
import type {
  RayenDeviceReportResult,
  RayenHistoryScaleEvent,
  RayenHistoryScalesResult,
  RayenPatientClinicalBundle,
  RayenScalesFormsResult,
} from '../contracts/patientClinicalBundle';
import type { RayenNursingActivity } from '../contracts/nursingShiftInference';
import type { RayenInvasiveDeviceEntry } from '../mapping/mapDeviceToInstance';

export const RAYEN_PATIENT_CLINICAL_BUNDLE_REQUEST_TYPE =
  'HHR_RAYEN_PATIENT_CLINICAL_BUNDLE_REQUEST';
export const RAYEN_PATIENT_CLINICAL_BUNDLE_RESULT_TYPE = 'HHR_RAYEN_PATIENT_CLINICAL_BUNDLE_RESULT';

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Normalizadores de cada sección — la MISMA forma que los canales individuales. */
export const mapDeviceReportPayload = (data: Record<string, unknown>): RayenDeviceReportResult => ({
  entries: Array.isArray(data.entries) ? (data.entries as RayenInvasiveDeviceEntry[]) : undefined,
  base64: typeof data.base64 === 'string' ? data.base64 : '',
  source: data.source === 'json' || data.source === 'pdf' ? data.source : undefined,
  error: optionalString(data.error),
});

export const mapHistoryScalesPayload = (
  data: Record<string, unknown>
): RayenHistoryScalesResult => ({
  events: Array.isArray(data.events) ? (data.events as RayenHistoryScaleEvent[]) : [],
  nursingActivity: Array.isArray(data.nursingActivity)
    ? (data.nursingActivity as RayenNursingActivity[])
    : [],
  effectiveLookbackDays: Number.isFinite(Number(data.effectiveLookbackDays))
    ? Number(data.effectiveLookbackDays)
    : undefined,
  coverageWindowStartIsoDay: optionalString(data.coverageWindowStartIsoDay),
  coverageWindowEndIsoDay: optionalString(data.coverageWindowEndIsoDay),
  error: optionalString(data.error),
});

export const mapScalesFormsPayload = (data: Record<string, unknown>): RayenScalesFormsResult => ({
  forms: Array.isArray(data.forms) ? (data.forms as unknown[]) : [],
  error: optionalString(data.error),
});

const section = (value: unknown, fallbackError: string): Record<string, unknown> =>
  value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : { error: fallbackError };

const allSectionsFailed = (error: string): RayenPatientClinicalBundle => ({
  devices: { base64: '', error },
  history: { events: [], nursingActivity: [], error },
  forms: { forms: [], error },
});

/**
 * Las tres lecturas clínicas de un paciente en UN solo mensaje a la extensión.
 * Devuelve `null` cuando la extensión instalada no declara la capability
 * (extensión antigua): el caller usa entonces los tres canales individuales
 * sin pagar un timeout. Un fallo de mensajería degrada las tres secciones con
 * `{error}` y el caller reintenta cada fuente por su canal individual.
 */
export const requestPatientClinicalBundle = (
  encId: string,
  fecha: string,
  options: { censusDate?: string; lookbackDays?: number } = {},
  timeoutMs = 45_000
): Promise<RayenPatientClinicalBundle | null> => {
  if (typeof window === 'undefined' || !encId || !fecha) return Promise.resolve(null);
  if (!hasRayenExtensionCapability(RAYEN_PATIENT_CLINICAL_BUNDLE_CAPABILITY)) {
    return Promise.resolve(null);
  }
  return requestViaBridgeChannel<RayenPatientClinicalBundle>({
    prefix: 'clinical-bundle',
    requestType: RAYEN_PATIENT_CLINICAL_BUNDLE_REQUEST_TYPE,
    resultType: RAYEN_PATIENT_CLINICAL_BUNDLE_RESULT_TYPE,
    payload: {
      encId,
      fecha,
      acceptEntries: true,
      censusDate: options.censusDate,
      lookbackDays: options.lookbackDays,
    },
    timeoutMs,
    onTimeout: () =>
      allSectionsFailed('Tiempo de espera agotado leyendo el paquete clínico del paciente.'),
    mapResult: data => {
      const relayError = optionalString(data.error);
      if (relayError && !data.devices && !data.history && !data.forms) {
        return allSectionsFailed(relayError);
      }
      const fallback = relayError ?? 'La extensión no entregó esta fuente.';
      return {
        devices: mapDeviceReportPayload(section(data.devices, fallback)),
        history: mapHistoryScalesPayload(section(data.history, fallback)),
        forms: mapScalesFormsPayload(section(data.forms, fallback)),
      };
    },
  });
};

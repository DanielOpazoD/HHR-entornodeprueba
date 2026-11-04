import type { ClinicalReadFailure } from './clinicalReadError';
import type { RayenNursingActivity } from './nursingShiftInference';
import type { RayenInvasiveDeviceEntry } from '../mapping/mapDeviceToInstance';

/**
 * Un evento del "panel de historial" de Ficha Médico con resumen de
 * instrumentos de evaluación (Braden/Downton). `publishDatetime` es el momento
 * real de aplicación (a diferencia de encounterFormEntry).
 */
export interface RayenHistoryScaleEvent {
  publishDatetime: string;
  evaluationInstrumentsResume: unknown[];
}

/** Resultado de la lectura de dispositivos de un paciente (idéntico al canal individual). */
export interface RayenDeviceReportResult extends ClinicalReadFailure {
  entries?: RayenInvasiveDeviceEntry[];
  base64: string;
  source?: 'json' | 'pdf';
}

/** Resultado del historial de escalas de un paciente (idéntico al canal individual). */
export interface RayenHistoryScalesResult extends ClinicalReadFailure {
  events: RayenHistoryScaleEvent[];
  nursingActivity: RayenNursingActivity[];
  effectiveLookbackDays?: number;
  coverageWindowStartIsoDay?: string;
  coverageWindowEndIsoDay?: string;
}

/** Resultado de los formularios de escalas/vitales de un paciente. */
export interface RayenScalesFormsResult extends ClinicalReadFailure {
  forms: unknown[];
}

/**
 * Notas de «Alertas» de la ficha tal como las entrega Eloísa. Son las vigentes al leer, por eso
 * la extensión solo las lee para el día clínico en curso y marca `skipped` en otro día.
 */
export interface RayenClinicalAlertsResult extends ClinicalReadFailure {
  alerts: unknown[];
  skipped?: boolean;
}

/**
 * Las tres lecturas clínicas de un paciente resueltas en UN solo mensaje a la
 * extensión (capability `patient-clinical-bundle`). Cada sección degrada por
 * separado con `{error}`, así la cobertura por fuente se clasifica igual que
 * con los canales individuales.
 */
export interface RayenPatientClinicalBundle {
  devices: RayenDeviceReportResult;
  history: RayenHistoryScalesResult;
  forms: RayenScalesFormsResult;
  /** Ausente en extensiones anteriores a 0.48.72: las alertas guardadas se conservan. */
  alerts?: RayenClinicalAlertsResult;
}

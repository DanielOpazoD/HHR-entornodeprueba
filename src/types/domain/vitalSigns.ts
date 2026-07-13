/**
 * Latest vital signs synced from Ficha Médico (Rayen) into a patient's census row. Sourced from the
 * `VITAL_SIGNS` forms of the encounter-form-entry endpoint (same feed as the nursing scales) — one
 * form per measurement, from which we keep the most recent set as of the census day.
 *
 * All numeric readings are nullable: a `VITAL_SIGNS` form may record only some of them.
 */
export interface PatientVitalSigns {
  /** ISO local day the vitals were taken (YYYY-MM-DD, Rapa Nui) — key for census-day selection. */
  recordedDate: string;
  /** When they were taken, verbatim (measurement time when present, else the form's stamp). */
  recordedAt: string;
  /** Systolic blood pressure (mmHg). */
  systolic: number | null;
  /** Diastolic blood pressure (mmHg). */
  diastolic: number | null;
  /** Heart rate / pulse (bpm). */
  heartRate: number | null;
  /** Oxygen saturation (%). */
  spo2: number | null;
  /** Temperature (°C) — axillary preferred, else oral/tympanic/rectal. */
  temperature: number | null;
  /** Respiratory rate (breaths/min). */
  respiratoryRate: number | null;
  /** Pain, visual analog scale (0–10). */
  painEva: number | null;
  /** Capillary blood glucose / hemoglucotest (mg/dL). */
  hgt: number | null;
  /** Rapid insulin administered with the reading (units). */
  insulinUnits: number | null;
  /** Abdominal quadrant where the insulin was injected (e.g. "CSI"), '' when not recorded. */
  insulinQuadrant: string | null;
  /** Free-text observations recorded with the vitals (e.g. "PAM 94, diuresis +"). */
  observations: string | null;
  /** Who recorded them (may be empty). */
  author: string;
  /** Author role, e.g. "Paramédico" / "Enfermera(o)". */
  authorRole: string;
}

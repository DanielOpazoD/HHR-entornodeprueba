/**
 * Input contract for the Rayen → HHR census import.
 *
 * A `RayenCensusSnapshot` is what the browser extension produces after reading
 * Rayen (fichamedico) and normalizing it. This module only depends on this shape,
 * never on Rayen's raw API, so the extension and the app stay decoupled.
 *
 * See `Eloisa Hospitalizados/PLAN-SINCRONIZACION.md` for the field-level mapping.
 */

/** One admitted encounter read from Rayen, already normalized by the extension. */
export interface RayenEncounter {
  /** Rayen `encId` — stable episode id. Maps to `PatientData.clinicalEpisodeId`. */
  encounterId: string;
  /** Patient RUN. May arrive raw ("144700554") or formatted ("14.470.055-4"). */
  run: string;
  /** Given name(s) — Rayen `firstGivenName`. */
  firstGivenName: string;
  /** Additional given names — Rayen `nextGivenNames`. */
  nextGivenNames?: string;
  /** First family name — Rayen `firstFamilyName`. */
  firstFamilyName: string;
  /** Second family name — Rayen `secondFamilyName`. */
  secondFamilyName?: string;
  /** ISO birth date — Rayen `birthDate`. */
  birthDate?: string;
  /** Administrative sex text: "Mujer" | "Hombre" — Rayen `adseName`. */
  administrativeSex?: string;
  /** Gender text: "Femenina" | "Masculino" — Rayen `genero`/`gendName`. */
  gender?: string;
  /** Service / department short name — Rayen `hospitalDepartmentShortName` or area name. Used to detect CMA. */
  service?: string;
  /** Room short name — Rayen `roomShortName` (e.g. "H1", "Recuperacion 1", "CMA R1"). */
  room?: string;
  /** Bed short name — Rayen `bedShortName` (e.g. "C2", "R1", "CMAR1"). */
  bed?: string;
  /** Admission datetime — Rayen `encStartPeriod` (ISO). */
  admissionDatetime?: string;
  /** Admission diagnosis text — Rayen `haoDiagName` / `diagnosisName`. */
  diagnosis?: string;
  /** CIE-10 code of the first active principal diagnosis in Ficha Medico. */
  diagnosisCode?: string;
  /** Display name paired with `diagnosisCode`. */
  diagnosisDescription?: string;
  /** True if the encounter has a medical discharge (alta médica) in Rayen. */
  hasMedicalDischarge?: boolean;
  /** True if the nurse completed the clinical closure in Rayen; never an administrative egreso authority. */
  hasNurseDischarge?: boolean;
  /** Discharge datetime if discharged (ISO). */
  dischargeDatetime?: string;
  /** True if the patient is deceased. */
  isDead?: boolean;
  /** True if the patient is in isolation. */
  isIsolated?: boolean;
  /** True if the patient is GES. */
  isGes?: boolean;
}

/** A census snapshot captured from Rayen at a point in time. */
export interface RayenCensusSnapshot {
  /** ISO timestamp when the snapshot was captured by the extension. */
  capturedAt: string;
  /** Rayen facility id (1342 for HHR). */
  facilityId: number;
  /** All admitted encounters (real service + CMA virtual service). */
  encounters: RayenEncounter[];
  /**
   * True ONLY when this snapshot is the FULL active census (every service/ward).
   * A patient present in the HHR census but absent here can be inferred as discharged
   * only when this is `true`. Omitted / `false` is treated conservatively (partial):
   * absent patients are left untouched, never auto-discharged. The extension MUST set
   * this to `true` only after assembling the complete census.
   */
  isComplete?: boolean;
}

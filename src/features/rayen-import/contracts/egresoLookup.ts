/**
 * Contract for the gestión de camas egreso lookup (Fase B).
 *
 * When a patient present in the HHR census is absent from Ficha Médico (a late sync, after
 * the definitive egreso), the extension looks the patient up by RUN in gestión de camas
 * (`hospitalizado.rayensalud.cl`), which still holds the egreso. The lookup returns the
 * relevant discharge fields so HHR can record the real egreso (with its type) instead of a
 * generic inferred alta.
 */

/**
 * Discharge-relevant fields forwarded by the extension from a gestión de camas encounter.
 * The exact field carrying the destination (domicilio vs traslado) is confirmed against a
 * real response; `egresoDischargeMapping` reads it defensively, so this stays permissive.
 */
export interface EgresoRecord {
  id?: number | string;
  endPeriod?: string;
  dateDischarge?: string;
  isDead?: boolean;
  hasMedicalDischarge?: boolean;
  hasNurseDischarge?: boolean;
  hasNursingDischarge?: boolean;
  hasAdministrativeDischarge?: boolean;
  /** Any of these may carry the destination text (Rayen's exact field TBD). */
  dischargeDestination?: string;
  dischargeDestinationName?: string;
  destinationSystemName?: string;
  dischargeReasonName?: string;
  dischargeTypeName?: string;
  bedDestination?: string;
  destinationBed?: string;
  [key: string]: unknown;
}

export interface EgresoLookupTarget {
  run: string;
  /** Exact hospitalization to verify. The fallback must never use another episode for the same RUN. */
  encounterId: string;
}

/** Result of looking up one RUN in gestión de camas. */
export interface EgresoLookupResult {
  /** The RUN that was looked up (as sent). */
  run: string;
  /** Episode requested and selected by the extension. */
  encounterId?: string;
  /** The egreso record, when found. */
  egreso?: EgresoRecord;
  /** Error message, when the lookup failed for this RUN. */
  error?: string;
}

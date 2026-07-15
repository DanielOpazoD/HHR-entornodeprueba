/**
 * Contract for the bulk "Alta Administrativa" egreso report (Fase C).
 *
 * gestión de camas renders the day's discharges as a Jasper report. The extension downloads
 * and parses it in the background (bypassing CORS) into these plain rows. Unlike the by-RUN
 * lookup (Fase B), the report enumerates egresos WITHOUT knowing the RUNs beforehand, so it
 * also surfaces patients HHR never synced (admitted and discharged between two syncs) — and it
 * carries the discharge DESTINATION (domicilio / traslado) explicitly, which the JSON lacked.
 */

import type { DischargeKind } from '../mapping/dischargeMapping';

/** One egreso row as parsed from the report .xls by the extension. All fields are raw text. */
export interface EgresoReportRow {
  /** Patient RUN as printed (e.g. "12.345.678-9"). */
  run: string;
  patientName: string;
  /** Bed label as printed by Rayen (e.g. "R2", "Neo2", "Cama 2"). */
  bedLabel: string;
  servicio: string;
  edad: string;
  /** Discharge destination text (e.g. "Domicilio", "Traslado a …"). */
  destino: string;
  motivo: string;
  /** Discharge datetime text (e.g. "09-07-2026 19:42"). */
  fechaEgreso: string;
  /** Principal discharge diagnosis (present once the extension parses that column). */
  diagnostico?: string;
}

/**
 * A report egreso that HHR never synced — its RUN is unknown to both the current census and the
 * snapshot. Surfaced in the preview for the nurse to review; never auto-applied, since the
 * patient never occupied an HHR bed here.
 */
export interface ReportEgreso {
  run: string;
  patientName: string;
  bedLabel: string;
  destino: string;
  fechaEgreso: string;
  kind: DischargeKind;
  status: 'Vivo' | 'Fallecido';
  /** Raw age text from the report (e.g. "60 año(s), 3 mes(es)…"), for the discharge record. */
  edad?: string;
  /** Clinical service, mapped to the discharge record's specialty. */
  servicio?: string;
  /** Principal discharge diagnosis, when the report carries it. */
  diagnostico?: string;
  /** Normalized Rapa Nui egreso day + time exactly as printed by the statistical report. */
  correctedDay?: string;
  correctedTime?: string;
}

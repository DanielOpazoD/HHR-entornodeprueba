/**
 * Stored model for nursing evaluation scales (risk scales) on a patient: Escala de riesgo UPP
 * (Braden) and Escala de Riesgo de caídas (Downton). Populated by the Rayen sync from Ficha Médico.
 *
 * Kept intentionally lean: total + Eloísa severity + recorded day are stored. The source severity
 * owns the classification shown to users, while planned care ("conducta") and reapplication due-date
 * remain derived from HHR's local policy (see `@/domain/evaluationScales/bradenRisk`). Keeping those
 * responsibilities separate lets either contract evolve without rewriting stored records.
 */

export type EvaluationScaleCode = 'BRADEN' | 'DOWNTON';

/** Braden risk level per the hospital's table (LPP risk). */
export type BradenRiskLevel = 'bajo' | 'medio' | 'alto';

/** One answered sub-scale item, kept for the future detailed breakdown view. */
export interface EvaluationScoreItem {
  id: string;
  label: string;
  value: string;
  valueName: string;
}

/** Latest attributable application, including entries hidden from Rayen's quick summary. */
export interface EvaluationScaleApplicationEvidence {
  recordedDate: string;
  recordedAt: string;
  author?: string;
  authorRole?: string;
  /** The user hid this application from Rayen's quick summary; it remains available in Historial. */
  archived?: boolean;
}

/** A single recorded scale snapshot for a patient. */
export interface EvaluationScoreEntry {
  code: EvaluationScaleCode;
  /** Instrument name as printed, e.g. "Escala de riesgo UPP (Braden)". */
  name: string;
  /** Normalized application timestamp; higher = more recent. */
  encounterEventId: number;
  /** Source-level monotonic tie-breaker when two applications share the same timestamp. */
  sourceOrder?: number;
  /** Total numeric score ("Puntaje"); null when the scale is in progress. */
  total: number | null;
  /** Severity as reported by the source ("Nivel de Severidad"), e.g. "Riesgo bajo". */
  severity: string | null;
  /** ISO local day (Rapa Nui) it was performed — YYYY-MM-DD. */
  recordedDate: string;
  /** When it was performed, verbatim as printed. */
  recordedAt: string;
  /** Professional who applied the scale, as reported by Ficha Médico (may be absent on old data). */
  author?: string;
  /** The professional's role, e.g. "Enfermera". */
  authorRole?: string;
  /** True when this entry is hidden from Rayen's quick summary but remains in Historial. */
  archived?: boolean;
  /**
   * Most recent application evidence. It can differ from the displayed result when the same day has
   * both visible and archived applications; this separate timestamp drives reapplication compliance.
   */
  latestApplication?: EvaluationScaleApplicationEvidence;
  /** The individual sub-scale answers (optional; present on the current entries, kept for detail). */
  items?: EvaluationScoreItem[];
}

export interface ImportedCudyrItem {
  fieldId: string;
  label: string;
  typeId: number;
  value: string;
}

export interface ImportedCudyrHistoryEntry {
  category: string;
  recordedDate: string;
  recordedAt: string;
  author?: string;
  authorRole?: string;
  dependencyScore?: number | null;
  riskScore?: number | null;
  items?: ImportedCudyrItem[];
}

/** Imported CUDYR from the official Gestión de Camas work list (or Ficha Médico fallback). */
export interface ImportedCudyr {
  /** Composite CUDYR category, e.g. "D3". */
  category: string;
  /** Census/night-shift day that owns the categorization in Rapa Nui — YYYY-MM-DD. */
  recordedDate: string;
  /** Source timestamp including time and offset. */
  recordedAt?: string;
  author?: string;
  authorRole?: string;
  dependencyScore?: number | null;
  riskScore?: number | null;
  items?: ImportedCudyrItem[];
  history?: ImportedCudyrHistoryEntry[];
  /** Provenance shown in the UI. */
  source: string;
}

/**
 * A patient's evaluation scales: the current value per scale plus the stay history (most-recent-first)
 * that feeds the unified risk view. The history is a compact snapshot (usually without `items`).
 * `cudyr` carries the imported official daily CUDYR snapshot and its attributable history.
 */
export interface PatientEvaluationScores {
  braden?: EvaluationScoreEntry;
  downton?: EvaluationScoreEntry;
  cudyr?: ImportedCudyr;
  history?: EvaluationScoreEntry[];
}

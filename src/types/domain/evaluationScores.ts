/**
 * Stored model for nursing evaluation scales (risk scales) on a patient: Escala de riesgo UPP
 * (Braden) and Escala de Riesgo de caídas (Downton). Populated by the Rayen sync from Ficha Médico.
 *
 * Kept intentionally lean and derivation-free: the total + severity + recorded day are stored, while
 * the RISK LEVEL, the planned care ("conducta") and the reapplication due-date are DERIVED at display
 * time from the total + patient age + reference day (see `@/domain/evaluationScales/bradenRisk`). This
 * keeps records small and lets the clinical thresholds evolve without a data migration.
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

/** A single recorded scale snapshot for a patient. */
export interface EvaluationScoreEntry {
  code: EvaluationScaleCode;
  /** Instrument name as printed, e.g. "Escala de riesgo UPP (Braden)". */
  name: string;
  /** Monotonic source id; higher = more recent. Dedup / recency key. */
  encounterEventId: number;
  /** Total numeric score ("Puntaje"); null when the scale is in progress. */
  total: number | null;
  /** Severity as reported by the source ("Nivel de Severidad"), e.g. "Riesgo bajo". */
  severity: string | null;
  /** ISO local day (Rapa Nui) it was performed — YYYY-MM-DD. */
  recordedDate: string;
  /** When it was performed, verbatim as printed. */
  recordedAt: string;
  /** The individual sub-scale answers (optional; present on the current entries, kept for detail). */
  items?: EvaluationScoreItem[];
}

/**
 * A patient's evaluation scales: the current value per scale plus the stay history (most-recent-first)
 * that feeds the unified risk view. The history is a compact snapshot (usually without `items`).
 */
export interface PatientEvaluationScores {
  braden?: EvaluationScoreEntry;
  downton?: EvaluationScoreEntry;
  history?: EvaluationScoreEntry[];
}

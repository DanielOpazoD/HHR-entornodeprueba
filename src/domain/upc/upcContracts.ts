/**
 * Persistence shape for the UPC checklist stored inside PatientData.
 *
 * Arrays (not Sets) because Firestore serializes them natively.
 * `classification` is derived from the criteria but stored explicitly
 * so downstream consumers don't need the classification function.
 */
export interface UpcChecklistAuditActor {
  readonly uid: string;
  readonly displayName: string;
}

export interface UpcEvaluationSnapshot {
  /** Stable across transport retries; absent on older evaluations. */
  readonly evaluationId?: string;
  /** Wording at the time of signing, so later catalogue edits do not rewrite history. */
  readonly criterionLabels?: string[];
  /** UCI criterion IDs that were checked (e.g. ['uci_vmi']) */
  readonly uciCriteria: string[];
  /** UTI criterion IDs that were checked (e.g. ['uti_sepsis']) */
  readonly utiCriteria: string[];
  /** Resolved classification: 'UPC_UCI' | 'UPC_UTI' | null */
  readonly classification: 'UPC_UCI' | 'UPC_UTI' | null;
  /** ISO timestamp of the last evaluation */
  readonly evaluatedAt: string;
  /** User who performed the evaluation (audit trail). */
  readonly evaluatedBy?: UpcChecklistAuditActor;
  /** Census day reviewed, distinct from the actual timestamp of entry. */
  readonly evaluatedForDate?: string;
  readonly evaluatedBedId?: string;
  readonly responsibleNurse?: {
    readonly name: string;
    /** Legacy metadata; new daily evaluations do not require or record a shift. */
    readonly shift?: 'day' | 'night';
    readonly source: 'assigned' | 'manual';
  };
}

export interface UpcChecklistRecord extends UpcEvaluationSnapshot {
  /** A move invalidates the review, never the historical snapshot. */
  readonly reviewRequired?: boolean;
  /** Signed evaluations retained in this census day; previous days remain in their records. */
  readonly history?: UpcEvaluationSnapshot[];
}

export const EMPTY_UPC_CHECKLIST: UpcChecklistRecord = {
  uciCriteria: [],
  utiCriteria: [],
  classification: null,
  evaluatedAt: '',
};

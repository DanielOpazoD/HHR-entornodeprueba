import { BEDS } from '@/constants/beds';
import {
  resolveUpcClassificationLabel,
  type UpcClassification,
} from '@/domain/upc/upcClassification';
import { isUciEligibleBedId, resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';
import { resolveUpcReviewReason } from '@/shared/census/upcEvaluationPolicy';
import { buildUpcCriteriaEvaluation } from '@/domain/upc/upcCriteriaEvaluation';
import { resolveUpcEpisodeIdentity } from '@/domain/upc/upcRoundSubject';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';
import type {
  UpcChecklistAuditActor,
  UpcChecklistRecord,
  UpcRoundEvaluation,
} from '@/domain/upc/upcContracts';
import {
  isValidUciCriterionId,
  isValidUtiCriterionId,
  normalizeUciCriterionId,
  sanitizeCriterionIds,
} from '@/domain/upc/upcCriteria';

/** Beds the UPC protocol classifies, in census order. */
export const UPC_CLASSIFIABLE_BED_IDS = ['R1', 'R2', 'R3', 'R4', 'NEO1', 'NEO2'] as const;

const BED_NAMES = new Map(BEDS.map(bed => [bed.id, bed.name]));

export interface UpcWindowSubject {
  bedId?: string;
  patientName?: string;
  rut?: string;
  clinicalEpisodeId?: string;
  firstSeenDate?: string;
  admissionDate?: string;
  admissionTime?: string;
  isUPC?: boolean;
  upcChecklist?: UpcChecklistRecord;
  clinicalCrib?: UpcWindowSubject;
}

export interface UpcClassificationRow {
  /** Stable identity of the row: the bed, or the attached clinical crib of that bed. */
  key: string;
  bedId: string;
  isCrib: boolean;
  bedName: string;
  patientName: string;
  rut: string;
  /** Episodio que ocupaba la cama cuando se construyó la fila. */
  episodeIdentity: string;
  /** False for an empty or blocked bed: nothing to classify there yet. */
  hasPatient: boolean;
  classification: UpcClassification;
  classificationLabel: string;
  /** Why the daily evaluation is still pending, if it is. */
  pendingReason: string | null;
  /** Neo1/Neo2 never accept UCI criteria (protocol §3). */
  uciAllowed: boolean;
}

export const buildUpcClassificationRows = (
  beds: Record<string, UpcWindowSubject> | null | undefined,
  date: string
): UpcClassificationRow[] =>
  UPC_CLASSIFIABLE_BED_IDS.flatMap(bedId => {
    const subject = beds?.[bedId];
    const patientName = subject?.patientName?.trim() ?? '';
    // La ventana trabaja solo con camas ocupadas: no hay nada que clasificar en una cama vacía.
    if (!patientName) return [];

    const baseName = BED_NAMES.get(bedId) ?? bedId;
    const rows: UpcClassificationRow[] = [
      buildRow({ bedId, key: bedId, bedName: baseName, isCrib: false, subject, date }),
    ];
    const cribName = subject?.clinicalCrib?.patientName?.trim() ?? '';
    if (cribName) {
      // La cuna clínica tiene su propia evaluación UPC y también bloquea el envío del censo.
      rows.push(
        buildRow({
          bedId,
          key: `${bedId}:crib`,
          bedName: `${baseName} · cuna clínica`,
          isCrib: true,
          subject: { ...subject?.clinicalCrib, patientName: cribName },
          date,
        })
      );
    }
    return rows;
  });

const buildRow = ({
  bedId,
  key,
  bedName,
  isCrib,
  subject,
  date,
}: {
  bedId: string;
  key: string;
  bedName: string;
  isCrib: boolean;
  subject: UpcWindowSubject | undefined;
  date: string;
}): UpcClassificationRow => {
  const classification = resolveEffectiveUpcState({
    bedId,
    isUPC: subject?.isUPC,
    checklist: subject?.upcChecklist,
  }).classification;

  return {
    key,
    bedId,
    isCrib,
    bedName,
    patientName: subject?.patientName?.trim() ?? '',
    rut: subject?.rut?.trim() ?? '',
    episodeIdentity: resolveUpcEpisodeIdentity(subject)!,
    hasPatient: true,
    classification,
    classificationLabel: resolveUpcClassificationLabel(classification),
    pendingReason: resolveUpcReviewReason(subject?.upcChecklist, bedId, date),
    uciAllowed: isUciEligibleBedId(bedId),
  };
};

export const sanitizeUpcCriteriaDraft = (
  row: Pick<UpcClassificationRow, 'uciAllowed'>,
  criteria: { uci?: readonly string[]; uti?: readonly string[] }
): { uci: string[]; uti: string[] } => {
  const uci = row.uciAllowed
    ? sanitizeCriterionIds(criteria.uci, isValidUciCriterionId).map(normalizeUciCriterionId)
    : [];
  return {
    uci: [...new Set(uci)],
    uti: [...new Set(sanitizeCriterionIds(criteria.uti, isValidUtiCriterionId))],
  };
};

export interface UpcRowDraft {
  row: UpcClassificationRow;
  previousChecklist?: UpcChecklistRecord;
  uci: string[];
  uti: string[];
  noCriteria: boolean;
}

export const createUpcRowDraft = (
  row: UpcClassificationRow,
  previousChecklist?: UpcChecklistRecord
): UpcRowDraft => ({
  row,
  previousChecklist,
  ...sanitizeUpcCriteriaDraft(row, {
    uci: previousChecklist?.uciCriteria,
    uti: previousChecklist?.utiCriteria,
  }),
  noCriteria: false,
});

export const hasUpcDraftChanges = (draft: UpcRowDraft): boolean => {
  if (draft.noCriteria) return true;
  const initial = createUpcRowDraft(draft.row, draft.previousChecklist);
  const sameIds = (a: string[], b: string[]) =>
    a.length === b.length && a.every(id => b.includes(id));
  return !sameIds(draft.uci, initial.uci) || !sameIds(draft.uti, initial.uti);
};

export const buildUpcRoundEvaluation = (
  draft: UpcRowDraft,
  actor: UpcChecklistAuditActor,
  date: string,
  evaluatedAt: string
): UpcRoundEvaluation => {
  const { uci, uti } = sanitizeUpcCriteriaDraft(draft.row, draft);
  return {
    bedId: draft.row.bedId,
    isCrib: draft.row.isCrib,
    previousChecklist: draft.previousChecklist,
    episodeIdentity: draft.row.episodeIdentity,
    record: buildUpcCriteriaEvaluation({
      checklist: draft.previousChecklist,
      actor,
      date,
      bedId: draft.row.bedId,
      evaluatedAt,
      evaluationId: crypto.randomUUID(),
      uciCriteria: draft.noCriteria ? [] : uci,
      utiCriteria: draft.noCriteria ? [] : uti,
    }),
  };
};

export const upcDraftStillMatches = (
  draft: UpcRowDraft,
  subject: UpcWindowSubject | undefined,
  submitted?: UpcRoundEvaluation
): boolean =>
  resolveUpcEpisodeIdentity(subject) === draft.row.episodeIdentity &&
  (arePatchValuesDeepEqual(subject?.upcChecklist, draft.previousChecklist) ||
    Boolean(submitted && arePatchValuesDeepEqual(subject?.upcChecklist, submitted.record)));

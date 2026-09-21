import { BEDS } from '@/constants/beds';
import {
  resolveUpcClassificationLabel,
  type UpcClassification,
} from '@/domain/upc/upcClassification';
import {
  isUciEligibleBedId,
  isUpcEligibleBedId,
  resolveEffectiveUpcState,
} from '@/shared/census/upcBedPolicy';
import { resolveUpcReviewReason } from '@/shared/census/upcEvaluationPolicy';
import {
  buildUpcCriteriaEvaluation,
  buildUpcNoCriteriaEvaluation,
} from '@/domain/upc/upcNoCriteriaEvaluation';
import type { UpcChecklistAuditActor, UpcChecklistRecord } from '@/domain/upc/upcContracts';
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
    episodeIdentity: resolveUpcEpisodeIdentity(subject, bedId) ?? bedId,
    hasPatient: true,
    classification,
    classificationLabel: resolveUpcClassificationLabel(classification),
    pendingReason: resolveUpcReviewReason(subject?.upcChecklist, bedId, date),
    uciAllowed: isUciEligibleBedId(bedId),
  };
};

/** Identidad clínica preferida para impedir que un borrador cambie de paciente. */
export const resolveUpcEpisodeIdentity = (
  subject: UpcWindowSubject | null | undefined,
  bedId: string
): string | null => {
  if (!subject?.patientName?.trim()) return null;
  return subject.clinicalEpisodeId?.trim() || subject.rut?.trim() || bedId;
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

export interface UpcQuickEvaluationAvailability {
  /** True when the evaluator may be recorded with the current shift data. */
  allowed: boolean;
  /** Short reason shown next to a disabled quick action. */
  reason: string | null;
}

export const resolveUpcQuickEvaluationAvailability = ({
  hasPatient,
  readOnly,
  hasActor,
  nurseName,
  assignedNurses,
}: {
  hasPatient: boolean;
  readOnly: boolean;
  hasActor: boolean;
  nurseName: string;
  assignedNurses: readonly string[];
}): UpcQuickEvaluationAvailability => {
  if (readOnly) return { allowed: false, reason: 'Sin permisos de edición clínica.' };
  if (!hasActor) return { allowed: false, reason: 'Inicia sesión para registrar la evaluación.' };
  if (!hasPatient) return { allowed: false, reason: 'Cama sin paciente.' };
  const trimmed = nurseName.trim();
  if (!trimmed) {
    return {
      allowed: false,
      reason: assignedNurses.length
        ? 'Elige el enfermero/a responsable para marcar.'
        : 'Escribe el nombre del enfermero/a responsable para marcar.',
    };
  }
  if (assignedNurses.length && !assignedNurses.includes(trimmed)) {
    return { allowed: false, reason: 'El responsable debe ser uno de los asignados al turno.' };
  }
  return { allowed: true, reason: null };
};

/** Summary shown in the window header: how many beds still need today's evaluation. */
export const countPendingUpcClassifications = (rows: readonly UpcClassificationRow[]): number =>
  rows.filter(row => row.hasPatient && row.pendingReason !== null).length;

export const isClassifiableUpcBedId = (bedId?: string | null): boolean => isUpcEligibleBedId(bedId);

export interface UpcDraftRecordsInput {
  rows: readonly UpcClassificationRow[];
  checklistOf: (row: UpcClassificationRow) => UpcChecklistRecord | undefined;
  criteriaOf: (row: UpcClassificationRow) => { uci: string[]; uti: string[] };
  noCriteriaSelection: Record<string, boolean>;
  actor: UpcChecklistAuditActor;
  date: string;
  nurseName: string;
  nurseFromShift: boolean;
  episodeIdentityOf: (row: UpcClassificationRow) => string;
  evaluationIdFactory?: () => string;
  now?: () => string;
}

export interface PendingUpcDraftRecord {
  record: UpcChecklistRecord;
  episodeIdentity: string;
}

/** Registros a firmar para las camas con cambios; el mismo borrador reintenta la misma evaluación. */
export const buildUpcDraftRecords = ({
  rows,
  checklistOf,
  criteriaOf,
  noCriteriaSelection,
  actor,
  date,
  nurseName,
  nurseFromShift,
  episodeIdentityOf,
  evaluationIdFactory = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
}: UpcDraftRecordsInput): Record<string, PendingUpcDraftRecord> => {
  const evaluatedAt = now();
  return Object.fromEntries(
    rows.map(row => {
      const shared = {
        checklist: checklistOf(row),
        actor,
        date,
        bedId: row.bedId,
        nurseName,
        nurseFromShift,
        evaluationId: evaluationIdFactory(),
        evaluatedAt,
      };
      const draft = sanitizeUpcCriteriaDraft(row, criteriaOf(row));
      return [
        row.key,
        {
          episodeIdentity: episodeIdentityOf(row),
          record: noCriteriaSelection[row.key]
            ? buildUpcNoCriteriaEvaluation(shared)
            : buildUpcCriteriaEvaluation({
                ...shared,
                uciCriteria: draft.uci,
                utiCriteria: draft.uti,
              }),
        },
      ];
    })
  );
};

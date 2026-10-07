import type { CudyrHistoryObservation, CudyrSourceEvaluation } from '@/types/domain/cudyrHistory';
import type { CudyrReportEvaluation } from '@/types/domain/cudyrReport';
import type { PatientData } from '@/types/domain/patient';
import {
  importedCudyrBelongsToCensus,
  isAdministrativeCudyrAdjustment,
} from '@/domain/evaluationScales/importedCudyr';
import { EMPTY_CUDYR_SCORE, getCategorization } from './CudyrScoreUtils';
import { CUDYR_REPORT_ITEM_LABELS } from './cudyrReportItemLabels';

const clinicalSignature = (value: CudyrSourceEvaluation) =>
  JSON.stringify({
    category: value.category,
    recordedAt: value.recordedAt,
    dependencyScore: value.dependencyScore ?? null,
    riskScore: value.riskScore ?? null,
    items: (value.items || []).map(item => [item.fieldId, item.value]).sort(),
  });
const fromObservation = (item: CudyrHistoryObservation): CudyrReportEvaluation => ({
  category: item.evaluation.category,
  source: 'Eloísa · Gestión de Camas',
  recordedAt: item.evaluation.recordedAt,
  sourceEvaluationId: item.evaluation.sourceEvaluationId,
  author: item.evaluation.author || '',
  authorId: item.evaluation.authorId || '',
  authorRole: item.evaluation.authorRole || '',
  dependencyScore: item.evaluation.dependencyScore,
  riskScore: item.evaluation.riskScore,
  observationId: item.id,
  items: item.evaluation.items,
  metadataWarning:
    !item.evaluation.author || !item.evaluation.authorId
      ? 'Autor de origen incompleto.'
      : undefined,
});

const commonReferenceAt = (values: string[]): string | undefined => {
  const instants = values.map(value => Date.parse(value));
  return instants.length && instants.every(Number.isFinite) && new Set(instants).size === 1
    ? new Date(instants[0]).toISOString()
    : undefined;
};

/** Observations are versions, not independent daily applications. Opaque version tokens never order them. */
export const selectCudyrReportEvaluation = (
  date: string,
  episode: string,
  patients: Pick<Partial<PatientData>, 'evaluationScores' | 'cudyr'>[],
  observations: CudyrHistoryObservation[]
): {
  evaluation: CudyrReportEvaluation | null;
  count: number;
  conflict: boolean;
  warnings: string[];
  referenceAt?: string;
} => {
  const warnings: string[] = [];
  const snapshots = patients
    .map(patient => patient.evaluationScores?.cudyr)
    .filter(item => item && importedCudyrBelongsToCensus(item, date));
  const adjustments = snapshots.filter(isAdministrativeCudyrAdjustment);
  const fromSnapshot = (item: NonNullable<(typeof snapshots)[number]>): CudyrReportEvaluation => ({
    category: item.category,
    source: item.source,
    recordedAt: item.recordedAt || '',
    sourceEvaluationId: '',
    author: item.author || '',
    authorId: '',
    authorRole: item.authorRole || '',
    dependencyScore: item.dependencyScore,
    riskScore: item.riskScore,
    items: item.items,
    metadataWarning: 'Instantánea diaria; no tiene identificador de observación archivada.',
  });
  const events = new Map<string, CudyrHistoryObservation[]>();
  observations
    .filter(
      item =>
        Boolean(episode) &&
        item.censusDate === date &&
        item.evaluation.clinicalEpisodeId === episode
    )
    .forEach(item => events.set(item.eventKey, [...(events.get(item.eventKey) || []), item]));
  if (adjustments.length) {
    const signatures = new Set(adjustments.map(item => JSON.stringify(item)));
    const selected = adjustments[0]!;
    return {
      evaluation:
        signatures.size === 1 && /^[A-D][1-3]$/.test(selected.category)
          ? fromSnapshot(selected)
          : null,
      count: events.size || (selected.category ? 1 : 0),
      conflict: signatures.size > 1,
      warnings: ['Ajuste administrativo HHR aplicado.'],
    };
  }
  const candidates: CudyrHistoryObservation[] = [];
  let conflict = false;
  const eventReferences: Array<string | undefined> = [];
  for (const versions of events.values()) {
    if (versions.some(item => item.evaluation.isDeleted)) {
      warnings.push('Existe una aplicación anulada en la fuente; sus versiones se conservan.');
      continue;
    }
    eventReferences.push(commonReferenceAt(versions.map(item => item.evaluation.recordedAt)));
    if (new Set(versions.map(item => clinicalSignature(item.evaluation))).size !== 1) {
      conflict = true;
      warnings.push('Versiones clínicas contradictorias de una aplicación; requieren revisión.');
      continue;
    }
    if (
      ['authorId', 'author', 'authorRoleId', 'authorRole'].some(
        field =>
          new Set(
            versions
              .map(
                item =>
                  item.evaluation[field as 'authorId' | 'author' | 'authorRoleId' | 'authorRole']
              )
              .filter(Boolean)
          ).size > 1
      )
    ) {
      conflict = true;
      warnings.push('Autorías contradictorias del mismo evento en la fuente.');
      continue;
    }
    const richer = [...versions].sort(
      (a, b) =>
        Object.values(b.evaluation).filter(Boolean).length -
        Object.values(a.evaluation).filter(Boolean).length
    )[0];
    candidates.push(richer);
  }
  candidates.sort(
    (a, b) => Date.parse(b.evaluation.recordedAt) - Date.parse(a.evaluation.recordedAt)
  );
  const latestAt = candidates[0] ? Date.parse(candidates[0].evaluation.recordedAt) : NaN;
  const unorderable = candidates.some(
    item => !Number.isFinite(Date.parse(item.evaluation.recordedAt))
  );
  const tied = candidates.filter(item => Date.parse(item.evaluation.recordedAt) === latestAt);
  if (unorderable || tied.length > 1) {
    conflict = true;
    warnings.push(
      'Aplicaciones con hora no verificable o varias autorías posibles a la misma hora.'
    );
  }
  if (events.size)
    return {
      evaluation: !conflict && candidates[0] ? fromObservation(candidates[0]) : null,
      count: events.size,
      referenceAt:
        eventReferences.length && eventReferences.every((value): value is string => Boolean(value))
          ? new Date(Math.max(...eventReferences.map(value => Date.parse(value)))).toISOString()
          : undefined,
      conflict,
      warnings,
    };
  const valid = snapshots.filter(item => item && /^[A-D][1-3]$/.test(item.category));
  const snapshotSignatures = new Set(valid.map(item => JSON.stringify(item)));
  if (valid.length)
    return {
      evaluation: snapshotSignatures.size === 1 ? fromSnapshot(valid[0]!) : null,
      count: valid.length ? 1 : 0,
      referenceAt: commonReferenceAt(valid.map(item => item?.recordedAt || '')),
      conflict: snapshotSignatures.size > 1,
      warnings: ['Resultado de instantánea diaria anterior al archivo permanente.'],
    };
  const scores = patients
    .map(patient => patient.cudyr)
    .filter(
      score =>
        score &&
        Object.keys(EMPTY_CUDYR_SCORE).every(
          key =>
            Number.isInteger(score[key as keyof typeof score]) &&
            score[key as keyof typeof score] >= 0 &&
            score[key as keyof typeof score] <= 3
        ) &&
        getCategorization(score).isCategorized
    );
  const categories = scores
    .map(score => getCategorization(score))
    .filter(item => item.isCategorized);
  if (
    new Set(
      scores.map(score =>
        JSON.stringify(
          Object.keys(EMPTY_CUDYR_SCORE).map(
            key => score![key as keyof typeof CUDYR_REPORT_ITEM_LABELS]
          )
        )
      )
    ).size > 1
  )
    return {
      evaluation: null,
      count: 0,
      conflict: true,
      warnings: ['Puntajes HHR contradictorios en el día.'],
    };
  const legacy = categories[0];
  return {
    evaluation: legacy
      ? {
          category: legacy.finalCat,
          source: 'HHR · puntuación manual',
          recordedAt: '',
          sourceEvaluationId: '',
          author: '',
          authorId: '',
          authorRole: '',
          dependencyScore: legacy.depScore,
          riskScore: legacy.riskScore,
          items: scores[0]
            ? Object.entries(CUDYR_REPORT_ITEM_LABELS).map(([fieldId, label]) => ({
                fieldId,
                label,
                value: String(scores[0]![fieldId as keyof typeof CUDYR_REPORT_ITEM_LABELS]),
              }))
            : [],
          metadataWarning:
            'El guardado del censo no acredita autor ni hora de esta evaluación individual.',
        }
      : null,
    count: legacy ? 1 : 0,
    conflict: false,
    warnings,
  };
};

import {
  CUDYR_IMPORT_SOURCE,
  CUDYR_FALLBACK_SOURCE,
} from '@/domain/evaluationScales/importedCudyr';
import { buildCudyrBedHistory } from '@/domain/cudyr/cudyrBedHistory';
import { resolveCudyrHospitalAdmission } from '@/domain/cudyr/cudyrHospitalAdmission';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { CUDYR_EXCLUSION_LABELS } from '@/types/domain/cudyrExclusion';
import type { DailyRecordCudyrExportState } from '@/services/contracts/dailyRecordServiceContracts';
import type {
  CudyrReportDataset,
  CudyrReportRow,
  CudyrReportTotals,
} from '@/types/domain/cudyrReport';
import {
  cudyrReferenceInstant,
  resolveCudyrDailyPlacement,
} from '@/domain/cudyr/cudyrDailyPlacement';
import {
  collectCudyrDailyFacts,
  collectCudyrArchiveFacts,
  cudyrFactEpicrisis,
  type CudyrReportFact,
} from './cudyrReportFacts';
import { selectCudyrReportEvaluation } from './cudyrReportEvaluations';
import { cudyrCaptureState, reconcileCudyrDischarge } from './cudyrReportReconciliation';

export interface CudyrReportInput extends Omit<CudyrReportDataset, 'schemaVersion' | 'rows'> {
  sourcePolicy?: 'eloisa_only';
  records: DailyRecordCudyrExportState[];
  pending: Array<{ clinicalEpisodeId: string; dates: string[] }>;
}
export const buildCudyrReport = (input: CudyrReportInput): CudyrReportDataset => {
  const facts = input.records.flatMap(collectCudyrDailyFacts);
  const known = new Set(facts.map(fact => fact.key));
  const archived = collectCudyrArchiveFacts(input.observations, input.captures);
  facts.push(...archived.filter(fact => !known.has(fact.key)));
  const groups = new Map<string, CudyrReportFact[]>();
  facts
    .filter(fact => fact.date >= input.from && fact.date <= input.to)
    .forEach(fact => groups.set(fact.key, [...(groups.get(fact.key) || []), fact]));
  const placements = input.captures.flatMap(receipt =>
    (receipt.capture.sourcePlacements || []).map(placement => ({
      placement,
      observedAt: receipt.capture.observedAt,
      censusDate: receipt.censusDate,
      captureId: receipt.id,
    }))
  );
  const cutoffs = new Map(
    [...new Set(facts.map(fact => fact.date))].map(date => [date, cudyrReferenceInstant(date)])
  );
  const rows = [...groups.entries()]
    .map(([key, entries]): CudyrReportRow => {
      // Prefer the daily census identity. Conflicting snapshots remain visible as a review warning.
      const daily = entries.filter(item => item.contextIsDaily);
      const contexts = daily.length ? daily : entries;
      const first =
        contexts.find(
          item => item.placement.section === 'census' || item.placement.section === 'crib'
        ) || contexts[0];
      const p = first.patient;
      const episode = p.clinicalEpisodeId || '';
      const record = input.records.find(item => item.date === first.date);
      const selected = selectCudyrReportEvaluation(
        first.date,
        episode,
        contexts.map(item =>
          input.sourcePolicy === 'eloisa_only'
            ? {
                ...item.patient,
                cudyr: undefined,
                evaluationScores: [CUDYR_IMPORT_SOURCE, CUDYR_FALLBACK_SOURCE].includes(
                  item.patient.evaluationScores?.cudyr?.source || ''
                )
                  ? item.patient.evaluationScores
                  : undefined,
              }
            : item.patient
        ),
        input.observations
      );
      const observation = input.observations.find(
        item => item.id === selected.evaluation?.observationId
      );
      const relatedIds = new Set(
        input.observations
          .filter(
            item => item.censusDate === first.date && item.evaluation.clinicalEpisodeId === episode
          )
          .map(item => item.id)
      );
      const capture = cudyrCaptureState(
        input.captures.filter(
          item =>
            Boolean(episode) &&
            item.capture.clinicalEpisodeId === episode &&
            (item.censusDate === first.date || item.observationIds.some(id => relatedIds.has(id)))
        )
      );
      const latest = capture.latest;
      const captureInconclusive = ['captura_incompleta', 'fuente_no_disponible'].includes(
        capture.status
      );
      // An archived source result proves its own existence even if another capture part failed.
      // Legacy local scores do not provide that evidence of an Eloísa result.
      const sourceResultAvailable = Boolean(
        observation ||
        (selected.evaluation &&
          [CUDYR_IMPORT_SOURCE, CUDYR_FALLBACK_SOURCE].includes(selected.evaluation.source))
      );
      if (sourceResultAvailable && captureInconclusive)
        capture.warnings.push(
          'Resultado de Eloísa disponible; la última consulta no pudo completarse.'
        );
      const patientIdentityConflict =
        new Set(contexts.map(item => item.patient.rut).filter(Boolean)).size > 1;
      const identityConflict =
        patientIdentityConflict ||
        new Set(contexts.map(item => item.patient.admissionDate).filter(Boolean)).size > 1 ||
        new Set(contexts.map(item => item.patient.admissionTime).filter(Boolean)).size > 1;
      const placement = resolveCudyrDailyPlacement({
        date: first.date,
        patientName: p.patientName,
        admissionDate: p.admissionDate,
        admissionTime: p.admissionTime,
        useCensusAdmission: first.contextIsDaily && !identityConflict,
        isBlocked: contexts.some(item => item.patient.isBlocked),
        clinicalEpisodeId: episode,
        sourcePlacements: episode ? placements : [],
        placements: daily.map(item => item.placement),
        evaluationAt:
          selected.referenceAt ||
          selected.evaluation?.recordedAt ||
          cutoffs.get(first.date) ||
          undefined,
      });
      const hospitalAdmission = resolveCudyrHospitalAdmission(
        episode,
        placements,
        placement.hospitalStayAdmissionAt &&
          Date.parse(placement.hospitalStayAdmissionAt) > Date.parse(placement.referenceAt || '')
          ? placement.hospitalStayAdmissionAt
          : placement.referenceAt || '',
        false,
        first.contextIsDaily &&
          !identityConflict &&
          ['hospitalizacion', 'cuna'].includes(placement.modality)
          ? { date: p.admissionDate || '', time: p.admissionTime || '' }
          : undefined
      );
      const pending = input.pending.some(
        item =>
          Boolean(episode) && item.clinicalEpisodeId === episode && item.dates.includes(first.date)
      );
      const warnings = [...selected.warnings, ...capture.warnings];
      if (!episode)
        warnings.push(
          'Registro legado sin identificador de episodio; no se cruza por nombre ni RUT.'
        );
      if (identityConflict)
        warnings.push('Identidad o ingreso contradictorio para el mismo episodio y día.');
      if (!first.contextIsDaily)
        warnings.push('Identidad y diagnóstico proceden de una captura de otro día.');
      if (selected.evaluation?.metadataWarning) warnings.push(selected.evaluation.metadataWarning);
      const movementFacts = [...facts, ...archived].filter(item =>
        episode ? item.patient.clinicalEpisodeId === episode : item.key === key
      );
      const movements = [
        ...new Map(
          movementFacts
            .filter(item => item.movement)
            .map(item => [JSON.stringify(item.movement), item.movement!])
        ).values(),
      ];
      const verified = cudyrFactEpicrisis(p);
      const conflict = selected.conflict || patientIdentityConflict;
      const row: CudyrReportRow = {
        key,
        date: first.date,
        applicationPending:
          resolveCudyrPendingStatus(first.date, new Date(input.generatedAt)).phase !== 'overdue',
        clinicalEpisodeId: episode,
        authorityDate: first.authorityDate,
        patientName: p.patientName || '',
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        secondLastName: p.secondLastName || '',
        rut: p.rut || '',
        documentType: p.documentType || '',
        diagnosis: p.pathology || '',
        diagnosisCode: p.cie10Code || '',
        identitySource: first.identitySource,
        identitySourceDate: first.identitySourceDate,
        admissionEvidenceConflict: identityConflict,
        admissionDate: p.admissionDate || '',
        admissionTime: p.admissionTime || '',
        hospitalAdmissionAt: hospitalAdmission.at,
        hospitalStayAdmissionAt: placement.hospitalStayAdmissionAt,
        hospitalAdmissionSource: hospitalAdmission.source,
        evaluationCapturedAt: observation?.firstCapturedAt || '',
        bedId: [...new Set(placement.contexts.map(item => item.bedId))].join(' / '),
        bedName: [...new Set(placement.contexts.map(item => item.bedName || item.bedId))].join(
          ' / '
        ),
        service: [...new Set(placement.contexts.map(item => item.location).filter(Boolean))].join(
          ' / '
        ),
        specialty: p.specialty || '',
        group: placement.group,
        modality: placement.modality,
        eligibility: identityConflict ? 'por_revisar' : placement.eligibility,
        eligibilityReason: identityConflict
          ? 'Datos contradictorios requieren revisión.'
          : placement.reason,
        contextSource: placement.contextSource,
        referenceAt: placement.referenceAt || '',
        cudyrStatus: conflict
          ? 'por_revisar'
          : pending
            ? 'guardado_pendiente'
            : captureInconclusive && !sourceResultAvailable
              ? capture.status
              : selected.evaluation
                ? 'registrado'
                : capture.status,
        evaluation: selected.evaluation,
        evaluationCount: selected.count,
        lastCaptureAt: latest?.capture.observedAt || '',
        lastPersistedAt: latest?.receivedAt || observation?.firstCapturedAt || '',
        captureActor: latest?.receivedBy || observation?.firstCapturedBy || '',
        captureId: latest?.capture.id || '',
        sourceRunId: latest?.capture.sourceRunId || '',
        dailyCudyrSavedAt: record?.cudyrUpdatedAt || '',
        dailyCudyrSavedBy: record?.cudyrUpdatedBy || '',
        medicalEpicrisisStatus:
          verified?.medicalEpicrisis || first.archivedEpicrisis?.medicalEpicrisisStatus || '',
        nursingEpicrisisStatus:
          verified?.nursingEpicrisis || first.archivedEpicrisis?.nursingEpicrisisStatus || '',
        epicrisisRegisteredAt:
          verified?.registeredAt || first.archivedEpicrisis?.epicrisisRegisteredAt || '',
        movements,
        bedHistory: buildCudyrBedHistory(episode, placements),
        correction: input.corrections.find(
          item => Boolean(episode) && item.clinicalEpisodeId === episode
        ),
        warnings,
      };
      const reconciled = reconcileCudyrDischarge(row);
      const exclusion = input.exclusions?.find(
        item => item.date === row.date && Boolean(episode) && item.clinicalEpisodeId === episode
      );
      return {
        ...reconciled,
        exclusion,
        ...(exclusion?.reason
          ? {
              eligibility: 'no_elegible' as const,
              eligibilityReason: CUDYR_EXCLUSION_LABELS[exclusion.reason] + ': ' + exclusion.note,
            }
          : {}),
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.bedId.localeCompare(b.bedId) || a.key.localeCompare(b.key)
    );
  const { records: _records, pending: _pending, sourcePolicy: _sourcePolicy, ...data } = input;
  const unlinkedArchive =
    input.observations.some(
      item =>
        !item.evaluation.clinicalEpisodeId ||
        item.captureContexts.some(
          context => context.clinicalEpisodeId !== item.evaluation.clinicalEpisodeId
        )
    ) ||
    input.captures.some(
      item =>
        !item.capture.clinicalEpisodeId ||
        item.captureContexts.some(
          context => context.clinicalEpisodeId !== item.capture.clinicalEpisodeId
        )
    );
  return {
    ...data,
    schemaVersion: 1,
    rows,
    issues: unlinkedArchive
      ? [
          ...data.issues,
          'Archivo con episodio ausente o contradictorio: se conserva en versiones/capturas, sin crear pacientes-día desde ese contexto.',
        ]
      : data.issues,
  };
};

/** Closed-day statistics by default; daily progress may explicitly include an open application window. */
export const cudyrReportTotals = (
  rows: CudyrReportRow[],
  options: { includePendingApplication?: boolean } = {}
): CudyrReportTotals => {
  const totals: CudyrReportTotals = {
    rows: rows.length,
    eligible: 0,
    categorized: 0,
    withoutConfirmedResult: 0,
    excluded: 0,
    review: 0,
    categories: Object.fromEntries(
      ['A', 'B', 'C', 'D'].flatMap(risk =>
        [1, 2, 3].map(dep => [risk + dep, { media: 0, intermedia: 0 }])
      )
    ),
  };
  for (const row of rows) {
    if (row.applicationPending && !options.includePendingApplication) continue;
    if (row.eligibility === 'no_elegible') {
      totals.excluded++;
      continue;
    }
    if (row.eligibility === 'por_revisar') {
      totals.review++;
      continue;
    }
    totals.eligible++;
    if (row.cudyrStatus === 'registrado' && row.evaluation && row.group !== 'sin_grupo') {
      const category = totals.categories[row.evaluation.category];
      if (category) {
        totals.categorized++;
        category[row.group]++;
        continue;
      }
    }
    totals.withoutConfirmedResult++;
  }
  return totals;
};

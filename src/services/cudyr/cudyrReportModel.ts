import {
  CUDYR_ADMIN_ADJUSTMENT_SOURCE,
  CUDYR_IMPORT_SOURCE,
  CUDYR_FALLBACK_SOURCE,
} from '@/domain/evaluationScales/importedCudyr';
import { buildCudyrBedHistory } from '@/domain/cudyr/cudyrBedHistory';
import { resolveCudyrHospitalAdmission } from '@/domain/cudyr/cudyrHospitalAdmission';
import type { ObservedCudyrPlacement } from '@/domain/cudyr/cudyrPlacementTimeline';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { CUDYR_EXCLUSION_LABELS } from '@/types/domain/cudyrExclusion';
import type { DailyRecordCudyrExportState } from '@/types/domain/dailyRecordSlices';
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
  cudyrEpisodelessDischargeId,
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
type ReportPatient = CudyrReportFact['patient'];
type SelectedEvaluation = ReturnType<typeof selectCudyrReportEvaluation>;
type CaptureState = ReturnType<typeof cudyrCaptureState>;
type CudyrObservation = CudyrReportInput['observations'][number];
type CudyrPlacementResult = ReturnType<typeof resolveCudyrDailyPlacement>;

/** What every row of one report reads: input, all facts, and placements per episode. */
interface CudyrRowSources {
  input: CudyrReportInput;
  facts: CudyrReportFact[];
  archived: CudyrReportFact[];
  placementsByEpisode: Map<string, ObservedCudyrPlacement[]>;
  cutoffs: Map<string, string | null>;
}

/** CUD-01: under `eloisa_only`, only Eloísa imports and justified administrative adjustments count. */
const hasOfficialCudyrScore = (scores: ReportPatient['evaluationScores']) =>
  [CUDYR_IMPORT_SOURCE, CUDYR_FALLBACK_SOURCE].includes(scores?.cudyr?.source || '') ||
  (scores?.cudyr?.source === CUDYR_ADMIN_ADJUSTMENT_SOURCE &&
    Boolean(scores.cudyr.adjustmentReason?.trim()) &&
    Boolean(scores.cudyr.adjustmentEvidence?.trim()));

const officialSourcePatient = (
  patient: ReportPatient,
  sourcePolicy: CudyrReportInput['sourcePolicy']
) =>
  sourcePolicy === 'eloisa_only'
    ? {
        ...patient,
        cudyr: undefined,
        evaluationScores: hasOfficialCudyrScore(patient.evaluationScores)
          ? patient.evaluationScores
          : undefined,
      }
    : patient;

/** Prefer the daily census identity, and in it a census or crib placement. */
const primaryContext = (entries: CudyrReportFact[]) => {
  const daily = entries.filter(item => item.contextIsDaily);
  const contexts = daily.length ? daily : entries;
  const first =
    contexts.find(
      item => item.placement.section === 'census' || item.placement.section === 'crib'
    ) || contexts[0];
  return { daily, contexts, first };
};

/**
 * CUD-07: the extension captures for this episode/day. An archived source result proves its own
 * existence even if another capture part failed; legacy local scores do not provide that evidence.
 */
const rowCaptureState = (
  input: CudyrReportInput,
  date: string,
  episode: string,
  selected: SelectedEvaluation,
  observation: CudyrObservation | undefined
) => {
  const relatedIds = new Set(
    input.observations
      .filter(item => item.censusDate === date && item.evaluation.clinicalEpisodeId === episode)
      .map(item => item.id)
  );
  const capture = cudyrCaptureState(
    input.captures.filter(
      item =>
        Boolean(episode) &&
        item.capture.clinicalEpisodeId === episode &&
        (item.censusDate === date || item.observationIds.some(id => relatedIds.has(id)))
    )
  );
  const captureInconclusive =
    ['captura_incompleta', 'fuente_no_disponible'].includes(capture.status) ||
    (capture.status === 'sin_captura' && Boolean(capture.latest));
  const sourceResultAvailable = Boolean(
    observation ||
    (selected.evaluation &&
      [CUDYR_IMPORT_SOURCE, CUDYR_FALLBACK_SOURCE, CUDYR_ADMIN_ADJUSTMENT_SOURCE].includes(
        selected.evaluation.source
      ))
  );
  if (sourceResultAvailable && captureInconclusive)
    capture.warnings.push(
      'Resultado de Eloísa disponible; la última consulta no pudo completarse.'
    );
  return { capture, captureInconclusive, sourceResultAvailable };
};

/** ID-02: one episode/day with different documents or admissions needs review. */
const contextConflicts = (contexts: CudyrReportFact[]) => {
  const distinct = (values: Array<string | undefined>) => new Set(values.filter(Boolean)).size > 1;
  const patientIdentityConflict = distinct(contexts.map(item => item.patient.rut));
  const identityConflict =
    patientIdentityConflict ||
    distinct(contexts.map(item => item.patient.admissionDate)) ||
    distinct(contexts.map(item => item.patient.admissionTime));
  return { patientIdentityConflict, identityConflict };
};

/** TIME-01: hospital admission from the observed stay, or the census admission when trusted. */
const rowHospitalAdmission = (
  episode: string,
  placements: ObservedCudyrPlacement[],
  placement: CudyrPlacementResult,
  trustCensusAdmission: boolean,
  p: ReportPatient
) =>
  resolveCudyrHospitalAdmission(
    episode,
    placements,
    placement.hospitalStayAdmissionAt &&
      Date.parse(placement.hospitalStayAdmissionAt) > Date.parse(placement.referenceAt || '')
      ? placement.hospitalStayAdmissionAt
      : placement.referenceAt || '',
    false,
    trustCensusAdmission && ['hospitalizacion', 'cuna'].includes(placement.modality)
      ? { date: p.admissionDate || '', time: p.admissionTime || '' }
      : undefined
  );

const rowWarnings = (
  selected: SelectedEvaluation,
  capture: CaptureState,
  episode: string,
  identityConflict: boolean,
  contextIsDaily: boolean
) => {
  const warnings = [...selected.warnings, ...capture.warnings];
  if (!episode)
    warnings.push('Registro legado sin identificador de episodio; no se cruza por nombre ni RUT.');
  if (identityConflict)
    warnings.push('Identidad o ingreso contradictorio para el mismo episodio y día.');
  if (!contextIsDaily)
    warnings.push('Identidad y diagnóstico proceden de una captura de otro día.');
  if (selected.evaluation?.metadataWarning) warnings.push(selected.evaluation.metadataWarning);
  return warnings;
};

/** ID-02: movements of this episode, or of this legacy row when it has no episode. */
const rowMovements = (sources: CudyrRowSources, episode: string, key: string) => {
  const movementFacts = [...sources.facts, ...sources.archived].filter(item =>
    episode ? item.patient.clinicalEpisodeId === episode : item.key === key
  );
  return [
    ...new Map(
      movementFacts
        .filter(item => item.movement)
        .map(item => [JSON.stringify(item.movement), item.movement!])
    ).values(),
  ];
};

/** CUD-07: a conflict or pending save comes first; an inconclusive query never reads as absent. */
const rowCudyrStatus = (
  conflict: boolean,
  pending: boolean,
  state: ReturnType<typeof rowCaptureState>,
  selected: SelectedEvaluation
): CudyrReportRow['cudyrStatus'] => {
  if (conflict) return 'por_revisar';
  if (pending) return 'guardado_pendiente';
  if (state.captureInconclusive && !state.sourceResultAvailable) return state.capture.status;
  return selected.evaluation ? 'registrado' : state.capture.status;
};

const patientFields = (p: ReportPatient) => ({
  patientName: p.patientName || '',
  firstName: p.firstName || '',
  lastName: p.lastName || '',
  secondLastName: p.secondLastName || '',
  rut: p.rut || '',
  documentType: p.documentType || '',
  diagnosis: p.pathology || '',
  diagnosisCode: p.cie10Code || '',
});

const captureFields = (
  latest: CaptureState['latest'],
  observation: CudyrObservation | undefined,
  record: DailyRecordCudyrExportState | undefined
) => ({
  lastCaptureAt: latest?.capture.observedAt || '',
  lastPersistedAt: latest?.receivedAt || observation?.firstCapturedAt || '',
  captureActor: latest?.receivedBy || observation?.firstCapturedBy || '',
  captureId: latest?.capture.id || '',
  sourceRunId: latest?.capture.sourceRunId || '',
  dailyCudyrSavedAt: record?.cudyrUpdatedAt || '',
  dailyCudyrSavedBy: record?.cudyrUpdatedBy || '',
});

/** Verified epicrisis of the census patient first, then the archived capture's. */
const epicrisisFields = (p: ReportPatient, first: CudyrReportFact) => {
  const verified = cudyrFactEpicrisis(p);
  return {
    medicalEpicrisisStatus:
      verified?.medicalEpicrisis || first.archivedEpicrisis?.medicalEpicrisisStatus || '',
    nursingEpicrisisStatus:
      verified?.nursingEpicrisis || first.archivedEpicrisis?.nursingEpicrisisStatus || '',
    epicrisisRegisteredAt:
      verified?.registeredAt || first.archivedEpicrisis?.epicrisisRegisteredAt || '',
  };
};

/** CUD-03: a justified manual exclusion changes eligibility only, never the CUDYR result. */
const withDailyExclusion = (
  input: CudyrReportInput,
  row: CudyrReportRow,
  episode: string
): CudyrReportRow => {
  const reconciled = reconcileCudyrDischarge(row);
  const dischargeId = cudyrEpisodelessDischargeId(row);
  const exclusion = input.exclusions?.find(
    item =>
      item.date === row.date &&
      (episode
        ? item.clinicalEpisodeId === episode
        : Boolean(dischargeId) && item.dischargeId === dischargeId)
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
};

/** One patient-day row from the facts of one episode/day key. */
const buildCudyrReportRow = (
  sources: CudyrRowSources,
  key: string,
  entries: CudyrReportFact[]
): CudyrReportRow => {
  const { input } = sources;
  // Prefer the daily census identity. Conflicting snapshots remain visible as a review warning.
  const { daily, contexts, first } = primaryContext(entries);
  const p = first.patient;
  const episode = p.clinicalEpisodeId || '';
  const placements = (episode && sources.placementsByEpisode.get(episode)) || [];
  const record = input.records.find(item => item.date === first.date);
  const selected = selectCudyrReportEvaluation(
    first.date,
    episode,
    contexts.map(item => officialSourcePatient(item.patient, input.sourcePolicy)),
    input.observations
  );
  const observation = input.observations.find(
    item => item.id === selected.evaluation?.observationId
  );
  const captureState = rowCaptureState(input, first.date, episode, selected, observation);
  const { capture } = captureState;
  const { patientIdentityConflict, identityConflict } = contextConflicts(contexts);
  const trustCensusAdmission = first.contextIsDaily && !identityConflict;
  const placement = resolveCudyrDailyPlacement({
    date: first.date,
    patientName: p.patientName,
    admissionDate: p.admissionDate,
    admissionTime: p.admissionTime,
    useCensusAdmission: trustCensusAdmission,
    isBlocked: contexts.some(item => item.patient.isBlocked),
    clinicalEpisodeId: episode,
    sourcePlacements: placements,
    placements: daily.map(item => item.placement),
    evaluationAt:
      selected.referenceAt ||
      selected.evaluation?.recordedAt ||
      sources.cutoffs.get(first.date) ||
      undefined,
  });
  const hospitalAdmission = rowHospitalAdmission(
    episode,
    placements,
    placement,
    trustCensusAdmission,
    p
  );
  const pending = input.pending.some(
    item =>
      Boolean(episode) && item.clinicalEpisodeId === episode && item.dates.includes(first.date)
  );
  const row: CudyrReportRow = {
    key,
    date: first.date,
    applicationPending:
      resolveCudyrPendingStatus(first.date, new Date(input.generatedAt)).phase !== 'overdue',
    clinicalEpisodeId: episode,
    authorityDate: first.authorityDate,
    ...patientFields(p),
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
    bedName: [...new Set(placement.contexts.map(item => item.bedName || item.bedId))].join(' / '),
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
    cudyrStatus: rowCudyrStatus(
      selected.conflict || patientIdentityConflict,
      pending,
      captureState,
      selected
    ),
    evaluation: selected.evaluation,
    evaluationCount: selected.count,
    ...captureFields(capture.latest, observation, record),
    ...epicrisisFields(p, first),
    movements: rowMovements(sources, episode, key),
    bedHistory: buildCudyrBedHistory(episode, placements),
    correction: input.corrections.find(
      item => Boolean(episode) && item.clinicalEpisodeId === episode
    ),
    warnings: rowWarnings(selected, capture, episode, identityConflict, first.contextIsDaily),
  };
  return withDailyExclusion(input, row, episode);
};

export const buildCudyrReport = (input: CudyrReportInput): CudyrReportDataset => {
  const facts = input.records.flatMap(collectCudyrDailyFacts);
  const known = new Set(facts.map(fact => fact.key));
  const archived = collectCudyrArchiveFacts(input.observations, input.captures);
  facts.push(...archived.filter(fact => !known.has(fact.key)));
  const groups = new Map<string, CudyrReportFact[]>();
  facts
    .filter(fact => fact.date >= input.from && fact.date <= input.to)
    .forEach(fact => groups.set(fact.key, [...(groups.get(fact.key) || []), fact]));
  // Every placement reader filters by its own episode first, so each row reads only that list.
  const placementsByEpisode = new Map<string, ObservedCudyrPlacement[]>();
  for (const receipt of input.captures)
    for (const placement of receipt.capture.sourcePlacements || []) {
      const own = placementsByEpisode.get(placement.clinicalEpisodeId) || [];
      own.push({
        placement,
        observedAt: receipt.capture.observedAt,
        censusDate: receipt.censusDate,
        captureId: receipt.id,
      });
      placementsByEpisode.set(placement.clinicalEpisodeId, own);
    }
  const cutoffs = new Map(
    [...new Set(facts.map(fact => fact.date))].map(date => [date, cudyrReferenceInstant(date)])
  );
  const sources: CudyrRowSources = { input, facts, archived, placementsByEpisode, cutoffs };
  const rows = [...groups.entries()]
    .map(([key, entries]) => buildCudyrReportRow(sources, key, entries))
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

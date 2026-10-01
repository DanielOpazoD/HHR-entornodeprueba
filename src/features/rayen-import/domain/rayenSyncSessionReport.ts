import type { RayenSyncEvent, RayenSyncPerformance } from '@/types/domain/rayenSync';

const STAGES = [
  'preflight',
  'dualCapture',
  'captureFichaMedico',
  'fichaContext',
  'fichaListsAndCatalog',
  'fichaPatientReads',
  'fichaDiagnosisCoding',
  'captureGestionCamas',
  'reconciliation',
  'historicalEvidence',
  'reviewWait',
  'structuralPersistence',
  'clinicalReads',
  'writeQueueWait',
  'persistence',
  'currentClinicalPersistence',
  'historicalCudyrPersistence',
] as const satisfies readonly (keyof RayenSyncPerformance['stagesMs'])[];
const COUNTERS = ['requests', 'cacheHits', 'patches', 'retries', 'timeouts'] as const;
const TRACE = ['callableAttempts', 'clientRetries', 'transactionRetries'] as const;

const validNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const summarizeSyncMeasurements = (values: number[]) => {
  const sorted = values.filter(validNumber).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return {
    samples: sorted.length,
    median:
      sorted.length % 2
        ? sorted[middle]
        : sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2,
    max: sorted.at(-1)!,
    // A handful of sessions is insufficient to present a tail percentile.
    p95: sorted.length >= 20 ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
  };
};

type Measurements = Record<string, number[]>;
const add = (measurements: Measurements, key: string, value: unknown) => {
  if (validNumber(value)) (measurements[key] ??= []).push(value);
};

const activity = (event: RayenSyncEvent): 'changed' | 'unchanged' | 'unknown' => {
  const incremental = event.coverage?.incremental;
  if (!validNumber(incremental?.newFacts) || !validNumber(incremental?.corrections))
    return 'unknown';
  return incremental.newFacts + incremental.corrections > 0 ? 'changed' : 'unchanged';
};

/** Deliberately projects a fixed allowlist; never serializes an event or its free text. */
export const buildRayenSyncSessionReport = (history: RayenSyncEvent[]) => {
  const seen = new Set<string>();
  const groups = new Map<
    string,
    { cohort: ReturnType<typeof cohortFor>; runs: number; values: Measurements }
  >();
  let duplicates = 0;
  let omitted = 0;
  // Prefer usable, most recently completed snapshots. Technical tie-breaks make
  // equal-time duplicates stable without comparing or exporting clinical fields.
  const ordered = history
    .map(event => {
      const duration = Date.parse(event.completedAt ?? '') - Date.parse(event.startedAt);
      const usable = Boolean(event.performance) && validNumber(duration);
      const numeric = (value: unknown) => (validNumber(value) ? value : null);
      const technicalKey = JSON.stringify([
        cohortFor(event),
        duration,
        STAGES.map(stage => numeric(event.performance?.stagesMs?.[stage])),
        COUNTERS.map(counter => numeric(event.performance?.counters?.[counter])),
        ['current', 'historical'].map(scope =>
          TRACE.map(counter =>
            numeric(
              event.performance?.persistenceTrace?.[scope as 'current' | 'historical']?.[counter]
            )
          )
        ),
        numeric(event.performance?.coordination?.clinicalRetries),
        numeric(event.coverage?.incremental?.batch?.clinicalTargets),
        numeric(event.coverage?.incremental?.batch?.checkpointOnlyTargets),
      ]);
      return { event, usable, completed: Date.parse(event.completedAt ?? '') || 0, technicalKey };
    })
    .sort(
      (a, b) =>
        Number(b.usable) - Number(a.usable) ||
        b.completed - a.completed ||
        a.technicalKey.localeCompare(b.technicalKey)
    );
  for (const { event } of ordered) {
    if (seen.has(event.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(event.id);
    const started = Date.parse(event.startedAt);
    const completed = event.completedAt ? Date.parse(event.completedAt) : NaN;
    const duration = completed - started;
    if (!event.performance || !validNumber(duration)) {
      omitted += 1;
      continue;
    }
    const cohort = cohortFor(event);
    const key = JSON.stringify(cohort);
    const group = groups.get(key) ?? { cohort, runs: 0, values: {} };
    groups.set(key, group);
    group.runs += 1;
    add(group.values, 'wallMs', duration);
    const review = event.performance.stagesMs?.reviewWait;
    if (validNumber(review) && review <= duration)
      add(group.values, 'wallWithoutReviewMs', duration - review);
    for (const stage of STAGES)
      add(group.values, `${stage}Ms`, event.performance.stagesMs?.[stage]);
    for (const counter of COUNTERS)
      add(group.values, counter, event.performance.counters?.[counter]);
    for (const scope of ['current', 'historical'] as const) {
      for (const counter of TRACE)
        add(
          group.values,
          `${scope}.${counter}`,
          event.performance.persistenceTrace?.[scope]?.[counter]
        );
    }
    add(group.values, 'clinicalRetries', event.performance.coordination?.clinicalRetries);
    add(group.values, 'clinicalTargets', event.coverage?.incremental?.batch?.clinicalTargets);
    add(
      group.values,
      'checkpointOnlyTargets',
      event.coverage?.incremental?.batch?.checkpointOnlyTargets
    );
  }
  return {
    format: 'hhr.sync-performance-summary.v1',
    scope: 'provided-history',
    duplicates,
    omitted,
    interpretation:
      'Milliseconds; stages overlap and persistence can sum several writes. Do not add stages or infer a critical path. Missing measurements are omitted, not zero. Wall without review requires explicit review timing. p95 requires 20 measured samples per metric.',
    groups: [...groups.values()]
      .sort((a, b) => JSON.stringify(a.cohort).localeCompare(JSON.stringify(b.cohort)))
      .map(group => ({
        cohort: group.cohort,
        runs: group.runs,
        measurements: Object.fromEntries(
          Object.entries(group.values).map(([key, values]) => [
            key,
            summarizeSyncMeasurements(values),
          ])
        ),
      })),
  };
};

const cohortFor = (event: RayenSyncEvent) => ({
  extensionVersion: /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(
    event.source?.extensionVersion ?? ''
  )
    ? event.source!.extensionVersion
    : 'unknown',
  status: ['applied', 'complete', 'partial', 'failed'].includes(event.status)
    ? event.status
    : 'unknown',
  batchMode: ['shadow', 'enforced'].includes(event.coverage?.incremental?.batch?.mode ?? '')
    ? event.coverage!.incremental!.batch!.mode
    : 'unknown',
  activity: activity(event),
  target: ['current', 'historical'].includes(event.performance?.coordination?.target ?? '')
    ? event.performance!.coordination!.target
    : 'unknown',
  clinicalRetry: validNumber(event.performance?.coordination?.clinicalRetries)
    ? event.performance!.coordination!.clinicalRetries > 0
      ? 'yes'
      : 'no'
    : 'unknown',
});

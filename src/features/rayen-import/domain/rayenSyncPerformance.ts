import type { RayenSyncPerformance, RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';

const EMPTY_COUNTERS: RayenSyncPerformance['counters'] = {
  requests: 0,
  cacheHits: 0,
  patches: 0,
  retries: 0,
  timeouts: 0,
};

const safeInteger = (value: number | undefined): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;

export const emptyRayenSyncPerformance = (): RayenSyncPerformance => ({
  stagesMs: {},
  counters: { ...EMPTY_COUNTERS },
});

/** Adds numeric aggregates only; unknown/raw source payloads have no route into persisted history. */
export const mergeRayenSyncPerformance = (
  current: RayenSyncPerformance | undefined,
  delta: RayenSyncPerformanceDelta | RayenSyncPerformance | undefined
): RayenSyncPerformance | undefined => {
  if (!current && !delta) return undefined;
  const merged = current ?? emptyRayenSyncPerformance();
  const stagesMs = { ...merged.stagesMs };
  for (const [stage, duration] of Object.entries(delta?.stagesMs ?? {})) {
    const key = stage as keyof RayenSyncPerformance['stagesMs'];
    stagesMs[key] = safeInteger(stagesMs[key]) + safeInteger(duration);
  }
  const counters = { ...merged.counters };
  for (const key of Object.keys(EMPTY_COUNTERS) as Array<keyof typeof EMPTY_COUNTERS>) {
    counters[key] = safeInteger(counters[key]) + safeInteger(delta?.counters?.[key]);
  }
  const sourceQuality = delta?.sourceQuality ?? merged.sourceQuality;
  const currentCoordination = merged.coordination;
  const coordinationDelta = delta?.coordination;
  const hasCoordination = Boolean(currentCoordination || coordinationDelta);
  const coordinationTarget = coordinationDelta?.target ?? currentCoordination?.target;
  const coordination = hasCoordination
    ? {
        ...(coordinationTarget ? { target: coordinationTarget } : {}),
        structuralReplans:
          safeInteger(currentCoordination?.structuralReplans) +
          safeInteger(coordinationDelta?.structuralReplans),
        confirmedEpisodes:
          coordinationDelta?.confirmedEpisodes == null
            ? safeInteger(currentCoordination?.confirmedEpisodes)
            : safeInteger(coordinationDelta.confirmedEpisodes),
        omittedEpisodes:
          coordinationDelta?.omittedEpisodes == null
            ? safeInteger(currentCoordination?.omittedEpisodes)
            : safeInteger(coordinationDelta.omittedEpisodes),
        clinicalRetries:
          safeInteger(currentCoordination?.clinicalRetries) +
          safeInteger(coordinationDelta?.clinicalRetries),
      }
    : undefined;
  return {
    stagesMs,
    counters,
    ...(sourceQuality ? { sourceQuality } : {}),
    ...(coordination ? { coordination } : {}),
  };
};

export const elapsedMilliseconds = (startedAt: number, now = Date.now()): number =>
  safeInteger(now - startedAt);

export const isRayenTimeoutMessage = (value: unknown): boolean =>
  /timeout|tiempo de espera|agotado/i.test(String(value ?? ''));

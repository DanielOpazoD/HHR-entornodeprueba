import type { ClinicalSyncCheckpoint } from '@/types/domain/clinicalSync';

export const CLINICAL_FULL_REVALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS = 14;
export const CLINICAL_MAX_HISTORY_LOOKBACK_DAYS = 180;

export interface ClinicalHistoryReadPolicy {
  lookbackDays?: number;
  fullValidationAt?: string;
  fullValidationAttemptAt?: string;
}

export const confirmFullWindow = (
  policy: ClinicalHistoryReadPolicy,
  effectiveLookbackDays: unknown
): string | undefined =>
  policy.fullValidationAt &&
  policy.lookbackDays !== undefined &&
  Number(effectiveLookbackDays) >= policy.lookbackDays
    ? policy.fullValidationAt
    : undefined;

/**
 * Rayen's history route only accepts a day-window, not an event watermark. Keep the short adaptive
 * window for normal runs and perform one bounded full validation per day to catch late corrections.
 */
export const resolveClinicalHistoryReadPolicy = (
  checkpoint: ClinicalSyncCheckpoint | undefined,
  censusDate: string,
  now: Date
): ClinicalHistoryReadPolicy => {
  if (!checkpoint) return {};
  const validations = ['scales', 'staffing']
    .flatMap(source => {
      const sourceCheckpoint = checkpoint?.sources[source as 'scales' | 'staffing'];
      return [
        sourceCheckpoint?.lastFullValidationAt,
        sourceCheckpoint?.lastFullValidationAttemptAt,
      ];
    })
    .filter((value): value is string => Boolean(value))
    .map(value => Date.parse(value))
    .filter(Number.isFinite);
  const latestFullWindowAttempt = validations.length > 0 ? Math.max(...validations) : 0;
  const nowMs = now.getTime();
  if (
    Number.isFinite(nowMs) &&
    (latestFullWindowAttempt === 0 ||
      nowMs - latestFullWindowAttempt >= CLINICAL_FULL_REVALIDATION_INTERVAL_MS)
  ) {
    const censusStart = Date.parse(`${censusDate}T00:00:00Z`);
    const nowStart = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    const censusAgeDays =
      Number.isFinite(censusStart) && Number.isFinite(nowStart)
        ? Math.max(0, Math.floor((nowStart - censusStart) / 86_400_000))
        : 0;
    const requestedLookback = Math.max(CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS, censusAgeDays + 2);
    return {
      lookbackDays: Math.min(CLINICAL_MAX_HISTORY_LOOKBACK_DAYS, requestedLookback),
      // Do not certify an incomplete baseline when the requested census exceeds endpoint support.
      ...(requestedLookback <= CLINICAL_MAX_HISTORY_LOOKBACK_DAYS
        ? { fullValidationAt: now.toISOString() }
        : { fullValidationAttemptAt: now.toISOString() }),
    };
  }
  return {};
};

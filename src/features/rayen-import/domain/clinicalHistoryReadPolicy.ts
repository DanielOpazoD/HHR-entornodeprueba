import type { ClinicalSyncCheckpoint } from '@/types/domain/clinicalSync';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

export const CLINICAL_FULL_REVALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CLINICAL_FULL_REVALIDATION_RETRY_INTERVAL_MS = 15 * 60 * 1000;
export const CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS = 14;

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
  typeof effectiveLookbackDays === 'number' &&
  Number.isSafeInteger(effectiveLookbackDays) &&
  effectiveLookbackDays > 0 &&
  effectiveLookbackDays >= policy.lookbackDays
    ? policy.fullValidationAt
    : undefined;

/** Explicit conservative bounds certified by the extension after the history request completes. */
export interface AuthoritativeHistoryWindow {
  startIsoDay: string;
  endIsoDay: string;
}

const isCanonicalIsoDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};

/** Absence is actionable only when the extension explicitly certifies both coverage boundaries. */
export const confirmAuthoritativeHistoryWindow = (
  policy: ClinicalHistoryReadPolicy,
  effectiveLookbackDays: unknown,
  startIsoDay: unknown,
  endIsoDay: unknown
): AuthoritativeHistoryWindow | undefined => {
  if (
    !confirmFullWindow(policy, effectiveLookbackDays) ||
    !isCanonicalIsoDay(startIsoDay) ||
    !isCanonicalIsoDay(endIsoDay) ||
    startIsoDay > endIsoDay
  ) {
    return undefined;
  }
  const coveredDays =
    Math.floor(
      (Date.parse(`${endIsoDay}T00:00:00Z`) - Date.parse(`${startIsoDay}T00:00:00Z`)) / 86_400_000
    ) + 1;
  return coveredDays > 0 && coveredDays <= Number(effectiveLookbackDays)
    ? { startIsoDay, endIsoDay }
    : undefined;
};

export const confirmAuthoritativeHistoryResponse = (
  policy: ClinicalHistoryReadPolicy,
  response: {
    effectiveLookbackDays?: unknown;
    coverageWindowStartIsoDay?: unknown;
    coverageWindowEndIsoDay?: unknown;
  }
): AuthoritativeHistoryWindow | undefined =>
  confirmAuthoritativeHistoryWindow(
    policy,
    response.effectiveLookbackDays,
    response.coverageWindowStartIsoDay,
    response.coverageWindowEndIsoDay
  );

/**
 * Rayen's history route only accepts a day-window, not an event watermark. Keep the short adaptive
 * window for normal runs and perform one full validation per day to catch late corrections.
 * Historical requests must still reach their selected day after a checkpoint becomes fresh.
 */
export const resolveClinicalHistoryReadPolicy = (
  checkpoint: ClinicalSyncCheckpoint | undefined,
  censusDate: string,
  now: Date
): ClinicalHistoryReadPolicy => {
  const sourceCheckpoints = ['scales', 'staffing'].map(
    source => checkpoint?.sources[source as 'scales' | 'staffing']
  );
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return {};

  const censusStart = Date.parse(`${censusDate}T00:00:00Z`);
  const nowStart = Date.parse(`${calendarStampInClinicalTimeZone(now).iso}T00:00:00Z`);
  const censusAgeDays =
    Number.isFinite(censusStart) && Number.isFinite(nowStart)
      ? Math.max(0, Math.floor((nowStart - censusStart) / 86_400_000))
      : 0;
  const requestedLookback = Math.max(CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS, censusAgeDays + 2);
  const hasRecentSufficientWindow = (
    timestamp: string | undefined,
    coveredLookbackDays: number | undefined,
    requiredLookbackDays: number,
    intervalMs: number
  ): boolean => {
    const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
    return (
      Number.isFinite(timestampMs) &&
      Number.isSafeInteger(coveredLookbackDays) &&
      Number(coveredLookbackDays) >= requiredLookbackDays &&
      // A clock correction must not postpone a baseline until a future checkpoint catches up.
      nowMs >= timestampMs &&
      nowMs - timestampMs < intervalMs
    );
  };
  const hasFreshSuccessfulValidation = sourceCheckpoints.some(source =>
    hasRecentSufficientWindow(
      source?.lastFullValidationAt,
      source?.lastFullValidationLookbackDays,
      requestedLookback,
      CLINICAL_FULL_REVALIDATION_INTERVAL_MS
    )
  );
  const hasFreshSufficientAttempt = sourceCheckpoints.some(source =>
    hasRecentSufficientWindow(
      source?.lastFullValidationAttemptAt,
      source?.lastFullValidationAttemptLookbackDays,
      requestedLookback,
      CLINICAL_FULL_REVALIDATION_RETRY_INTERVAL_MS
    )
  );

  if (hasFreshSuccessfulValidation || hasFreshSufficientAttempt) {
    // The extension's ordinary adaptive window is short. Never let a fresh checkpoint shrink
    // a historical read out of the selected date; only the expensive baseline marker is throttled.
    return censusAgeDays + 2 > CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS
      ? { lookbackDays: requestedLookback }
      : {};
  }

  return {
    lookbackDays: requestedLookback,
    fullValidationAttemptAt: now.toISOString(),
    fullValidationAt: now.toISOString(),
  };
};

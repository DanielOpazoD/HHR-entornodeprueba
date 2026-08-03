import { describe, expect, it } from 'vitest';
import {
  CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS,
  CLINICAL_MAX_HISTORY_LOOKBACK_DAYS,
  confirmAuthoritativeHistoryWindow,
  confirmFullWindow,
  resolveClinicalHistoryReadPolicy,
} from '@/features/rayen-import/domain/clinicalHistoryReadPolicy';
import type { ClinicalSyncCheckpoint } from '@/types/domain/clinicalSync';

const checkpoint = (
  scalesValidation?: string,
  staffingValidation?: string
): ClinicalSyncCheckpoint => ({
  version: 1,
  fingerprintVersion: 1,
  sources: {
    scales: {
      facts: [],
      ...(scalesValidation ? { lastFullValidationAt: scalesValidation } : {}),
    },
    staffing: {
      facts: [],
      ...(staffingValidation ? { lastFullValidationAt: staffingValidation } : {}),
    },
  },
});

describe('resolveClinicalHistoryReadPolicy', () => {
  const now = new Date('2026-07-29T12:00:00.000Z');

  it('establishes a bounded full baseline on the first synchronization', () => {
    expect(resolveClinicalHistoryReadPolicy(undefined, '2026-07-29', now)).toEqual({
      lookbackDays: CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS,
      fullValidationAt: now.toISOString(),
      fullValidationAttemptAt: now.toISOString(),
    });
  });

  it('requests one bounded full validation when an incremental checkpoint has no baseline', () => {
    expect(resolveClinicalHistoryReadPolicy(checkpoint(), '2026-07-29', now)).toEqual({
      lookbackDays: CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS,
      fullValidationAt: now.toISOString(),
      fullValidationAttemptAt: now.toISOString(),
    });
  });

  it('schedules full validation when only another incremental source exists', () => {
    expect(
      resolveClinicalHistoryReadPolicy(
        {
          version: 1,
          fingerprintVersion: 1,
          sources: { vitals: { facts: [] } },
        },
        '2026-07-29',
        now
      )
    ).toMatchObject({ lookbackDays: CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS });
  });

  it('keeps the adaptive window while both source baselines remain fresh', () => {
    expect(
      resolveClinicalHistoryReadPolicy(
        checkpoint('2026-07-29T06:00:00.000Z', '2026-07-29T07:00:00.000Z'),
        '2026-07-29',
        now
      )
    ).toEqual({});
  });

  it('revalidates when the latest full-window attempt is stale', () => {
    expect(
      resolveClinicalHistoryReadPolicy(
        checkpoint('2026-07-28T11:59:59.000Z', '2026-07-28T10:00:00.000Z'),
        '2026-07-29',
        now
      )
    ).toMatchObject({ lookbackDays: CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS });
  });

  it('throttles another full read after one source confirmed the requested window', () => {
    expect(
      resolveClinicalHistoryReadPolicy(checkpoint('2026-07-29T07:00:00.000Z'), '2026-07-29', now)
    ).toEqual({});
  });

  it('extends full validation far enough to include an older census date', () => {
    expect(resolveClinicalHistoryReadPolicy(checkpoint(), '2026-07-09', now)).toMatchObject({
      lookbackDays: 22,
    });
  });

  it('does not certify a full validation beyond the endpoint history limit', () => {
    expect(resolveClinicalHistoryReadPolicy(checkpoint(), '2025-12-01', now)).toEqual({
      lookbackDays: CLINICAL_MAX_HISTORY_LOOKBACK_DAYS,
      fullValidationAttemptAt: now.toISOString(),
    });
  });

  it('throttles a recent capped attempt without certifying a full baseline', () => {
    const cappedAttempt = checkpoint();
    cappedAttempt.sources.scales = {
      facts: [],
      lastFullValidationAttemptAt: '2026-07-29T07:00:00.000Z',
    };

    expect(resolveClinicalHistoryReadPolicy(cappedAttempt, '2025-12-01', now)).toEqual({});
  });

  it('confirms a baseline only when the extension covered the requested window', () => {
    const policy = { lookbackDays: 14, fullValidationAt: now.toISOString() };

    expect(confirmFullWindow(policy, 14)).toBe(now.toISOString());
    expect(confirmFullWindow(policy, 13)).toBeUndefined();
    expect(confirmFullWindow(policy, undefined)).toBeUndefined();
  });

  it('accepts only explicit, canonical bounds from a confirmed full read', () => {
    const policy = { lookbackDays: 14, fullValidationAt: now.toISOString() };
    expect(confirmAuthoritativeHistoryWindow(policy, 14, '2026-07-16', '2026-07-27')).toEqual({
      startIsoDay: '2026-07-16',
      endIsoDay: '2026-07-27',
    });
    expect(
      confirmAuthoritativeHistoryWindow(policy, 13, '2026-07-16', '2026-07-27')
    ).toBeUndefined();
    expect(confirmAuthoritativeHistoryWindow(policy, 14, undefined, '2026-07-27')).toBeUndefined();
    expect(
      confirmAuthoritativeHistoryWindow(policy, 14, '2026-07-28', '2026-07-27')
    ).toBeUndefined();
    expect(confirmAuthoritativeHistoryWindow(policy, 14, 'fecha', '2026-07-27')).toBeUndefined();
  });
});

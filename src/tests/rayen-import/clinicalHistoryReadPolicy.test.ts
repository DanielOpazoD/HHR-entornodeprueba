import { describe, expect, it } from 'vitest';
import {
  CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS,
  CLINICAL_MAX_HISTORY_LOOKBACK_DAYS,
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

  it('keeps the adaptive window on the first synchronization', () => {
    expect(resolveClinicalHistoryReadPolicy(undefined, '2026-07-29', now)).toEqual({});
  });

  it('requests one bounded full validation when an incremental checkpoint has no baseline', () => {
    expect(resolveClinicalHistoryReadPolicy(checkpoint(), '2026-07-29', now)).toEqual({
      lookbackDays: CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS,
      fullValidationAt: now.toISOString(),
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

  it('revalidates when either clinical-history source is stale or missing', () => {
    expect(
      resolveClinicalHistoryReadPolicy(
        checkpoint('2026-07-28T11:59:59.000Z', '2026-07-29T07:00:00.000Z'),
        '2026-07-29',
        now
      )
    ).toMatchObject({ lookbackDays: CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS });
    expect(
      resolveClinicalHistoryReadPolicy(checkpoint('2026-07-29T07:00:00.000Z'), '2026-07-29', now)
    ).toMatchObject({ lookbackDays: CLINICAL_FULL_REVALIDATION_LOOKBACK_DAYS });
  });

  it('extends full validation far enough to include an older census date', () => {
    expect(resolveClinicalHistoryReadPolicy(checkpoint(), '2026-07-09', now)).toMatchObject({
      lookbackDays: 22,
    });
  });

  it('does not certify a full validation beyond the endpoint history limit', () => {
    expect(resolveClinicalHistoryReadPolicy(checkpoint(), '2025-12-01', now)).toEqual({
      lookbackDays: CLINICAL_MAX_HISTORY_LOOKBACK_DAYS,
    });
  });
});

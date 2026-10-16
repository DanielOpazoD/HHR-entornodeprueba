// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveCensusSyncTarget } from '@/features/rayen-import/domain/historicalCensusSync';
import { resolveSyncReportRequest } from '@/features/rayen-import/hooks/reportDateHelpers';
import { resolveClinicalHistoryReadPolicy } from '@/features/rayen-import/domain/clinicalHistoryReadPolicy';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import '../../../extension/clinical-day-runtime.js';
import '../../../extension/census-sync-horizon-runtime.js';

const extension = globalThis as typeof globalThis & {
  HhrCensusSyncHorizonRuntime: { isSupportedTargetDay: (day: string, at: Date) => boolean };
  HhrClinicalDayRuntime: { historyLookbackDays: (day: string, at: Date) => number };
};

describe('evidence-driven historical synchronization', () => {
  const now = new Date('2026-10-15T18:00:00Z');

  it.each(['2026-10-14', '2026-09-15', '2026-08-15', '2026-07-09', '2025-10-15'])(
    'keeps HHR and the extension aligned for past date %s without promising available evidence',
    day => {
      expect(resolveCensusSyncTarget(day, now).kind).toBe('historical');
      expect(extension.HhrCensusSyncHorizonRuntime.isSupportedTargetDay(day, now)).toBe(true);
      expect(resolveSyncReportRequest({ date: day } as DailyRecord, now).range).toEqual({
        dateStart: day,
        dateEnd: '2026-10-16',
      });
    }
  );

  it.each(['2026-10-16', '2026-02-31', '', '15-10-2026'])(
    'rejects future or invalid dates consistently: %s',
    day => {
      expect(resolveCensusSyncTarget(day, now).kind).toBe('unsupported');
      expect(extension.HhrCensusSyncHorizonRuntime.isSupportedTargetDay(day, now)).toBe(false);
    }
  );

  it('keeps a repeated historical read wide enough after its successful baseline', () => {
    const policy = resolveClinicalHistoryReadPolicy(
      {
        version: 2,
        fingerprintVersion: 1,
        sources: {
          scales: {
            facts: [],
            lastFullValidationAt: '2026-10-15T17:00:00Z',
            lastFullValidationLookbackDays: 100,
          },
        },
      },
      '2026-07-09',
      now
    );
    expect(
      policy.lookbackDays ?? extension.HhrClinicalDayRuntime.historyLookbackDays('2026-07-09', now)
    ).toBeGreaterThanOrEqual(100);
    expect(policy.fullValidationAt).toBeUndefined();
  });

  it('requests the actual date instead of silently truncating history at 180 days', () => {
    expect(resolveClinicalHistoryReadPolicy(undefined, '2025-10-15', now)).toMatchObject({
      lookbackDays: 367,
      fullValidationAt: now.toISOString(),
    });
  });

  it('uses the Rapa Nui calendar rather than UTC for historical coverage', () => {
    const evening = new Date('2026-10-16T02:00:00Z'); // still 15 October in Rapa Nui
    expect(resolveClinicalHistoryReadPolicy(undefined, '2026-07-09', evening).lookbackDays).toBe(
      100
    );
  });
});

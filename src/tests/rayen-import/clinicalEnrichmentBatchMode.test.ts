import { describe, expect, it } from 'vitest';
import {
  resolveClinicalEnrichmentBatchModeForRun,
  resolveClinicalEnrichmentBatchPolicyForRun,
  usesLegacyClinicalWriter,
} from '@/features/rayen-import/domain/clinicalEnrichmentBatchMode';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('clinicalEnrichmentBatchMode', () => {
  const record = (
    clinicalBatchMode?: 'off' | 'shadow' | 'enforced'
  ): Pick<DailyRecord, 'date' | 'rayenSync' | 'rayenSyncHistory'> => ({
    date: '2026-08-04',
    rayenSync: {
      runId: 'latest-run',
      at: '2026-08-04T10:00:00.000Z',
      by: 'Operador HHR',
    },
    rayenSyncHistory: [
      {
        id: 'latest-run',
        sourceDate: '2026-08-04',
        startedAt: '2026-08-04T10:00:00.000Z',
        by: 'Operador HHR',
        status: 'applied',
        policy: { mode: 'preview', revision: 8, clinicalBatchMode },
      },
      {
        id: 'older-run',
        sourceDate: '2026-08-04',
        startedAt: '2026-08-04T09:00:00.000Z',
        by: 'Operador HHR',
        status: 'complete',
        policy: { mode: 'preview', revision: 7, clinicalBatchMode: 'shadow' },
      },
    ],
  });

  it('uses the server policy frozen for the requested run', () => {
    expect(resolveClinicalEnrichmentBatchModeForRun(record('enforced'), 'older-run')).toBe(
      'unavailable'
    );
    expect(resolveClinicalEnrichmentBatchModeForRun(record('enforced'), 'latest-run')).toBe(
      'enforced'
    );
    expect(resolveClinicalEnrichmentBatchPolicyForRun(record('enforced'), 'latest-run')).toEqual({
      runId: 'latest-run',
      importMode: 'preview',
      clinicalBatchMode: 'enforced',
      revision: 8,
      sourceDate: '2026-08-04',
      recordScope: 'run',
    });
  });

  it.each(['complete', 'partial', 'failed'] as const)(
    'does not authorize new clinical work from a %s run',
    status => {
      const terminal = record('shadow');
      terminal.rayenSyncHistory![0].status = status;

      expect(resolveClinicalEnrichmentBatchPolicyForRun(terminal, 'latest-run')).toBe(
        'unavailable'
      );
    }
  );

  it('uses off only for an existing legacy event and rejects missing run evidence', () => {
    expect(resolveClinicalEnrichmentBatchModeForRun(record(undefined), 'latest-run')).toBe('off');
    expect(resolveClinicalEnrichmentBatchModeForRun(record('enforced'), 'unknown-run')).toBe(
      'unavailable'
    );
    expect(resolveClinicalEnrichmentBatchModeForRun({ date: '2026-08-04' })).toBe('unavailable');
  });

  it('preserves only the revision-zero off default used before policy initialization', () => {
    const legacyDefault = record(undefined);
    legacyDefault.rayenSyncHistory![0].policy!.revision = 0;
    expect(resolveClinicalEnrichmentBatchPolicyForRun(legacyDefault)).toEqual({
      runId: 'latest-run',
      importMode: 'preview',
      clinicalBatchMode: 'off',
      revision: 0,
      sourceDate: '2026-08-04',
      recordScope: 'run',
    });

    const invalidEnforced = record('enforced');
    invalidEnforced.rayenSyncHistory![0].policy!.revision = 0;
    expect(resolveClinicalEnrichmentBatchPolicyForRun(invalidEnforced)).toBe('unavailable');
  });

  it('rejects malformed structural policy evidence at runtime', () => {
    const malformed = record('shadow');
    Object.assign(malformed.rayenSyncHistory![0].policy!, { mode: 'unsafe-auto' });

    expect(resolveClinicalEnrichmentBatchPolicyForRun(malformed)).toBe('unavailable');
  });

  it('reserves the established writer for off and shadow modes', () => {
    expect(usesLegacyClinicalWriter('off')).toBe(true);
    expect(usesLegacyClinicalWriter('shadow')).toBe(true);
    expect(usesLegacyClinicalWriter('enforced')).toBe(false);
  });
});

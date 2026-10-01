import { describe, expect, it } from 'vitest';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import {
  buildRayenSyncSessionReport,
  summarizeSyncMeasurements,
} from '@/features/rayen-import/domain/rayenSyncSessionReport';

const run = (id: string, overrides: Partial<RayenSyncEvent> = {}): RayenSyncEvent => ({
  id,
  by: 'PRIVATE-PROFESSIONAL',
  sourceDate: '2026-09-30',
  status: 'complete',
  startedAt: '2026-09-30T12:00:00Z',
  completedAt: '2026-09-30T12:00:10Z',
  source: { extensionVersion: '0.48.42' } as RayenSyncEvent['source'],
  performance: {
    stagesMs: { dualCapture: 2000, reviewWait: 6000, persistence: 12000 },
    counters: { requests: 4, cacheHits: 2, patches: 1, retries: 0, timeouts: 0 },
  },
  ...overrides,
});

describe('aggregate synchronization session report', () => {
  it('exports only numeric allowlisted evidence, without clinical identifiers or arbitrary strings', () => {
    const event = run('PRIVATE-RUN');
    event.source!.extensionVersion = 'PRIVATE-SECRET';
    event.coverage = {
      total: 1,
      completed: 0,
      errors: 1,
      sourceErrors: 1,
      completedAt: 'PRIVATE-TIME',
      issues: [{ bedId: 'PRIVATE-BED', source: 'vitals', reason: 'PRIVATE-DIAGNOSIS' }],
    } as unknown as RayenSyncEvent['coverage'];
    Object.assign(event.performance!, { extra: 'PRIVATE-TOKEN' });
    Object.assign(event.performance!.stagesMs, { extra: 'PRIVATE-HISTORY' });
    const json = JSON.stringify(buildRayenSyncSessionReport([event]));
    expect(json).not.toContain('PRIVATE');
    expect(json).not.toContain('2026-09-30');
    expect(json).toContain('unknown');
    expect(json).toContain('dualCaptureMs');
  });

  it('deduplicates runs and excludes unfinished or invalid wall durations without treating missing data as zero', () => {
    const report = buildRayenSyncSessionReport([
      run('one'),
      run('one'),
      run('unfinished', { completedAt: undefined }),
      run('invalid', { completedAt: 'invalid' }),
      run('backwards', { completedAt: '2026-09-29T12:00:00Z' }),
    ]);
    expect(report.duplicates).toBe(1);
    expect(report.omitted).toBe(3);
    expect(report.groups[0].runs).toBe(1);
    expect(report.groups[0].measurements.clinicalReadsMs).toBeUndefined();
    expect(report.groups[0].measurements.wallWithoutReviewMs?.median).toBe(4000);
    // Persistence is cumulative; it is retained even when it exceeds wall time.
    expect(report.groups[0].measurements.persistenceMs?.median).toBe(12000);
  });

  it('selects usable final duplicates independently of input order', () => {
    const unfinished = run('same', { completedAt: undefined, performance: undefined });
    const older = run('same', { completedAt: '2026-09-30T12:00:05Z', status: 'partial' });
    const finished = run('same');
    const forward = buildRayenSyncSessionReport([unfinished, older, finished]);
    expect(forward).toEqual(buildRayenSyncSessionReport([finished, older, unfinished]));
    const retryOne = run('retry');
    const retryTwo = run('retry');
    retryOne.performance!.coordination = {
      structuralReplans: 0,
      confirmedEpisodes: 0,
      omittedEpisodes: 0,
      clinicalRetries: 1,
    };
    retryTwo.performance!.coordination = {
      ...retryOne.performance!.coordination,
      clinicalRetries: 2,
    };
    expect(buildRayenSyncSessionReport([retryOne, retryTwo])).toEqual(
      buildRayenSyncSessionReport([retryTwo, retryOne])
    );
    expect(forward.omitted).toBe(0);
    expect(forward.duplicates).toBe(2);
    expect(forward.groups[0].cohort.status).toBe('complete');
    expect(forward.groups[0].measurements.wallMs?.median).toBe(10000);
    const differentMetrics = run('same');
    differentMetrics.performance!.counters.requests = 8;
    expect(buildRayenSyncSessionReport([finished, differentMetrics])).toEqual(
      buildRayenSyncSessionReport([differentMetrics, finished])
    );
  });

  it('keeps versions, outcomes, batch modes and changed/unchanged activity in separate cohorts', () => {
    const base = run('one');
    const coverage = (mode: 'enforced' | 'shadow', newFacts: number) =>
      ({
        incremental: { newFacts, corrections: 0, batch: { mode } },
      }) as RayenSyncEvent['coverage'];
    const report = buildRayenSyncSessionReport([
      base,
      run('two', { status: 'failed' }),
      run('three', { source: { extensionVersion: '0.48.41' } as RayenSyncEvent['source'] }),
      run('four', { coverage: coverage('enforced', 0) }),
      run('five', { coverage: coverage('enforced', 2) }),
      run('six', { coverage: coverage('shadow', 0) }),
    ]);
    expect(report.groups).toHaveLength(6);
  });

  it('omits non-numeric metrics and does not subtract an invalid review span', () => {
    const event = run('one');
    Object.assign(event.performance!.stagesMs, {
      clinicalReads: NaN,
      preflight: -1,
      reviewWait: 11000,
      dualCapture: '2000',
    });
    const metrics = buildRayenSyncSessionReport([event]).groups[0].measurements;
    expect(metrics.wallWithoutReviewMs).toBeUndefined();
    expect(metrics.preflightMs).toBeUndefined();
    expect(metrics.dualCaptureMs).toBeUndefined();
    expect(metrics.clinicalReadsMs).toBeUndefined();
  });

  it('reports measured sample counts and withholds p95 below twenty observations', () => {
    expect(summarizeSyncMeasurements([2, 6])).toEqual({ samples: 2, median: 4, max: 6, p95: null });
    expect(summarizeSyncMeasurements(Array.from({ length: 20 }, (_, i) => i + 1))).toEqual({
      samples: 20,
      median: 10.5,
      max: 20,
      p95: 19,
    });
    expect(summarizeSyncMeasurements([NaN, -1])).toBeNull();
    expect(summarizeSyncMeasurements([Number.MAX_VALUE, Number.MAX_VALUE])?.median).toBe(
      Number.MAX_VALUE
    );
  });
});

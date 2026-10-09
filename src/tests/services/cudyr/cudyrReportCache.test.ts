import { beforeEach, describe, expect, it } from 'vitest';
import { cudyrReportCache } from '@/services/cudyr/cudyrReportCache';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from './reportFixtures';
beforeEach(() => sessionStorage.clear());
describe('session owned local CUDYR cache', () => {
  it('restores a Firebase read after a document reload only for the same session owner/generation', () => {
    const report = buildCudyrReport(reportInput());
    cudyrReportCache({}, 'a:1', true).put(report);
    expect(cudyrReportCache({}, 'a:1', true).get(report.from, report.to)?.rows).toHaveLength(
      report.rows.length
    );
    expect(cudyrReportCache({}, 'b:1', true).get(report.from, report.to)).toBeUndefined();
    expect(cudyrReportCache({}, 'a:2', true).get(report.from, report.to)).toBeUndefined();
  });
  it('ignores malformed storage and clears a persisted snapshot on explicit invalidation', () => {
    sessionStorage.setItem('hhr_cudyr_report_cache_v1', '{bad');
    expect(cudyrReportCache({}, 'a:1', true).get('2026-10-01', '2026-10-04')).toBeUndefined();
    const cache = cudyrReportCache({}, 'a:1', true);
    cache.put(buildCudyrReport(reportInput()));
    cache.clear();
    expect(cudyrReportCache({}, 'a:1', true).get('2026-10-01', '2026-10-04')).toBeUndefined();
  });
});
it('does not reuse out-of-range read issues for an earlier day', () => {
  const report = buildCudyrReport(reportInput());
  report.issues = ['2026-10-04: lectura incompleta'];
  sessionStorage.setItem(
    'hhr_cudyr_report_cache_v11',
    JSON.stringify({ scope: 'earlier-range', reports: [report] })
  );
  const cache = cudyrReportCache({}, 'earlier-range', true);
  expect(cache.get(report.from, '2026-10-02')).toBeUndefined();
  expect(cache.get(report.from, report.to)?.issues).toEqual(report.issues);
});

it('restores a full reconstructed month larger than the old cache ceiling after reload', () => {
  const report = buildCudyrReport(reportInput());
  report.rows = Array.from({ length: 350 }, (_, i) => ({
    ...report.rows[0],
    key: `synthetic-${i}`,
    diagnosis: 'Descripción sintética '.repeat(100),
  }));
  const size = JSON.stringify(report).length;
  expect(size).toBeGreaterThan(1_000_000);
  expect(size).toBeLessThan(2_000_000);
  cudyrReportCache({}, 'month:1', true).put(report);
  expect(cudyrReportCache({}, 'month:1', true).get(report.from, report.to)?.rows).toHaveLength(350);
});

it('retains a complete official projection with its packed canonical copy above two million characters', () => {
  const report = buildCudyrReport(reportInput());
  report.rows = Array.from({ length: 510 }, (_, i) => ({
    ...report.rows[0],
    key: `large-${i}`,
    diagnosis: 'D'.repeat(1100),
  }));
  report.officialSnapshot = {
    version: 'verified-version',
    savedAt: new Date().toISOString(),
    packed: 'A'.repeat(230000),
  };
  expect(JSON.stringify(report).length).toBeGreaterThan(2_000_000);
  expect(JSON.stringify(report).length).toBeLessThan(2_300_000);
  cudyrReportCache({}, 'large-official:1', true).put(report);
  const restored = cudyrReportCache({}, 'large-official:1', true).get(report.from, report.to);
  expect(restored?.rows).toHaveLength(510);
  expect(restored?.officialSnapshot?.packed).toBe(report.officialSnapshot.packed);
  const cache = cudyrReportCache({}, 'large-official:1', true);
  const prefix = cache.get(report.from, '2026-10-02')!;
  cache.put(prefix);
  const reopened = cudyrReportCache({}, 'large-official:1', true);
  expect(reopened.get(report.from, report.to)?.officialSnapshot?.version).toBe('verified-version');
  expect(JSON.parse(sessionStorage.getItem('hhr_cudyr_report_cache_v11')!).reports).toHaveLength(1);
});

it('preserves the authoritative generation timestamp and pending state on cache reads', () => {
  const report = buildCudyrReport(reportInput());
  report.generatedAt = '2026-10-02T10:00:00Z';
  report.rows[0].applicationPending = true;
  const cache = cudyrReportCache({}, 'as-of:1', false);
  cache.put(report);
  expect(cache.get(report.from, report.to)?.generatedAt).toBe(report.generatedAt);
  expect(cache.get(report.from, report.to)?.rows[0].applicationPending).toBe(true);
});

import { describe, expect, it, vi } from 'vitest';
import {
  loadCudyrReport,
  cudyrReportDates,
  type cudyrReportLoaderPorts,
} from '@/services/cudyr/cudyrReportLoader';
import { reportRecord, reportCapture, reportObservation, reportPlacement } from './reportFixtures';

const ports = () => ({
  readRecord: vi.fn(async (date: string) => ({
    status: 'resolved' as const,
    record: reportRecord(date),
  })),
  readHistory: vi.fn(async () => ({ observations: [], nextCursor: null })),
  readCaptures: vi.fn(async () => ({ captures: [], nextCursor: null })),
  readEpisodeCaptures: vi.fn(async () => ({ captures: [], nextCursor: null })),
  readDischarges: vi.fn(async () => ({ corrections: [] })),
  readAudit: vi.fn(async () => ({ entries: [], nextCursor: null })),
  readPending: vi.fn(async () => []),
});
vi.mock('@/services/storage/firestore', () => ({ getRecordFromFirestoreDetailed: vi.fn() }));
vi.mock('@/services/cudyr/cudyrHistoryService', () => ({
  readCudyrHistory: vi.fn(),
  readCudyrCaptures: vi.fn(),
  readCudyrEpisodeCaptures: vi.fn(),
}));
vi.mock('@/services/cudyr/cudyrDischargeService', () => ({
  readCudyrDischarges: vi.fn(),
  readCudyrDischargeAudit: vi.fn(),
}));
vi.mock('@/services/storage/sync/cudyrPendingRead', () => ({ readPendingCudyrEpisodes: vi.fn() }));

describe('persisted-only report loader', () => {
  it('reads decisions for each month and marks failed exclusion reads as incomplete', async () => {
    const readExclusions = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('unavailable'));
    const result = await loadCudyrReport('2026-09-30', '2026-10-02', undefined, {
      ...ports(),
      readExclusions,
    });
    expect(readExclusions.mock.calls.map(call => call[0])).toEqual(['2026-09', '2026-10']);
    expect(result.issues).toContain(
      'Exclusiones diarias: lectura incompleta. Vuelva a cargar el período.'
    );
  });
  it('bounds periods, rejects impossible dates and crosses months in calendar days', () => {
    expect(cudyrReportDates('2026-09-30', '2026-10-02')).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    for (const pair of [
      ['2026-02-30', '2026-03-01'],
      ['2026-01-01', '2026-03-01'],
      ['bad', 'bad'],
      ['2026-10-03', '2026-10-01'],
    ])
      expect(() => cudyrReportDates(pair[0], pair[1])).toThrow();
  });
  it('exhausts observation and later episode-capture pages before deriving historical bed context', async () => {
    const p = ports();
    const observation = reportObservation();
    const capture = reportCapture({ censusDate: '2026-10-04' });
    capture.capture.sourcePlacements = [reportPlacement({ bedId: 'NEO1' })];
    const readHistory = vi
      .fn()
      .mockResolvedValueOnce({
        observations: [observation],
        nextCursor: { date: '2026-10-02', id: 'cursor' },
      })
      .mockResolvedValueOnce({
        observations: [{ ...observation, id: 'second-version' }],
        nextCursor: null,
      });
    const readEpisodeCaptures = vi
      .fn()
      .mockResolvedValueOnce({
        captures: [capture],
        nextCursor: { date: '2026-10-04', id: 'cursor' },
      })
      .mockResolvedValueOnce({
        captures: [{ ...capture, id: 'second-capture' }],
        nextCursor: null,
      });
    const result = await loadCudyrReport('2026-10-02', '2026-10-02', undefined, {
      ...p,
      readHistory,
      readEpisodeCaptures,
    });
    expect(readHistory).toHaveBeenCalledTimes(2);
    expect(readEpisodeCaptures).toHaveBeenCalledTimes(2);
    expect(result.observations).toHaveLength(2);
    expect(result.captures).toHaveLength(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      group: 'media',
      bedId: 'NEO1',
      contextSource: 'eloisa_interval',
    });
    expect(p.readRecord).toHaveBeenCalledWith('2026-10-02', { source: 'server' });
  });
  it('separates absent censuses, failed days and archive read failures without manufacturing patient-days', async () => {
    const p: typeof cudyrReportLoaderPorts = {
      ...ports(),
      readRecord: vi
        .fn()
        .mockResolvedValueOnce({ status: 'missing', record: null })
        .mockResolvedValueOnce({ status: 'failed', record: null, error: new Error('synthetic') }),
      readHistory: vi.fn().mockRejectedValue(new Error('synthetic')),
    };
    const result = await loadCudyrReport('2026-10-01', '2026-10-02', undefined, p);
    expect(result.rows).toHaveLength(0);
    expect(result.coverage.map(day => day.state)).toEqual(['sin_censo', 'error']);
    expect(result.issues).toHaveLength(1);
  });
  it('rejects cancellation after an in-flight read and starts no later reads', async () => {
    const p = ports();
    const controller = new AbortController();
    p.readRecord.mockImplementation(async date => {
      controller.abort();
      return { status: 'resolved', record: reportRecord(date) };
    });
    await expect(
      loadCudyrReport('2026-10-01', '2026-10-02', controller.signal, p)
    ).rejects.toThrow();
    expect(p.readHistory).not.toHaveBeenCalled();
  });
  it('fails a repeated cursor visibly instead of claiming a complete archive', async () => {
    const p = {
      ...ports(),
      readHistory: vi.fn().mockResolvedValue({
        observations: [reportObservation()],
        nextCursor: { date: '2026-10-02', id: 'same' },
      }),
    };
    const result = await loadCudyrReport('2026-10-02', '2026-10-02', undefined, p);
    expect(p.readHistory).toHaveBeenCalledTimes(2);
    expect(result.issues.join()).toContain('Historial CUDYR');
    expect(result.observations).toHaveLength(0);
  });
});

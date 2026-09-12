import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const audit = vi.hoisted(() => ({ available: vi.fn(), mark: vi.fn(), flush: vi.fn() }));
vi.mock('@/shared/runtime/censusStartupPerf', () => ({
  recordCensusAvailability: audit.available,
}));
vi.mock('@/shared/runtime/perfAudit', () => ({
  markPerf: audit.mark,
  flushPerfReport: audit.flush,
}));
import { useCensusBootstrapPerf, useCensusRecordPerf } from '@/hooks/useCensusRecordPerf';
beforeEach(() => vi.clearAllMocks());
it('does not attribute a previous day record to the newly selected day', () => {
  const { rerender } = renderHook(
    ({ date, recordDate, source }) => useCensusRecordPerf(date, recordDate, source),
    { initialProps: { date: 'a', recordDate: 'a', source: 'local' } }
  );
  expect(audit.available).toHaveBeenLastCalledWith('a', true, true);
  rerender({ date: 'b', recordDate: 'a', source: 'local' });
  expect(audit.available).toHaveBeenLastCalledWith('b', false, true);
  rerender({ date: 'b', recordDate: 'b', source: 'remote' });
  expect(audit.available).toHaveBeenLastCalledWith('b', true, false);
});
it('keeps legacy record readiness distinct from the visible-table contract without free-form details', () => {
  const { rerender } = renderHook(({ date, phase }) => useCensusBootstrapPerf(date, phase), {
    initialProps: { date: 'private-day', phase: 'loading' },
  });
  expect(audit.mark).not.toHaveBeenCalled();
  rerender({ date: 'private-day', phase: 'record_ready' });
  expect(audit.mark).toHaveBeenCalledExactlyOnceWith('daily-record:ready');
  expect(audit.flush).toHaveBeenCalledExactlyOnceWith('daily-record:record_ready');
  expect(JSON.stringify(audit.mark.mock.calls)).not.toContain('private-day');
});

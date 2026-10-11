import { afterEach, expect, it, vi } from 'vitest';
import { loadCudyrReport, cudyrReportLoaderPorts } from '@/services/cudyr/cudyrReportLoader';
const mocks = vi.hoisted(() => ({ probe: vi.fn(), save: vi.fn() }));
vi.mock('@/services/cudyr/cudyrOfficialReport', () => ({
  probeOfficialCudyrReport: mocks.probe,
  saveOfficialCudyrReport: mocks.save,
}));
afterEach(() => vi.restoreAllMocks());
it('keeps ordinary Firebase reads available when the optional official probe fails', async () => {
  mocks.probe.mockRejectedValue(new Error('Optional archive unavailable'));
  vi.spyOn(cudyrReportLoaderPorts, 'readRecord').mockResolvedValue({
    status: 'missing',
    record: null,
  } as never);
  vi.spyOn(cudyrReportLoaderPorts, 'readHistory').mockResolvedValue({
    observations: [],
    nextCursor: null,
  });
  vi.spyOn(cudyrReportLoaderPorts, 'readCaptures').mockResolvedValue({
    captures: [],
    nextCursor: null,
  });
  vi.spyOn(cudyrReportLoaderPorts, 'readPending').mockResolvedValue([]);
  vi.spyOn(cudyrReportLoaderPorts, 'readExclusions').mockResolvedValue([]);
  vi.spyOn(cudyrReportLoaderPorts, 'readSupplements').mockResolvedValue([]);
  vi.spyOn(cudyrReportLoaderPorts, 'readCensusSources').mockResolvedValue([]);
  vi.spyOn(cudyrReportLoaderPorts, 'readVerifiedContexts').mockResolvedValue([]);
  const result = await loadCudyrReport('2026-08-01', '2026-08-31');
  expect(cudyrReportLoaderPorts.readRecord).toHaveBeenCalledTimes(31);
  expect(result.coverage).toHaveLength(31);
  expect(result.officialSnapshot).toBeUndefined();
  expect(mocks.save).not.toHaveBeenCalled();
});

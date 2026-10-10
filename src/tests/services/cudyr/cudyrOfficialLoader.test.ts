import { beforeEach, expect, it, vi } from 'vitest';
import { loadCudyrReport, cudyrReportLoaderPorts } from '@/services/cudyr/cudyrReportLoader';
import { cudyrReportCache } from '@/services/cudyr/cudyrReportCache';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from './reportFixtures';
const mocks = vi.hoisted(() => ({ probe: vi.fn(), decode: vi.fn(), save: vi.fn() }));
vi.mock('@/services/cudyr/cudyrOfficialReport', () => ({
  probeOfficialCudyrReport: mocks.probe,
  decodeOfficialCudyrReport: mocks.decode,
  saveOfficialCudyrReport: mocks.save,
}));
vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  getStoredSessionOwnerKey: () => 'synthetic-owner',
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({ getSessionGeneration: () => 3 }));
const report = () => {
  const data = buildCudyrReport(confirmedReportInput());
  data.from = '2026-08-01';
  data.to = '2026-08-31';
  data.rows = data.rows.map(row => ({ ...row, date: '2026-08-02' }));
  data.coverage = Array.from({ length: 31 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    state: 'disponible' as const,
    lastSyncedAt: '',
    runId: '',
  }));
  data.officialSnapshot = {
    version: 'synthetic-version',
    savedAt: '2026-10-09T10:00:00Z',
    packed: 'synthetic',
  };
  return data;
};
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  cudyrReportCache(loadCudyrReport, 'synthetic-owner:3', true).clear();
  for (const name of Object.keys(cudyrReportLoaderPorts) as Array<
    keyof typeof cudyrReportLoaderPorts
  >) {
    vi.spyOn(cudyrReportLoaderPorts, name).mockRejectedValue(
      new Error('Unexpected historical read')
    );
  }
  mocks.probe.mockResolvedValue({ state: 'ready', sourceVersion: 'source' });
  mocks.decode.mockResolvedValue(report());
});
it('serves a saved official month and a day prefix without reconstructing the census', async () => {
  const result = await loadCudyrReport('2026-08-01', '2026-08-02');
  expect(result.to).toBe('2026-08-02');
  expect(result.coverage).toHaveLength(2);
  expect(result.rows[0].date).toBe('2026-08-02');
  expect(result.officialSnapshot?.version).toBe('synthetic-version');
  for (const read of Object.values(cudyrReportLoaderPorts)) expect(read).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it('refetches the saved artifact if a known-version cache cannot be decoded', async () => {
  cudyrReportCache(loadCudyrReport, 'synthetic-owner:3', true).put(report());
  mocks.probe.mockResolvedValueOnce({ state: 'unchanged', sourceVersion: 'source' });
  mocks.decode.mockRejectedValueOnce(new Error('Corrupt local cache'));
  const result = await loadCudyrReport('2026-08-01', '2026-08-31');
  expect(mocks.probe).toHaveBeenCalledTimes(2);
  expect(mocks.probe).toHaveBeenLastCalledWith('2026-08');
  expect(result.officialSnapshot).toBeTruthy();
  expect(cudyrReportLoaderPorts.readRecord).not.toHaveBeenCalled();
});
it('does not label a rejected server artifact as a valid official report', async () => {
  mocks.decode.mockRejectedValueOnce(new Error('Invalid integrity'));
  await expect(loadCudyrReport('2026-08-01', '2026-08-31')).rejects.toThrow('Invalid integrity');
  expect(cudyrReportLoaderPorts.readRecord).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('preserves an official cache and surfaces probe failure without replacing it with reconstruction', async () => {
  const cache = cudyrReportCache(loadCudyrReport, 'synthetic-owner:3', true);
  cache.put(report());
  mocks.probe.mockRejectedValueOnce(new Error('Sin conexión'));
  await expect(loadCudyrReport('2026-08-01', '2026-08-02')).rejects.toThrow('Sin conexión');
  expect(cache.get('2026-08-01', '2026-08-02')?.officialSnapshot).toBeTruthy();
  expect(cudyrReportLoaderPorts.readRecord).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('does not probe an official artifact while the month is still open', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-08-15T18:00:00Z'));
    await expect(loadCudyrReport('2026-08-01', '2026-08-02')).rejects.toThrow(
      'Unexpected historical read'
    );
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(cudyrReportLoaderPorts.readRecord).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

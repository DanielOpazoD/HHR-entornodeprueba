import { describe, it, expect, vi } from 'vitest';
import {
  monthlyRecoveryPeriod,
  recoverCudyrMonthlyReports,
} from '@/services/cudyr/cudyrMonthlyRecovery';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
vi.mock('@/services/cudyr/cudyrSupplementFile', () => ({ readCudyrSupplementFile: vi.fn() }));
vi.mock('@/services/cudyr/cudyrSupplementService', () => ({
  importCudyrSupplement: vi.fn(),
  loadCudyrSupplements: vi.fn(),
}));
vi.mock('@/services/cudyr/cudyrReportLoader', () => ({ loadCudyrReport: vi.fn() }));
const now = new Date('2026-10-08T18:00:00Z');
const source = (month: string) => ({ month, base64: 'AA==', capturedAt: now.toISOString() });
const stored = (month: string, observedAt = '2026-09-02T18:00:00Z') =>
  ({
    month,
    report: { month, patients: [] },
    importedAt: observedAt,
    capture: { source: 'extension_monthly_report', observedAt },
  }) as unknown as ArchivedCudyrSupplement;
const setup = () => ({
  readCensus: vi.fn().mockResolvedValue({
    from: '2026-08-01',
    to: '2026-08-31',
    rows: [],
    coverage: [],
    issues: [],
  }),
  load: vi.fn().mockResolvedValue([]),
  fetchReport: vi.fn().mockImplementation(async (month: string) => source(month)),
  readFile: vi.fn().mockImplementation(async (file: File) => ({
    report: { month: file.name.match(/\d{4}-\d{2}/)![0] },
    file: { name: file.name, base64: 'AA==' },
    operationId: 'op',
  })),
  save: vi.fn().mockResolvedValue({ persisted: true, captureStored: true }),
});
const run = (ports: ReturnType<typeof setup>, signal = new AbortController().signal) =>
  recoverCudyrMonthlyReports('2026-08', signal, vi.fn(), ports as never, now);
describe('monthly documentary recovery', () => {
  it('verifies the newest source capture even when an older report was imported later', async () => {
    const ports = setup();
    const recent = { ...stored('2026-08', '2026-09-03T18:00:00Z'), id: 'recent' };
    const delayed = {
      ...stored('2026-08', '2026-09-02T18:00:00Z'),
      id: 'delayed',
      importedAt: '2026-10-08T17:00:00Z',
    };
    ports.load.mockResolvedValue([delayed, recent, stored('2026-09')]);
    const result = await run(ports);
    expect(result.reports.find(r => r.month === '2026-08')?.id).toBe('recent');
    expect(ports.fetchReport).not.toHaveBeenCalled();
  });

  it('reuses the neighboring census already captured after noon on the month closing day', async () => {
    const ports = setup();
    const closedAt = '2026-09-01T18:01:00Z';
    ports.load.mockResolvedValue([stored('2026-08', closedAt), stored('2026-09', closedAt)]);
    const census = {
      load: vi
        .fn()
        .mockResolvedValue(
          [
            ...Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`),
            '2026-09-01',
          ].map(date => ({ date, observedAt: closedAt, importedAt: closedAt }))
        ),
      readFile: vi.fn(),
      save: vi.fn(),
    };
    await recoverCudyrMonthlyReports(
      '2026-08',
      new AbortController().signal,
      vi.fn(),
      { ...ports, census } as never,
      new Date('2026-09-01T18:10:00Z')
    );
    expect(ports.fetchReport).not.toHaveBeenCalled();
  });

  it('reuses saved censuses and queries only the following calendar day with its own month', async () => {
    const ports = setup();
    ports.load.mockResolvedValue([stored('2026-08'), stored('2026-09')]);
    const census = {
      load: vi.fn().mockResolvedValue(
        Array.from({ length: 31 }, (_, i) => ({
          date: `2026-08-${String(i + 1).padStart(2, '0')}`,
          observedAt: '2026-10-07T18:00:00Z',
          importedAt: '2026-10-07T18:00:00Z',
        }))
      ),
      readFile: vi.fn().mockResolvedValue({ date: '2026-09-01', patients: [] }),
      save: vi.fn().mockResolvedValue({ persisted: true }),
    };
    await run({ ...ports, census } as never);
    expect(census.load).toHaveBeenCalledWith('2026-08-01', '2026-09-01', expect.any(AbortSignal));
    expect(ports.fetchReport).toHaveBeenCalledExactlyOnceWith(
      '2026-09',
      expect.any(AbortSignal),
      '2026-09-01'
    );
    expect(census.save).toHaveBeenCalledTimes(1);
  });

  it('includes the next month even across the year boundary and rejects malformed periods', () => {
    expect(monthlyRecoveryPeriod('2026-12')).toMatchObject({
      last: '2026-12-31',
      next: '2027-01-01',
      reportMonths: ['2026-12', '2027-01'],
    });
    expect(monthlyRecoveryPeriod('2024-02').last).toBe('2024-02-29');
    expect(() => monthlyRecoveryPeriod('2026-13')).toThrow();
  });
  it('archives both reports without claiming full history or changing clinical data', async () => {
    const ports = setup();
    const result = await run(ports);
    expect(ports.fetchReport.mock.calls.map(c => c[0])).toEqual(['2026-08', '2026-09']);
    expect(result).toMatchObject({
      recovered: 2,
      reused: 0,
      failures: [],
      verification: 'documentary',
    });
    expect(ports.save.mock.calls[0][0]).toHaveProperty(
      'capture.source',
      'extension_monthly_report'
    );
  });
  it('reuses acknowledged reports after closing and resumes only the missing report', async () => {
    const ports = setup();
    ports.load.mockResolvedValue([stored('2026-08')]);
    expect(await run(ports)).toMatchObject({ reused: 1, recovered: 1 });
    expect(ports.fetchReport).toHaveBeenCalledTimes(1);
    expect(ports.fetchReport.mock.calls[0][0]).toBe('2026-09');
  });
  it('does not reuse manual imports or pre-noon captures as a final source receipt', async () => {
    const ports = setup();
    ports.load.mockResolvedValue([
      { ...stored('2026-08'), capture: undefined },
      stored('2026-09', '2026-09-01T16:59:00Z'),
    ]);
    expect(await run(ports)).toMatchObject({ reused: 0, recovered: 2 });
  });
  it('keeps successful checkpoints when another report fails; never infers absence', async () => {
    const ports = setup();
    ports.fetchReport.mockRejectedValueOnce(new Error('network'));
    expect(await run(ports)).toMatchObject({
      recovered: 1,
      failures: ['2026-08'],
      verification: 'documentary',
    });
  });
  it('preserves saved sources and partial failures if final reconciliation cannot be read', async () => {
    const ports = setup();
    ports.fetchReport.mockRejectedValueOnce(new Error('network'));
    ports.readCensus.mockRejectedValue(new Error('firebase unavailable'));
    expect(await run(ports)).toMatchObject({
      recovered: 1,
      failures: ['2026-08'],
      verificationError: expect.stringContaining('Fuentes guardadas'),
    });
  });
  it('propagates cancellation during the final reconciliation read', async () => {
    const ports = setup();
    const control = new AbortController();
    ports.readCensus.mockImplementation(async () => {
      control.abort();
      throw new Error('aborted');
    });
    await expect(run(ports, control.signal)).rejects.toThrow();
  });
  it('rejects a mismatched report and unacknowledged/old-server writes', async () => {
    const ports = setup();
    ports.readFile.mockResolvedValueOnce({ report: { month: '2026-07' } });
    ports.save.mockResolvedValue({ persisted: true });
    expect(await run(ports)).toMatchObject({ recovered: 0, failures: ['2026-08', '2026-09'] });
    expect(ports.save).toHaveBeenCalledTimes(1);
  });
  it('does not query Eloisa when Firebase archive reading fails', async () => {
    const ports = setup();
    ports.load.mockRejectedValue(new Error('firebase'));
    await expect(run(ports)).rejects.toThrow('firebase');
    expect(ports.fetchReport).not.toHaveBeenCalled();
  });
  it('cancels before saving an in-flight response or starting another request', async () => {
    const ports = setup();
    const control = new AbortController();
    ports.fetchReport.mockImplementationOnce(async () => {
      control.abort();
      return source('2026-08');
    });
    await expect(run(ports, control.signal)).rejects.toThrow();
    expect(ports.save).not.toHaveBeenCalled();
    expect(ports.fetchReport).toHaveBeenCalledTimes(1);
  });
  it('refuses recovery while the last application window remains open', async () => {
    const ports = setup();
    await expect(
      recoverCudyrMonthlyReports(
        '2026-08',
        new AbortController().signal,
        vi.fn(),
        ports as never,
        new Date('2026-09-01T16:59:00Z')
      )
    ).rejects.toThrow(/sigue abierto/);
    expect(ports.load).not.toHaveBeenCalled();
  });
});

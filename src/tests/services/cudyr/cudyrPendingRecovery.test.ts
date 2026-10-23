import { describe, expect, it, vi } from 'vitest';
import {
  monthlyRecoveryWindow,
  recoverCudyrMonthlyReports,
} from '@/services/cudyr/cudyrMonthlyRecovery';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput, reportRecord, reportPatient } from './reportFixtures';

vi.mock('@/services/cudyr/cudyrSupplementFile', () => ({ readCudyrSupplementFile: vi.fn() }));
vi.mock('@/services/cudyr/cudyrSupplementService', () => ({
  importCudyrSupplement: vi.fn(),
  loadCudyrSupplements: vi.fn(),
}));
vi.mock('@/services/cudyr/cudyrReportLoader', () => ({ loadCudyrReport: vi.fn() }));
const now = new Date('2026-10-18T15:00:00Z'); // Before noon in Rapa Nui: last closed night is 16.
const setup = () => {
  const data = buildCudyrReport(
    confirmedReportInput({
      from: '2026-10-01',
      to: '2026-10-16',
      generatedAt: now.toISOString(),
      records: [reportRecord('2026-10-12', { R1: reportPatient() })],
    })
  );
  // Synthetic empty, verified days; only October 12 needs source evidence.
  data.coverage = Array.from({ length: 16 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    state: 'disponible' as const,
    lastSyncedAt: '',
    runId: '',
  }));
  data.captures = [];
  data.observations = [];
  data.rows = data.rows
    .filter(r => r.date === '2026-10-12')
    .map(r => ({
      ...r,
      evaluation: null,
      monthlyEvidence: undefined,
      cudyrStatus: 'sin_captura' as const,
    }));
  const ports = {
    readCensus: vi.fn().mockResolvedValue(data),
    load: vi.fn().mockResolvedValue([]),
    fetchReport: vi
      .fn()
      .mockResolvedValue({ month: '2026-10', base64: 'AA==', capturedAt: now.toISOString() }),
    readFile: vi.fn().mockResolvedValue({
      report: { month: '2026-10' },
      file: { name: 'synthetic.xls', base64: 'AA==' },
      operationId: 'synthetic',
    }),
    save: vi.fn().mockResolvedValue({ persisted: true, captureStored: true }),
  };
  return { data, ports };
};
const run = (ports: ReturnType<typeof setup>['ports']) =>
  recoverCudyrMonthlyReports('2026-10', new AbortController().signal, vi.fn(), ports as never, now);
describe('explicit refresh of pending closed nights', () => {
  it('recovers an open month without querying next month or unfinished nights', async () => {
    const { ports } = setup();
    await run(ports);
    expect(ports.readCensus).toHaveBeenCalledWith(
      '2026-10-01',
      '2026-10-16',
      expect.any(AbortSignal)
    );
    expect(ports.fetchReport).toHaveBeenCalledExactlyOnceWith('2026-10', expect.any(AbortSignal));
    expect(ports.save).toHaveBeenCalledOnce();
  });
  it('does not query or write sources when all days are verified', async () => {
    const { ports, data } = setup();
    data.rows = [];
    await run(ports);
    expect(ports.fetchReport).not.toHaveBeenCalled();
    expect(ports.save).not.toHaveBeenCalled();
  });
  it('preserves an official month without querying or writing sources', async () => {
    const { ports, data } = setup();
    data.officialSnapshot = { version: 'verified', savedAt: now.toISOString() };
    await run(ports);
    expect(ports.fetchReport).not.toHaveBeenCalled();
    expect(ports.save).not.toHaveBeenCalled();
  });
  it('does not infer missing sources from a failed Firebase read', async () => {
    const { ports, data } = setup();
    data.issues = ['read failed'];
    await expect(run(ports)).rejects.toThrow();
    expect(ports.fetchReport).not.toHaveBeenCalled();
    expect(ports.save).not.toHaveBeenCalled();
  });
  it('can recover source gaps despite a clinical reconciliation warning after a complete read', async () => {
    const { ports, data } = setup();
    data.readIncomplete = false;
    data.issues = ['Archivo con episodio ausente o contradictorio'];
    await run(ports);
    expect(ports.fetchReport).toHaveBeenCalledOnce();
    data.rows = [];
    ports.fetchReport.mockClear();
    await run(ports);
    expect(ports.fetchReport).not.toHaveBeenCalled();
  });
  it('queries only the missing census and leaves its verified neighbor alone', async () => {
    const { ports } = setup();
    const census = {
      load: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue({ date: '2026-10-12', patients: [] }),
      save: vi.fn().mockResolvedValue({ persisted: true }),
    };
    await run({ ...ports, census } as typeof ports);
    expect(ports.fetchReport.mock.calls.map(call => call[2])).toEqual(['2026-10-12', undefined]);
    expect(census.save).toHaveBeenCalledOnce();
  });
  it('preserves a verified next-month neighbor without expanding recovery into that month', async () => {
    const { ports, data } = setup();
    data.from = '2026-09-01';
    data.to = '2026-09-30';
    data.coverage = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      state: 'disponible' as const,
      lastSyncedAt: '',
      runId: '',
    }));
    data.rows = data.rows.map(row => ({ ...row, date: '2026-09-30' }));
    const neighbor = {
      ...data,
      from: '2026-10-01',
      to: '2026-10-01',
      readIncomplete: false,
      issues: ['Archivo con episodio ausente o contradictorio'],
      rows: [],
      coverage: [{ date: '2026-10-01', state: 'disponible' as const, lastSyncedAt: '', runId: '' }],
    };
    ports.readCensus.mockImplementation(async (from: string) =>
      from === '2026-10-01' ? neighbor : data
    );
    const census = {
      load: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue({ date: '2026-09-30', patients: [] }),
      save: vi.fn().mockResolvedValue({ persisted: true }),
    };
    await recoverCudyrMonthlyReports(
      '2026-09',
      new AbortController().signal,
      vi.fn(),
      { ...ports, census } as never,
      now
    );
    expect(ports.fetchReport.mock.calls.filter(call => call[2]).map(call => call[2])).toEqual([
      '2026-09-30',
    ]);
    expect(ports.readCensus).toHaveBeenCalledWith(
      '2026-10-01',
      '2026-10-01',
      expect.any(AbortSignal)
    );
  });
  it('opens each night at noon in Rapa Nui and handles year boundaries', () => {
    expect(monthlyRecoveryWindow('2026-10', new Date('2026-10-18T16:59:59Z'))?.last).toBe(
      '2026-10-16'
    );
    expect(monthlyRecoveryWindow('2026-10', new Date('2026-10-18T17:00:00Z'))?.last).toBe(
      '2026-10-17'
    );
    expect(monthlyRecoveryWindow('2026-12', new Date('2027-01-01T17:00:00Z'))?.next).toBe(
      '2027-01-01'
    );
    expect(monthlyRecoveryWindow('2026-11', now)).toBeNull();
  });
});

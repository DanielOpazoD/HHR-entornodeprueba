// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { presentRayenCoverageIssue } from '@/features/rayen-import/components/rayenSyncPresentation';
import {
  captureCudyrMonthlyReport,
  cudyrMonthlyReportPorts,
} from '@/services/cudyr/cudyrMonthlyReportCapture';
import { parseCudyrSupplementBinary } from '@/services/cudyr/cudyrSupplementBinary';
import { historicalDay, now, patient, reportBytes } from './dailyCudyrRecovery.fixtures';

const ports = () => ({
  fetchReport: vi.fn<typeof cudyrMonthlyReportPorts.fetchReport>().mockResolvedValue({
    month: '2026-10',
    base64: btoa(String.fromCharCode(...new Uint8Array(reportBytes()))),
    capturedAt: now().toISOString(),
  }),
  readFile: vi.fn<typeof cudyrMonthlyReportPorts.readFile>().mockImplementation(async file => {
    const parsed = parseCudyrSupplementBinary(await file.arrayBuffer());
    if (!parsed.ok) throw new Error('Invalid synthetic XLS');
    return {
      report: parsed.report,
      file: { name: file.name, base64: 'synthetic-bytes' },
      operationId: '00000000-0000-4000-8000-000000000001',
    };
  }),
  save: vi.fn<typeof cudyrMonthlyReportPorts.save>().mockResolvedValue({
    persisted: true,
    captureStored: true,
    id: 'synthetic-content-id',
    status: 'ok',
  }),
});

const read = (
  dependencies: ReturnType<typeof ports>,
  loadDay: Parameters<typeof createDailyCudyrRecoveryReader>[0]['loadDay'] = async () => null,
  signal = new AbortController().signal
) =>
  createDailyCudyrRecoveryReader({
    signal,
    now,
    loadDay,
    capture: (month, abort, check) => captureCudyrMonthlyReport(month, abort, check, dependencies),
  })(historicalDay(), [patient().clinicalEpisodeId], {
    map: new Map(),
    historyAvailable: true,
  });

describe('daily CUDYR recovery distinguishes reading from archiving', () => {
  it.each(['download', 'parse', 'month mismatch'])(
    'reports a %s failure as an unavailable source without attempting an archive',
    async failure => {
      const dependencies = ports();
      if (failure === 'download')
        dependencies.fetchReport.mockRejectedValue(new Error('synthetic unavailable source'));
      if (failure === 'parse')
        dependencies.readFile.mockRejectedValue(new Error('synthetic unreadable report'));
      if (failure === 'month mismatch') {
        const parse = dependencies.readFile.getMockImplementation()!;
        dependencies.readFile.mockImplementation(async (...args) => {
          const parsed = await parse(...args);
          parsed.report.month = '2026-09';
          return parsed;
        });
      }
      const result = await read(dependencies);
      expect(result.current.size).toBe(0);
      expect(result.previous).toEqual([]);
      expect(dependencies.save).not.toHaveBeenCalled();
      expect(result.errors).toEqual([
        expect.objectContaining({ source: 'cudyr', reason: 'source_unavailable' }),
      ]);
      expect(presentRayenCoverageIssue(result.errors[0])).not.toContain('guardado');
    }
  );

  it.each(['rejected', 'unconfirmed', 'missing bytes', 'missing id'])(
    'keeps a %s archive unresolved after attempting to save the real source bytes',
    async failure => {
      const dependencies = ports();
      if (failure === 'rejected')
        dependencies.save.mockRejectedValue(new Error('synthetic archive failed'));
      else
        dependencies.save.mockResolvedValue({
          persisted: failure !== 'unconfirmed',
          captureStored: failure !== 'missing bytes',
          id: failure === 'missing id' ? '' : 'synthetic-content-id',
          status: 'ok',
        });
      const result = await read(dependencies);
      expect(dependencies.save).toHaveBeenCalledOnce();
      expect(result.current.size).toBe(0);
      expect(result.previous).toEqual([]);
      expect(result.errors).toEqual([
        expect.objectContaining({ source: 'cudyr', reason: 'historical_archive_failed' }),
      ]);
    }
  );

  it('reports an unreadable census before requesting or saving a monthly report', async () => {
    const dependencies = ports();
    const result = await read(dependencies, async () => {
      throw new Error('synthetic census read failed');
    });
    expect(result.errors).toEqual([
      expect.objectContaining({ source: 'cudyr', reason: 'record_load_failed' }),
    ]);
    expect(result.current.size).toBe(0);
    expect(result.previous).toEqual([]);
    expect(dependencies.fetchReport).not.toHaveBeenCalled();
    expect(dependencies.save).not.toHaveBeenCalled();
  });

  it('propagates cancellation instead of recording a failed archive', async () => {
    const dependencies = ports();
    const controller = new AbortController();
    dependencies.save.mockImplementation(async () => {
      controller.abort();
      throw new Error('synthetic cancelled save');
    });
    await expect(read(dependencies, undefined, controller.signal)).rejects.toThrow();
    expect(dependencies.save).toHaveBeenCalledOnce();
  });
});

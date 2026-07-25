// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/gestion-camas-egreso-report-runtime.js';

type DownloadItem = { state?: string; filename?: string };
type RuntimeFactory = {
  create: (dependencies: Record<string, unknown>) => {
    save: (args: { dateStart: string; dateEnd: string }) => Promise<Record<string, unknown>>;
  };
};

const factory = (
  globalThis as typeof globalThis & { HhrGestionCamasEgresoReportRuntime: RuntimeFactory }
).HhrGestionCamasEgresoReportRuntime;

const createRuntime = (searchItems: () => DownloadItem[]) => {
  const downloads = {
    download: vi.fn(async () => 42),
    search: vi.fn((_query: object, callback: (items: DownloadItem[]) => void) => {
      callback(searchItems());
    }),
  };
  const runtime = factory.create({
    downloads,
    reportFile: 'reporte.xls',
    resolveSession: vi.fn(async () => ({
      record: { apiBase: 'https://gestion.test', facId: 1342, token: 'token' },
    })),
    classifyRejection: vi.fn(),
    markSessionVerified: vi.fn(async () => true),
    fetchWithTimeout: vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    })),
    ensureSpreadsheet: vi.fn(),
    parseWorkbook: vi.fn(() => []),
    spreadsheet: {},
    bufferToBase64: vi.fn(() => 'AQID'),
  });
  return { runtime, downloads };
};

const range = { dateStart: '2026-07-24', dateEnd: '2026-07-25' };

afterEach(() => {
  vi.useRealTimers();
});

describe('Gestión de Camas egreso report runtime', () => {
  it('reports success only after Chrome confirms a completed download', async () => {
    const { runtime } = createRuntime(() => [{ state: 'complete', filename: '/tmp/reporte.xls' }]);

    await expect(runtime.save(range)).resolves.toMatchObject({
      ok: true,
      id: 42,
      path: '/tmp/reporte.xls',
      length: 3,
    });
  });

  it('returns an error when Chrome interrupts the download', async () => {
    const { runtime } = createRuntime(() => [{ state: 'interrupted' }]);

    await expect(runtime.save(range)).resolves.toEqual({
      error: 'La descarga del reporte se interrumpió. Reintenta la operación.',
    });
  });

  it('stops polling when Chrome never returns a terminal download state', async () => {
    vi.useFakeTimers();
    const { runtime, downloads } = createRuntime(() => []);
    const pending = runtime.save(range);

    await vi.advanceTimersByTimeAsync(30_200);

    await expect(pending).resolves.toEqual({
      error: 'La descarga del reporte no se completó a tiempo.',
    });
    expect(downloads.search).toHaveBeenCalled();
  });
});

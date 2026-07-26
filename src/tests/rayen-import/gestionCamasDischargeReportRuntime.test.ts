// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

interface DownloadRuntime {
  create: (dependencies: Record<string, unknown>) => {
    download: (input: { encId: string }) => Promise<Record<string, unknown>>;
  };
}
interface EvidenceRuntime {
  create: (dependencies: Record<string, unknown>) => {
    read: (input: { encId: string; sender: object }) => Promise<Record<string, unknown>>;
  };
}
interface FetcherRuntime {
  create: (
    dependencies: Record<string, unknown>
  ) => (encId: string) => Promise<Record<string, unknown>>;
}

const context = vm.createContext({ URL });
vm.runInContext(
  readFileSync(path.resolve('extension/gestion-camas-statistical-report-fetcher.js'), 'utf8'),
  context
);
vm.runInContext(
  readFileSync(path.resolve('extension/gestion-camas-discharge-report-runtime.js'), 'utf8'),
  context
);
vm.runInContext(
  readFileSync(path.resolve('extension/gestion-camas-statistical-evidence-runtime.js'), 'utf8'),
  context
);
const fetcherRuntime = (
  context as unknown as {
    HhrGestionCamasStatisticalReportFetcher: FetcherRuntime;
  }
).HhrGestionCamasStatisticalReportFetcher;
const downloadRuntime = (
  context as unknown as {
    HhrGestionCamasDischargeReportRuntime: DownloadRuntime;
  }
).HhrGestionCamasDischargeReportRuntime;
const evidenceRuntime = (
  context as unknown as {
    HhrGestionCamasStatisticalEvidenceRuntime: EvidenceRuntime;
  }
).HhrGestionCamasStatisticalEvidenceRuntime;

describe('Gestión de Camas statistical-discharge report runtime', () => {
  it('downloads the exact episode PDF and revalidates the session', async () => {
    const record = {
      apiBase: 'https://hospbackend.rayensalud.cl/Hospitalizados/api/',
      token: 'secret',
    };
    const buffer = new ArrayBuffer(4);
    const fetchOfficialPdf = vi.fn(async () => ({ buffer }));
    const markSessionVerified = vi.fn(async () => true);
    const downloadPdfBuffer = vi.fn(async () => ({ downloaded: true }));
    const fetchReport = fetcherRuntime.create({
      resolveSession: vi.fn(async () => ({ record })),
      fetchOfficialPdf,
      markSessionVerified,
    });
    const operation = downloadRuntime.create({
      fetchReport,
      downloadPdfBuffer,
    });

    await expect(operation.download({ encId: '141704' })).resolves.toEqual({
      downloaded: true,
      ok: true,
    });
    expect(fetchOfficialPdf).toHaveBeenCalledWith({
      ...record,
      url: 'https://hospbackend.rayensalud.cl/Hospitalizados/api/report/Informe_Estadistico_Egreso_Hospitalario_CARTA.pdf?ENC_ID=141704',
      label: 'el informe estadístico de egreso',
    });
    expect(markSessionVerified).toHaveBeenCalledWith(record);
    expect(downloadPdfBuffer).toHaveBeenCalledWith({
      buffer,
      filename: 'Egreso_estadistico_141704.pdf',
    });
  });

  it('rejects invalid episodes and session changes without downloading', async () => {
    const downloadPdfBuffer = vi.fn();
    const invalidFetch = fetcherRuntime.create({
      resolveSession: vi.fn(),
      fetchOfficialPdf: vi.fn(),
      markSessionVerified: vi.fn(),
    });
    const invalid = downloadRuntime.create({
      fetchReport: invalidFetch,
      downloadPdfBuffer,
    });
    await expect(invalid.download({ encId: '../other' })).resolves.toMatchObject({
      error: expect.stringContaining('episodio válido'),
    });

    const changedFetch = fetcherRuntime.create({
      resolveSession: vi.fn(async () => ({
        record: { apiBase: 'https://example.test/api', token: 't' },
      })),
      fetchOfficialPdf: vi.fn(async () => ({ buffer: new ArrayBuffer(1) })),
      markSessionVerified: vi.fn(async () => false),
    });
    const changed = downloadRuntime.create({
      fetchReport: changedFetch,
      downloadPdfBuffer,
    });
    await expect(changed.download({ encId: '141704' })).resolves.toMatchObject({
      error: expect.stringContaining('sesión cambió'),
    });
    expect(downloadPdfBuffer).not.toHaveBeenCalled();
  });

  it('returns base64 only for an exact episode authorized in the same HHR tab', async () => {
    const sender = { tab: { id: 44 }, origin: 'http://localhost:3000' };
    const buffer = Uint8Array.from([1, 2, 3]).buffer;
    const fetchReport = vi.fn(async () => ({ buffer }));
    const operation = evidenceRuntime.create({
      fetchReport,
      bufferToBase64: vi.fn(() => 'AQID'),
      isAuthorized: vi.fn((candidate, encId) => candidate === sender && encId === '142083'),
    });

    await expect(operation.read({ encId: '142083', sender })).resolves.toEqual({
      ok: true,
      base64: 'AQID',
    });
    await expect(operation.read({ encId: '142084', sender })).resolves.toEqual({
      error: 'El egreso individual no fue autorizado para esta sincronización.',
    });
    expect(fetchReport).toHaveBeenCalledOnce();
  });
});

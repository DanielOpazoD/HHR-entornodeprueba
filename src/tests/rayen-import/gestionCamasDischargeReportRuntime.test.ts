// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

interface Runtime {
  create: (dependencies: Record<string, unknown>) => {
    download: (input: { encId: string }) => Promise<Record<string, unknown>>;
  };
}

const context = vm.createContext({ URL });
vm.runInContext(
  readFileSync(path.resolve('extension/gestion-camas-discharge-report-runtime.js'), 'utf8'),
  context
);
const runtime = (context as unknown as { HhrGestionCamasDischargeReportRuntime: Runtime })
  .HhrGestionCamasDischargeReportRuntime;

describe('Gestión de Camas statistical-discharge report runtime', () => {
  it('downloads the exact episode PDF and revalidates the session', async () => {
    const record = { apiBase: 'https://hospbackend.rayensalud.cl/Hospitalizados/api/', token: 'secret' };
    const buffer = new ArrayBuffer(4);
    const fetchOfficialPdf = vi.fn(async () => ({ buffer }));
    const markSessionVerified = vi.fn(async () => true);
    const downloadPdfBuffer = vi.fn(async () => ({ downloaded: true }));
    const operation = runtime.create({
      resolveSession: vi.fn(async () => ({ record })),
      fetchOfficialPdf,
      markSessionVerified,
      downloadPdfBuffer,
    });

    await expect(operation.download({ encId: '141704' })).resolves.toEqual({
      downloaded: true,
      ok: true,
    });
    expect(fetchOfficialPdf).toHaveBeenCalledWith({
      url: 'https://hospbackend.rayensalud.cl/Hospitalizados/api/report/Informe_Estadistico_Egreso_Hospitalario_CARTA.pdf?ENC_ID=141704',
      token: 'secret',
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
    const invalid = runtime.create({
      resolveSession: vi.fn(),
      fetchOfficialPdf: vi.fn(),
      markSessionVerified: vi.fn(),
      downloadPdfBuffer,
    });
    await expect(invalid.download({ encId: '../other' })).resolves.toMatchObject({
      error: expect.stringContaining('episodio válido'),
    });

    const changed = runtime.create({
      resolveSession: vi.fn(async () => ({ record: { apiBase: 'https://example.test/api', token: 't' } })),
      fetchOfficialPdf: vi.fn(async () => ({ buffer: new ArrayBuffer(1) })),
      markSessionVerified: vi.fn(async () => false),
      downloadPdfBuffer,
    });
    await expect(changed.download({ encId: '141704' })).resolves.toMatchObject({
      error: expect.stringContaining('sesión cambió'),
    });
    expect(downloadPdfBuffer).not.toHaveBeenCalled();
  });
});

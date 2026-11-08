// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHarness, patientRun, runtime } from './clinicalAntecedentsRuntime.fixture';

const harness = (emergency = true) => {
  const h = createHarness();
  const downloadDau = vi.fn(
    async ({ assertAuthorization }: { assertAuthorization: () => Promise<void> }) => {
      await assertAuthorization();
      return { ok: true, opened: true };
    }
  );
  const fetchImpl = vi.fn(async (url: string, options?: { headers?: Record<string, string> }) =>
    url.includes('ObtenerDetalleHistorialClinicoPrimaria')
      ? {
          ok: true,
          json: async () => ({
            ObtenerDetalleHistorialClinicoResult: {
              RespuestaBase: { Estatus: 0 },
              DetalleHistorial: {
                IdAtencion: 8,
                Paciente: { Rut: patientRun },
                Formularios: emergency
                  ? { TypeFormulario: { Nombre: 'Examen Fisico Urgencia' } }
                  : {},
              },
            },
          }),
        }
      : h.fetchImpl(url, options)
  );
  const api = runtime.create({ ...h, fetchImpl, downloadDau });
  return { ...h, api, downloadDau };
};

describe('DAU selection is authorized by the HCC detail', () => {
  it('passes the verified patient and selected care to the official downloader', async () => {
    const h = harness();
    expect(
      await h.api.handleRequest({ encId: '12', operation: 'dau', entryId: 'Primaria:8' })
    ).toEqual({ ok: true, opened: true });
    expect(h.downloadDau).toHaveBeenCalledWith({
      patientRun,
      attentionId: '8',
      assertAuthorization: expect.any(Function),
    });
  });
  it('does not download an outpatient encounter', async () => {
    const h = harness(false);
    expect(
      await h.api.handleRequest({ encId: '12', operation: 'dau', entryId: 'Primaria:8' })
    ).toMatchObject({ ok: false });
    expect(h.downloadDau).not.toHaveBeenCalled();
  });
  it('does not resolve arbitrary care IDs from the HHR message', async () => {
    const h = harness();
    expect(
      await h.api.handleRequest({ encId: '12', operation: 'dau', entryId: 'Primaria:999' })
    ).toMatchObject({ ok: false });
    expect(h.downloadDau).not.toHaveBeenCalled();
  });
});

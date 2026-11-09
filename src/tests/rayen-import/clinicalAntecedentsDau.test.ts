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
  return { ...h, api, fetchImpl, downloadDau };
};

describe('DAU selection is authorized by the HCC detail', () => {
  it('shows the missing-session login before waiting for an uncached HCC history', async () => {
    const h = harness();
    h.getContext.mockRejectedValue(new Error('Synthetic HCC history is still unavailable'));
    const flowId = '00000000-0000-4000-8000-000000000001';
    const prompt = {
      ok: false,
      auth: {
        flowId,
        url: `chrome-extension://${'a'.repeat(32)}/urgency-login.html?flow=${flowId}`,
      },
    };
    const prepareDauLogin = vi.fn(async () => prompt);
    const api = runtime.create({ ...h, prepareDauLogin });
    expect(
      await api.handleRequest({ encId: '12', operation: 'dau', entryId: 'Primaria:8' })
    ).toEqual(prompt);
    expect(prepareDauLogin).toHaveBeenCalledOnce();
    expect(h.getContext).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
    expect(h.downloadDau).not.toHaveBeenCalled();
  });

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
  it.each([
    { emergency: true, entryId: 'Primaria:8', opened: true },
    { emergency: false, entryId: 'Primaria:8', opened: false },
    { emergency: true, entryId: 'Primaria:999', opened: false },
  ])(
    'still verifies the selected care after native access is ready: $entryId / $emergency',
    async ({ emergency, entryId, opened }) => {
      const h = harness(emergency);
      const prepareDauLogin = vi.fn(async () => null);
      const api = runtime.create({ ...h, prepareDauLogin });
      expect(await api.handleRequest({ encId: '12', operation: 'dau', entryId })).toMatchObject({
        ok: opened,
      });
      expect(prepareDauLogin).toHaveBeenCalledOnce();
      expect(h.downloadDau).toHaveBeenCalledTimes(opened ? 1 : 0);
    }
  );
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

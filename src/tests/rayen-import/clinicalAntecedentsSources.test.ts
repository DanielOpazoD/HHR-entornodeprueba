// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHarness, patientRun, runtime } from './clinicalAntecedentsRuntime.fixture';

describe('HCC VHCC-TICKET session authorization', () => {
  it.each(['outpatient', 'emergency'])(
    'loads %s history and detail when HCC requires the VHCC-TICKET scheme',
    async careType => {
      const h = createHarness();
      const original = h.fetchImpl.getMockImplementation()!;
      h.fetchImpl.mockImplementation(async (url, options) => {
        const response = await original(url, options);
        if (url.includes('ObtenerToken')) return response;
        if (options?.headers?.Authorization !== 'VHCC-TICKET fixture-session')
          return { ...response, ok: false, status: 401 };
        return {
          ...response,
          json: async () => {
            const data = await response.json();
            if (careType === 'emergency' && data.ObtenerDetalleHistorialClinicoResult) {
              const result = data.ObtenerDetalleHistorialClinicoResult;
              return {
                ...data,
                ObtenerDetalleHistorialClinicoResult: {
                  ...result,
                  DetalleHistorial: {
                    ...result.DetalleHistorial,
                    Formularios: { TypeFormulario: { Nombre: 'Examen Fisico Urgencia' } },
                  },
                },
              };
            }
            return data;
          },
        };
      });

      const history = await h.api.handleRequest({ encId: '12', operation: 'list' });
      expect(history).toMatchObject({ ok: true, warnings: [], unavailableSources: [] });
      expect(history.entries).toHaveLength(1);
      const detail = await h.api.handleRequest({
        encId: '12',
        operation: 'detail',
        entryId: 'Primaria:8',
      });
      expect(detail).toMatchObject({
        ok: true,
        detail: { careType, history: 'Historia sintética' },
      });

      const tokenRequest = h.fetchImpl.mock.calls.find(([url]) => url.includes('ObtenerToken'));
      expect(tokenRequest?.[1]?.headers?.Authorization).toBeUndefined();
      const authorizedRequests = h.fetchImpl.mock.calls.filter(
        ([url]) => !url.includes('ObtenerToken')
      );
      expect(authorizedRequests).toHaveLength(3);
      expect(
        authorizedRequests.every(
          ([, options]) => options?.headers?.Authorization === 'VHCC-TICKET fixture-session'
        )
      ).toBe(true);
      expect(authorizedRequests.every(([url]) => !url.includes('fixture-session'))).toBe(true);
      expect(JSON.stringify({ history, detail })).not.toMatch(
        /VHCC-TICKET|fixture-session|fixture-access|TokenSesion/
      );
    }
  );

  it('keeps the token of each history during interleaved episode reads', async () => {
    const h = createHarness();
    const original = h.fetchImpl.getMockImplementation()!;
    let issued = 0;
    h.fetchImpl.mockImplementation(async (url, options) => {
      if (url.includes('ObtenerToken')) {
        issued += 1;
        const value = issued === 1 ? 'example' : issued === 2 ? 'dummy' : 'fake';
        return {
          ok: true,
          json: async () => ({ ObtenerTokenSesionResult: { TokenSesion: value } }),
        };
      }
      return original(url, options);
    });

    await h.api.handleRequest({ encId: '12', operation: 'list' });
    await h.api.handleRequest({ encId: '13', operation: 'list' });
    await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Primaria:8' });
    const summaries = h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'));
    expect(summaries.map(([, options]) => options?.headers?.Authorization)).toEqual([
      'VHCC-TICKET example',
      'VHCC-TICKET example',
      'VHCC-TICKET dummy',
      'VHCC-TICKET dummy',
    ]);
    const details = h.fetchImpl.mock.calls.filter(([url]) => url.includes('Detalle'));
    expect(details[0]?.[1]?.headers?.Authorization).toBe('VHCC-TICKET example');

    h.getAuthorizationKey.mockResolvedValue('tab:renewed-session');
    await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Primaria:8' });
    const renewedDetail = h.fetchImpl.mock.calls.filter(([url]) => url.includes('Detalle')).at(-1);
    expect(renewedDetail?.[1]?.headers?.Authorization).toBe('VHCC-TICKET fake');
  });

  it.each(['', '   '])(
    'rejects an empty viewer token before requesting clinical data: %j',
    async token => {
      const h = createHarness();
      h.fetchImpl.mockResolvedValue({
        ok: true,
        json: async () => ({ ObtenerTokenSesionResult: { TokenSesion: token } }),
      });
      const result = await h.api.handleRequest({ encId: '12', operation: 'list' });
      expect(result).toEqual({ ok: false, error: 'La sesión del visor de antecedentes venció.' });
      expect(h.fetchImpl).toHaveBeenCalledOnce();
    }
  );
});

describe('DAU selection is authorized by the HCC detail', () => {
  const dauHarness = (emergency = true) => {
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

  it('shows the missing-session login before waiting for an uncached HCC history', async () => {
    const h = dauHarness();
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
    const h = dauHarness();
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
      const h = dauHarness(emergency);
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
    const h = dauHarness(false);
    expect(
      await h.api.handleRequest({ encId: '12', operation: 'dau', entryId: 'Primaria:8' })
    ).toMatchObject({ ok: false });
    expect(h.downloadDau).not.toHaveBeenCalled();
  });

  it('does not resolve arbitrary care IDs from the HHR message', async () => {
    const h = dauHarness();
    expect(
      await h.api.handleRequest({ encId: '12', operation: 'dau', entryId: 'Primaria:999' })
    ).toMatchObject({ ok: false });
    expect(h.downloadDau).not.toHaveBeenCalled();
  });
});

describe('HCC secondary history and details', () => {
  const urgencyId = 'DAU202609081234-UA101';
  const urgencyEntryId = `UA101~${urgencyId}`;
  const secondaryRow = (id: string, type = 'Urgencias', facilityCode = 'UA101') => ({
    IdentificadorAtencion: id,
    TipoAtencion: type,
    CodEstablecimientoAtencion: facilityCode,
    FechaHoraAtencion: '2026-09-08 12:00',
    HistorialResumido: { Resumen: { Episodio: {} } },
  });
  const secondaryDetail = (id: string, type = 'Urgencia') => ({
    ObtenerDetalleHistorialClinicoResult: {
      RespuestaBase: { Status: 0 },
      XMLDetalleHistoria: {
        DetalleEpisodio: {
          Paciente: { RUT: Number(patientRun), NombreCompleto: 'Paciente sintético' },
          Episodio: {
            IdEpisodio: id,
            TipoEpisodio: type,
            Resumen: 'Resumen clínico sintético',
            Anamnesis: { MotivoConsultaAnamnesis: 'Consulta sintética' },
            Diagnosticos: { DescripcionDiagnostico: 'Diagnóstico sintético' },
            ProfesionalPrestador: { NombreCompleto: 'Profesional sintético' },
          },
        },
      },
    },
  });
  const secondaryHarness = (
    detail: unknown = secondaryDetail(urgencyId),
    rows = [secondaryRow(urgencyId), secondaryRow('8', 'Hospitalizacion')],
    resolveDetail?: (url: string) => unknown
  ) => {
    const h = createHarness();
    const fetchImpl = vi.fn(async (url: string, options?: { headers?: Record<string, string> }) => {
      const path = new URL(url).pathname;
      if (path.includes('ResumenHistorialClinicoSecundaria'))
        return {
          ok: true,
          json: async () => ({
            ObtenerResumenHistorialClinicoResult: {
              RespuestaBase: { Status: 0 },
              Paciente: { IdentificacionPaciente: { Run: patientRun } },
              ResumenHistorial: { ResumenHistorial: rows },
            },
          }),
        };
      if (path.includes('DetalleHistorialClinicoSecundaria'))
        return { ok: true, json: async () => (resolveDetail ? resolveDetail(url) : detail) };
      return h.fetchImpl(url, options);
    });
    const api = runtime.create({
      getContext: h.getContext,
      readJson: h.readJson,
      getAuthorizationKey: h.getAuthorizationKey,
      openTab: h.openTab,
      fetchImpl,
      now: () => new Date('2026-09-08T18:00:00Z'),
    });
    return { ...h, api, fetchImpl };
  };

  it('keeps the secondary wrapper and opaque urgency identifiers alongside primary records', async () => {
    const h = secondaryHarness();
    const result = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'Primaria', id: '8' }),
        expect.objectContaining({ source: 'Secundaria', id: urgencyEntryId }),
        expect.objectContaining({ source: 'Secundaria', id: 'UA101~8' }),
      ])
    );
    expect(result.entries).toHaveLength(3);
    expect(JSON.stringify(result)).not.toMatch(/facilityCode|attentionId/);
  });

  it('loads a secondary urgency with its own request and response contract', async () => {
    const h = secondaryHarness();
    const result = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: `Secundaria:${urgencyEntryId}`,
    });
    expect(result).toMatchObject({
      ok: true,
      detail: {
        careType: 'emergency',
        reason: 'Consulta sintética',
        summary: 'Resumen clínico sintético',
        diagnoses: ['Diagnóstico sintético'],
        professional: 'Profesional sintético',
      },
    });
    const request = h.fetchImpl.mock.calls.find(([url]) =>
      url.includes('DetalleHistorialClinicoSecundaria')
    );
    expect(request).toBeDefined();
    const params = JSON.parse(new URL(request![0]).searchParams.get('ParametroFUC')!);
    expect(params).toMatchObject({
      IdAtencion: urgencyId,
      ParametroBase: { CodigoEstablecimientoConsulta: 'UA101', Key: '1' },
    });
    expect(params).not.toHaveProperty('IdentificacionAtencion');
    expect(request![1]?.headers?.Authorization).toBe('VHCC-TICKET fixture-session');
    expect(JSON.stringify(result)).not.toMatch(/XMLDetalleHistoria|VHCC-TICKET|fixture-session/);
  });

  it('isolates equal numeric identifiers by source and preserves hospitalization type', async () => {
    const h = secondaryHarness(secondaryDetail('8', 'Hospitalizacion'));
    const primary = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Primaria:8',
    });
    const secondary = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Secundaria:UA101~8',
    });
    expect(primary).toMatchObject({ ok: true, detail: { careType: 'outpatient' } });
    expect(secondary).toMatchObject({ ok: true, detail: { careType: 'hospitalization' } });
  });

  it('keeps equal secondary IDs from different establishments as separate encounters', async () => {
    const h = secondaryHarness(
      undefined,
      [secondaryRow('8', 'Urgencias', 'UA101'), secondaryRow('8', 'Urgencias', 'UA102')],
      url => {
        const params = JSON.parse(new URL(url).searchParams.get('ParametroFUC')!);
        const value = secondaryDetail('8');
        value.ObtenerDetalleHistorialClinicoResult.XMLDetalleHistoria.DetalleEpisodio.Episodio.Resumen = `Resumen ${params.ParametroBase.CodigoEstablecimientoConsulta}`;
        return value;
      }
    );
    const list = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(list.entries).toHaveLength(3);
    const first = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Secundaria:UA101~8',
    });
    const second = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Secundaria:UA102~8',
    });
    expect(first).toMatchObject({ ok: true, detail: { summary: 'Resumen UA101' } });
    expect(second).toMatchObject({ ok: true, detail: { summary: 'Resumen UA102' } });
    expect(
      h.fetchImpl.mock.calls.filter(([url]) => url.includes('DetalleHistorialClinicoSecundaria'))
    ).toHaveLength(2);
  });

  it.each(['', 'bad:facility', 'https://example.test'])(
    'rejects a secondary source with invalid facility %s before exposing identities',
    async facilityCode => {
      const h = secondaryHarness(undefined, [secondaryRow('8', 'Urgencias', facilityCode)]);
      const result = await h.api.handleRequest({ encId: '12', operation: 'list' });
      expect(result.entries).toEqual([expect.objectContaining({ source: 'Primaria', id: '8' })]);
      expect(result.unavailableSources).toEqual(['Secundaria']);
      expect(result.warnings).toHaveLength(1);
      expect(
        (await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Secundaria:8' }))
          .ok
      ).toBe(false);
      expect(
        h.fetchImpl.mock.calls.some(([url]) => url.includes('DetalleHistorialClinicoSecundaria'))
      ).toBe(false);
    }
  );

  it.each(['patient', 'episode', 'status', 'missing'])(
    'rejects an unverifiable secondary %s',
    async problem => {
      const value = secondaryDetail(urgencyId);
      if (problem === 'patient')
        value.ObtenerDetalleHistorialClinicoResult.XMLDetalleHistoria.DetalleEpisodio.Paciente.RUT = 222222222;
      if (problem === 'episode')
        value.ObtenerDetalleHistorialClinicoResult.XMLDetalleHistoria.DetalleEpisodio.Episodio.IdEpisodio =
          'other';
      if (problem === 'status') value.ObtenerDetalleHistorialClinicoResult.RespuestaBase.Status = 2;
      const h = secondaryHarness(problem === 'missing' ? {} : value);
      const result = await h.api.handleRequest({
        encId: '12',
        operation: 'detail',
        entryId: `Secundaria:${urgencyEntryId}`,
      });
      expect(result.ok).toBe(false);
      expect(result.detail).toBeUndefined();
    }
  );
});

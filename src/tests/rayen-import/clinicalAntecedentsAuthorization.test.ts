// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHarness } from './clinicalAntecedentsRuntime.fixture';

describe('HCC session authorization', () => {
  it.each(['outpatient', 'emergency'])(
    'loads %s history and detail when HCC requires its session token',
    async careType => {
      const h = createHarness();
      const original = h.fetchImpl.getMockImplementation()!;
      h.fetchImpl.mockImplementation(async (url, options) => {
        const response = await original(url, options);
        if (url.includes('ObtenerToken')) return response;
        if (options?.headers?.Authorization !== 'fixture-session')
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
          ([, options]) => options?.headers?.Authorization === 'fixture-session'
        )
      ).toBe(true);
      expect(authorizedRequests.every(([url]) => !url.includes('fixture-session'))).toBe(true);
      expect(JSON.stringify({ history, detail })).not.toMatch(
        /fixture-session|fixture-access|TokenSesion/
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
      'example',
      'example',
      'dummy',
      'dummy',
    ]);
    const details = h.fetchImpl.mock.calls.filter(([url]) => url.includes('Detalle'));
    expect(details[0]?.[1]?.headers?.Authorization).toBe('example');

    h.getAuthorizationKey.mockResolvedValue('tab:renewed-session');
    await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Primaria:8' });
    const renewedDetail = h.fetchImpl.mock.calls.filter(([url]) => url.includes('Detalle')).at(-1);
    expect(renewedDetail?.[1]?.headers?.Authorization).toBe('fake');
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

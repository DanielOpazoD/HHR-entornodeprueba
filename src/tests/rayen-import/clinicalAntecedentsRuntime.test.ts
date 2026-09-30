// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createHarness,
  patientRun,
  attachmentId,
  visorUrl,
} from './clinicalAntecedentsRuntime.fixture';

describe('clinical antecedents runtime', () => {
  it('compone una sola instancia persistente en el service worker', () => {
    const background = readFileSync('extension/background.js', 'utf8');
    expect(background.match(/HhrClinicalAntecedents\.create/g)).toHaveLength(1);
    expect(background).toContain(
      'clinicalAntecedentsRuntime.handleRequest({ ...message, sender })'
    );
  });
  it.each([
    ['2026-09-08T18:00:00Z', '20231008', '20260908'],
    ['2026-01-31T18:00:00Z', '20230228', '20260131'],
    ['2027-01-31T18:00:00Z', '20240229', '20270131'],
    ['2026-09-09T02:00:00Z', '20231008', '20260908'],
  ])(
    'respeta ventanas de 35 meses y el día local de Isla de Pascua: %s',
    async (instant, start, end) => {
      const h = createHarness(instant);
      await h.api.handleRequest({ encId: '12', operation: 'list' });
      const requests = h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'));
      expect(requests).toHaveLength(2);
      for (const [url] of requests) {
        const params = JSON.parse(new URL(url).searchParams.get('ParametroFUC')!);
        expect(params).toMatchObject({ FechaInicio: start, FechaTermino: end });
      }
    }
  );
  it('permite consultar ventanas anteriores sin huecos ni peticiones de más de 35 meses', async () => {
    const h = createHarness();
    const first = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(first).toMatchObject({ windowStart: '20231008', windowEnd: '20260908' });
    expect(first.nextBeforeDate).toBe('20231007');
    const older = await h.api.handleRequest({
      encId: '12',
      operation: 'list',
      beforeDate: first.nextBeforeDate!,
    });
    expect(older).toMatchObject({ windowStart: '20201107', windowEnd: '20231007' });
    expect(older.nextBeforeDate).toBe('20201106');
    const requests = h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'));
    expect(requests).toHaveLength(4);
    const olderParams = JSON.parse(new URL(requests[2][0]).searchParams.get('ParametroFUC')!);
    expect(olderParams).toMatchObject({ FechaInicio: '20201107', FechaTermino: '20231007' });
    expect(older.entries).toMatchObject([{ windowEnd: '20231007' }]);
    const detail = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Primaria:8',
      beforeDate: older.windowEnd,
    });
    expect(detail.ok).toBe(true);
    expect(h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'))).toHaveLength(
      4
    );
  });
  it('rechaza un cursor inválido antes de acceder a la ficha o al visor', async () => {
    const h = createHarness();
    const result = await h.api.handleRequest({
      encId: '12',
      operation: 'list',
      beforeDate: '20990101',
    });
    expect(result.ok).toBe(false);
    expect(h.getContext).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });
  it('termina la paginación histórica en el límite inferior sin repetir ventanas', async () => {
    const h = createHarness();
    const result = await h.api.handleRequest({
      encId: '12',
      operation: 'list',
      beforeDate: '19000101',
    });
    expect(result).toMatchObject({ ok: true, windowStart: '19000101', windowEnd: '19000101' });
    expect(result.nextBeforeDate).toBeNull();
  });
  it('normaliza una sola atención y una fuente sin atenciones sin filtrar URLs ni credenciales', async () => {
    const h = createHarness();
    const result = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-access|fixture-session|access_token|patientIdentifier/
    );
  });
  it('conserva primaria y describe sin falsa alarma el vencimiento de secundaria', async () => {
    const h = createHarness();
    const original = h.fetchImpl.getMockImplementation()!;
    h.fetchImpl.mockImplementation((url, options) => {
      if (!url.includes('Secundaria')) return original(url, options);
      return Promise.reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
    });
    const result = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.warnings).toEqual([
      'El historial de atención secundaria no respondió dentro de 45 segundos. Los antecedentes cargados siguen disponibles.',
    ]);
    expect(result.unavailableSources).toEqual(['Secundaria']);
    const detail = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Primaria:8',
    });
    expect(detail.ok).toBe(true);
    expect(h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'))).toHaveLength(
      2
    );
    await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'))).toHaveLength(
      4
    );
  });
  it('espera la respuesta secundaria válida de 33 segundos observada sin alertar ni repetirla', async () => {
    vi.useFakeTimers();
    try {
      const h = createHarness();
      const original = h.fetchImpl.getMockImplementation()!;
      h.fetchImpl.mockImplementation((url, options) =>
        url.includes('Secundaria')
          ? new Promise((resolve, reject) =>
              setTimeout(() => {
                if ((options as RequestInit | undefined)?.signal?.aborted)
                  reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
                else resolve(original(url, options));
              }, 33000)
            )
          : original(url, options)
      );
      const pending = h.api.handleRequest({ encId: '12', operation: 'list' });
      await vi.advanceTimersByTimeAsync(33001);
      expect((await pending).warnings).toEqual([]);
      await h.api.handleRequest({ encId: '12', operation: 'list' });
      expect(
        h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'))
      ).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('comparte reintentos simultáneos y sirve el detalle verificado durante una lectura secundaria lenta', async () => {
    vi.useFakeTimers();
    try {
      const h = createHarness();
      const original = h.fetchImpl.getMockImplementation()!;
      h.fetchImpl.mockImplementation((url, options) =>
        url.includes('Secundaria')
          ? Promise.reject(Object.assign(new Error('timeout'), { name: 'AbortError' }))
          : original(url, options)
      );
      expect((await h.api.handleRequest({ encId: '12', operation: 'list' })).warnings).toHaveLength(
        1
      );
      h.fetchImpl.mockImplementation((url, options) =>
        url.includes('Secundaria')
          ? new Promise(resolve => setTimeout(() => resolve(original(url, options)), 33000))
          : original(url, options)
      );
      const first = h.api.handleRequest({ encId: '12', operation: 'list' });
      const second = h.api.handleRequest({ encId: '12', operation: 'list' });
      const detail = await h.api.handleRequest({
        encId: '12',
        operation: 'detail',
        entryId: 'Primaria:8',
      });
      expect(detail.ok).toBe(true);
      expect(
        h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'))
      ).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(33001);
      expect((await first).warnings).toEqual([]);
      expect((await second).warnings).toEqual([]);
      expect(
        h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'))
      ).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });
  it('conserva una fuente verificada cuando fallan fuentes alternadas y reemplaza una fuente vacía válida', async () => {
    const h = createHarness();
    const original = h.fetchImpl.getMockImplementation()!;
    h.fetchImpl.mockImplementation((url, options) =>
      url.includes('Secundaria') ? Promise.reject(new Error('offline')) : original(url, options)
    );
    expect((await h.api.handleRequest({ encId: '12', operation: 'list' })).entries).toHaveLength(1);
    h.fetchImpl.mockImplementation((url, options) =>
      url.includes('ResumenHistorialClinicoPrimaria')
        ? Promise.reject(new Error('offline'))
        : original(url, options)
    );
    const retry = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(retry.unavailableSources).toEqual(['Primaria']);
    expect(retry.entries).toHaveLength(1);
    expect(
      (await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Primaria:8' })).ok
    ).toBe(true);
    h.fetchImpl.mockImplementation((url, options) =>
      original(
        url.replace('ResumenHistorialClinicoPrimaria', 'ResumenHistorialClinicoSecundaria'),
        options
      )
    );
    const complete = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(complete.warnings).toEqual([]);
    expect(complete.entries).toEqual([]);
    expect(
      (await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Primaria:8' })).ok
    ).toBe(false);
  });
  it('rechaza el detalle que no pertenece al historial del episodio', async () => {
    const h = createHarness();
    const result = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Primaria:999',
    });
    expect(result.ok).toBe(false);
    expect(h.fetchImpl.mock.calls.some(([url]) => url.includes('Detalle'))).toBe(false);
  });
  it('rechaza un identificador universal distinto aunque coincida el RUN del enlace', async () => {
    const h = createHarness();
    const original = h.readJson.getMockImplementation()!;
    h.readJson.mockImplementation(async input =>
      input.path === '/api/visorHCC'
        ? {
            data: {
              respuestaObtenerURLVisorHCC: { url: visorUrl.replace(btoa('77'), btoa('99')) },
            },
          }
        : original(input)
    );
    expect((await h.api.handleRequest({ encId: '12', operation: 'list' })).ok).toBe(false);
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });
  it('informa una respuesta incompatible sin filtrar su contenido', async () => {
    const h = createHarness();
    const original = h.fetchImpl.getMockImplementation()!;
    h.fetchImpl.mockImplementation(async (url, options) =>
      url.includes('Primaria')
        ? {
            ok: true,
            json: async () => {
              throw new SyntaxError('sensitive response');
            },
          }
        : original(url, options)
    );
    const result = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(result.warnings?.join()).toContain('respuesta no JSON');
    expect(JSON.stringify(result)).not.toContain('sensitive response');
  });
  it('rechaza una fuente HCC que omite la identidad del paciente', async () => {
    const h = createHarness();
    const original = h.fetchImpl.getMockImplementation()!;
    h.fetchImpl.mockImplementation(async (url, options) => {
      const response = await original(url, options);
      if (!url.includes('Primaria')) return response;
      return {
        ...response,
        json: async () => {
          const data = await response.json();
          const result = data.ObtenerResumenHistorialClinicoResult as Record<string, unknown>;
          result.Paciente = undefined;
          return data;
        },
      };
    });
    const result = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(result.entries).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
  it('devuelve el detalle de la atención previamente comprobada', async () => {
    const h = createHarness();
    const result = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Primaria:8',
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toMatchObject({
      history: 'Historia sintética',
      attachments: [{ id: attachmentId, label: 'Informe sintético.pdf' }],
    });
    expect(JSON.stringify(result.detail)).not.toMatch(/blob|temporary-secret/);
  });
  it('abre internamente un adjunto validado sin devolver su URL firmada a HHR', async () => {
    const h = createHarness();
    const result = await h.api.handleRequest({
      encId: '12',
      operation: 'attachment',
      entryId: `Primaria:8:${attachmentId}`,
    });
    expect(result).toEqual({ ok: true, opened: true });
    expect(h.openTab).toHaveBeenCalledOnce();
    expect(h.openTab.mock.calls[0][0].url).toContain(
      'https://gestordocumentalrayen.blob.core.windows.net/fixture/document.pdf?'
    );
  });
  it('no inventa adjuntos cuando Eloísa devuelve un objeto de documento vacío', async () => {
    const h = createHarness('2026-09-08T18:00:00Z', '');
    const result = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Primaria:8',
    });
    expect(result.detail).toMatchObject({ attachments: [] });
  });
  it('deduplica resumen y detalle cuando React repite solicitudes simultáneas', async () => {
    const h = createHarness();
    await h.api.handleRequest({ encId: '12', operation: 'list' });
    await Promise.all(
      Array.from({ length: 6 }, () =>
        h.api.handleRequest({
          encId: '12',
          operation: 'detail',
          entryId: 'Primaria:8',
        })
      )
    );
    expect(h.readJson.mock.calls.filter(([input]) => input.path === '/api/visorHCC')).toHaveLength(
      1
    );
    expect(h.fetchImpl.mock.calls.filter(([url]) => url.includes('ObtenerToken'))).toHaveLength(1);
    expect(h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'))).toHaveLength(
      2
    );
    expect(h.fetchImpl.mock.calls.filter(([url]) => url.includes('Detalle'))).toHaveLength(1);
  });
  it('no reutiliza resultados después de cambiar la sesión autorizada', async () => {
    const h = createHarness();
    await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Primaria:8' });
    h.getAuthorizationKey.mockResolvedValue('tab:new-session');
    await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Primaria:8' });
    expect(h.fetchImpl.mock.calls.filter(([url]) => url.includes('ResumenHistorial'))).toHaveLength(
      4
    );
    expect(h.fetchImpl.mock.calls.filter(([url]) => url.includes('Detalle'))).toHaveLength(2);
  });
  it('descarta una lectura si la sesión cambia mientras se consulta el historial', async () => {
    const h = createHarness();
    h.getAuthorizationKey
      .mockResolvedValueOnce('tab:old-session')
      .mockResolvedValue('tab:new-session');
    const result = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(result).toMatchObject({
      ok: false,
      error: 'La sesión clínica cambió durante la consulta de antecedentes.',
    });
    expect(result.entries).toBeUndefined();
  });
  it('descarta el detalle si la sesión cambia durante su lectura', async () => {
    const h = createHarness();
    h.getAuthorizationKey
      .mockResolvedValueOnce('tab:stable-session')
      .mockResolvedValueOnce('tab:stable-session')
      .mockResolvedValue('tab:new-session');
    const result = await h.api.handleRequest({
      encId: '12',
      operation: 'detail',
      entryId: 'Primaria:8',
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'La sesión clínica cambió durante la consulta de antecedentes.',
    });
    expect(result.detail).toBeUndefined();
  });
  it('elimina el detalle clínico cuando vence su caché breve', async () => {
    vi.useFakeTimers();
    try {
      const h = createHarness();
      await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Primaria:8' });
      await vi.advanceTimersByTimeAsync(30001);
      await h.api.handleRequest({ encId: '12', operation: 'detail', entryId: 'Primaria:8' });
      expect(h.fetchImpl.mock.calls.filter(([url]) => url.includes('Detalle'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rechaza adjuntos fuera del almacenamiento oficial', async () => {
    const h = createHarness('2026-09-08T18:00:00Z', 'https://untrusted.example/document.pdf');
    expect(
      (
        await h.api.handleRequest({
          encId: '12',
          operation: 'attachment',
          entryId: `Primaria:8:${attachmentId}`,
        })
      ).ok
    ).toBe(false);
    expect(h.openTab).not.toHaveBeenCalled();
  });
  it('no consulta el visor si Eloísa devuelve otro paciente', async () => {
    const h = createHarness();
    h.readJson.mockResolvedValueOnce({ data: { id: '99' } });
    expect((await h.api.handleRequest({ encId: '12', operation: 'list' })).ok).toBe(false);
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });
  it('conserva los resultados de la otra fuente y advierte una caída parcial', async () => {
    const h = createHarness();
    const original = h.fetchImpl.getMockImplementation()!;
    h.fetchImpl.mockImplementation(async (url, options) => {
      if (url.includes('Secundaria')) throw new Error('HTTP 503');
      return original(url, options);
    });
    const result = await h.api.handleRequest({ encId: '12', operation: 'list' });
    expect(result.entries).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
  it('impide abrir un destino de urgencias ajeno al visor oficial', async () => {
    const h = createHarness();
    h.readJson
      .mockResolvedValueOnce({ data: { id: '42', preferredIdentifierCode: patientRun } })
      .mockResolvedValueOnce({ data: { url: 'https://untrusted.example/visor/' } });
    expect((await h.api.handleRequest({ encId: '12', operation: 'urgency' })).ok).toBe(false);
    expect(h.openTab).not.toHaveBeenCalled();
  });
});

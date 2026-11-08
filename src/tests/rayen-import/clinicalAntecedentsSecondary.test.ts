// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHarness, patientRun, runtime } from './clinicalAntecedentsRuntime.fixture';

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
const harness = (
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
            ResumenHistorial: {
              ResumenHistorial: rows,
            },
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

describe('HCC secondary history and details', () => {
  it('keeps the secondary wrapper and opaque urgency identifiers alongside primary records', async () => {
    const h = harness();
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
    const h = harness();
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
    const h = harness(secondaryDetail('8', 'Hospitalizacion'));
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
    const h = harness(
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
      const h = harness(undefined, [secondaryRow('8', 'Urgencias', facilityCode)]);
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
      const h = harness(problem === 'missing' ? {} : value);
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

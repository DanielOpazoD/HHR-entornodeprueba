import { vi } from 'vitest';
import '../../../extension/clinical-antecedents-attachment.js';
import '../../../extension/clinical-antecedents-fields.js';
import '../../../extension/clinical-antecedents-cache.js';
import '../../../extension/clinical-antecedents-detail.js';
import '../../../extension/clinical-antecedents-window.js';
import '../../../extension/clinical-antecedents-runtime.js';

type Result = {
  ok: boolean;
  error?: string;
  entries?: unknown[];
  warnings?: string[];
  unavailableSources?: string[];
  detail?: unknown;
  windowStart?: string;
  windowEnd?: string;
  nextBeforeDate?: string | null;
};
type Dependencies = {
  now?: () => Date;
  getContext: (...args: unknown[]) => Promise<unknown>;
  readJson: (input: { path: string }) => Promise<unknown>;
  fetchImpl: (url: string, options?: { headers?: Record<string, string> }) => Promise<unknown>;
  openTab: (input: { url: string }) => Promise<unknown>;
  getAuthorizationKey: () => Promise<string>;
};
const runtime = (
  globalThis as typeof globalThis & {
    HhrClinicalAntecedents: {
      create: (deps: Dependencies) => {
        handleRequest: (input: {
          encId: string;
          operation: string;
          entryId?: string;
          beforeDate?: string;
        }) => Promise<Result>;
      };
    };
  }
).HhrClinicalAntecedents;
export const patientRun = '111111111';
export const attachmentId = btoa(encodeURIComponent('2\0document.pdf'))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
export const visorUrl = `https://visor.saludenred.cl/#/${btoa(patientRun)}/${btoa('1')}/${btoa('77')}/fixture-access`;
export const createHarness = (
  instant = '2026-09-08T18:00:00Z',
  documentUri = 'https://gestordocumentalrayen.blob.core.windows.net/fixture'
) => {
  const getContext = vi.fn(async () => ({ patientId: '42', info: {} }));
  const readJson = vi.fn(
    async ({ path }: { path: string }): Promise<{ data: unknown }> => ({
      data:
        path === '/api/visorHCC'
          ? { respuestaObtenerURLVisorHCC: { url: visorUrl } }
          : path === '/api/viau'
            ? { url: 'https://viau.ssmso.cl/visor/?access_token=fixture' }
            : {
                id: '42',
                preferredIdentifierCode: patientRun,
                prefferedPeridentId: 2,
                patientIdentifier: [{ peridentId: 7, identifierCode: '77', deleted: false }],
              },
    })
  );
  const fetchImpl = vi.fn(async (url: string, options?: { headers?: Record<string, string> }) => ({
    ok: true,
    json: async () => {
      if (!options?.headers?.Accept?.includes('application/json'))
        throw new SyntaxError('Unexpected token <');
      if (url.includes('ObtenerToken'))
        return { ObtenerTokenSesionResult: { TokenSesion: 'fixture-session' } };
      if (url.includes('Detalle'))
        return {
          ObtenerDetalleHistorialClinicoResult: {
            RespuestaBase: { Estatus: 0 },
            DetalleHistorial: {
              IdAtencion: 8,
              Paciente: { Rut: patientRun },
              Anamnesis: {
                HistoriaEnfermedadAnamnesis: 'Historia sintética',
                MotivoConsultaAnamnesis: 'Control',
              },
              DiagnosticosAtencion: {
                DetalleHistorialAtencionesDiagnosticoAtencion: {
                  DescripcionDiagnostico: 'Diagnóstico que no debe repetirse',
                },
              },
              Documentos: {
                Documento: {
                  Cgd_Id: 2,
                  NombreArchivo: 'Informe sintético.pdf',
                  PathAzure: 'document.pdf',
                },
                Uri: documentUri,
                Sas: 'sv=fixture&sr=c&sp=r&se=2099-01-01&sig=temporary-secret',
              },
            },
          },
        };
      return {
        ObtenerResumenHistorialClinicoResult: {
          RespuestaBase: { Estatus: 0 },
          Paciente: { IdentificacionPaciente: { Run: patientRun } },
          ResumenHistorial: url.includes('Secundaria')
            ? 0
            : {
                TypeResumenHistorial: {
                  IdentificadorAtencion: 8,
                  TipoAtencion: 'Ambulatoria',
                  HistorialResumido: {
                    ResumenHistorialAtenciones: { IdAtencion: 8, FechaHoraInicio: '2026-09-08' },
                  },
                },
              },
        },
      };
    },
  }));
  const openTab = vi.fn(async (_input: { url: string }) => ({}));
  const getAuthorizationKey = vi.fn(async () => 'tab:session-fixture');
  return {
    getContext,
    readJson,
    fetchImpl,
    openTab,
    getAuthorizationKey,
    api: runtime.create({
      getContext,
      readJson,
      fetchImpl,
      openTab,
      getAuthorizationKey,
      now: () => new Date(instant),
    }),
  };
};

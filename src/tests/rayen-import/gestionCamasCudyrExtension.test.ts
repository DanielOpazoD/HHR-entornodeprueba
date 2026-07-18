// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../../../extension/gestion-camas-cudyr.js';

const cudyr = (
  globalThis as typeof globalThis & {
    HhrGestionCamasCudyr: {
      buildSnapshot: (input: Record<string, unknown>) => Array<Record<string, unknown>>;
      mergeEncounterSnapshots: (
        official: Array<Record<string, unknown>>,
        fallback: Array<Record<string, unknown>>
      ) => Array<Record<string, unknown>>;
    };
  }
).HhrGestionCamasCudyr;

describe('Gestión de Camas CUDYR normalizer', () => {
  it('preserves official bed history when optional author and definition metadata fail', async () => {
    const source = readFileSync(
      new URL('../../../extension/background.js', import.meta.url),
      'utf8'
    );
    const start = source.indexOf('const fetchGestionCamasCudyrCategories = async');
    const end = source.indexOf('\n\nconst resolveCudyrCategories', start);
    if (start < 0 || end < 0) throw new Error('No se encontró el lector CUDYR oficial.');
    const beds = [{ bedEncounterMapping: { encounterMapping: { encounter: { id: 901 } } } }];
    const context = vm.createContext({
      Date,
      encodeURIComponent,
      resolveGestionCamasSession: async () => ({
        record: {
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
          token: 'fixture',
        },
      }),
      fetchWithTimeout: async (url: string) => {
        if (url.endsWith('/beds')) {
          return { ok: true, status: 200, json: async () => beds };
        }
        if (url.includes('/healthCarePractitioners')) {
          return { ok: false, status: 503, json: async () => [] };
        }
        throw new Error('Definitions unavailable');
      },
      handleGestionCamasUnauthorized: async () => false,
      HhrGestionCamasCudyr: {
        buildSnapshot: (input: Record<string, unknown>) => [input],
      },
    });
    Object.assign(context, { self: context });
    vm.runInContext(
      `${source.slice(start, end)}\nglobalThis.__fetchCudyr = fetchGestionCamasCudyrCategories;`,
      context
    );
    const result = await (
      context as unknown as { __fetchCudyr: () => Promise<Record<string, unknown>> }
    ).__fetchCudyr();

    expect(result).toMatchObject({
      source: 'gestion_camas',
      historyAvailable: true,
      items: [{ beds, practitioners: [], definitions: [] }],
    });
    expect(String(result.warning)).toContain('autores CUDYR');
    expect(String(result.warning)).toContain('definiciones CUDYR');
  });

  it('keeps official metadata warnings when Ficha Médico is unavailable', async () => {
    const source = readFileSync(
      new URL('../../../extension/background.js', import.meta.url),
      'utf8'
    );
    const start = source.indexOf('const handleCudyrCategoriesRequest = async');
    const end = source.indexOf('\n\nconst syslabRuntime', start);
    if (start < 0 || end < 0) throw new Error('No se encontró el manejador CUDYR.');
    const context = vm.createContext({
      getFichaFetchInfo: async () => ({ error: 'Ficha Médico no disponible.' }),
      fetchGestionCamasCudyrCategories: async () => ({
        items: [{ encId: '901' }],
        source: 'gestion_camas',
        historyAvailable: true,
        warning: 'Autores CUDYR incompletos.',
      }),
    });
    vm.runInContext(
      `${source.slice(start, end)}\nglobalThis.__handleCudyr = handleCudyrCategoriesRequest;`,
      context
    );
    const result = await (
      context as unknown as { __handleCudyr: () => Promise<Record<string, unknown>> }
    ).__handleCudyr();

    expect(result).toMatchObject({ ok: true, source: 'gestion_camas', historyAvailable: true });
    expect(String(result.warning)).toContain('Autores CUDYR incompletos.');
    expect(String(result.warning)).toContain('Ficha Médico no disponible.');
  });

  it('builds attributable, newest-first history from an occupied bed encounter', () => {
    const items = cudyr.buildSnapshot({
      beds: [
        {
          bedEncounterMapping: {
            encounterMapping: {
              encounter: {
                id: 901,
                formRegistrationSummaryList: [
                  {
                    id: 10,
                    formId: 1,
                    value: 'D3',
                    creationDate: '2026-07-10T23:12:04.74+00:00',
                    healthCarePractitionerId: 44,
                    healthCarePractitionerRoleId: 2,
                    formRegistrationDetailList: [
                      { fieldFormId: 1, value: 3 },
                      { fieldFormId: 7, value: 2 },
                    ],
                  },
                  {
                    id: 11,
                    formId: 1,
                    value: 'C2',
                    creationDate: '2026-07-15T06:54:00.00+00:00',
                    healthCarePractitionerId: 45,
                    healthCarePractitionerRoleId: 2,
                    formRegistrationDetailList: [
                      { fieldFormId: 1, value: 4 },
                      { fieldFormId: 7, value: 7 },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
      practitioners: [
        { id: 44, fullName: 'Camila Leiva' },
        { id: 45, fullName: 'Constanza Guajardo' },
      ],
      definitions: [
        { formId: 1, formFieldId: 1, formFieldLabel: 'Cambio de ropa', typeId: 1 },
        { formId: 1, formFieldId: 7, formFieldLabel: 'Signos vitales', typeId: 2 },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      encId: '901',
      crdValue: 'C2',
      author: 'Constanza Guajardo',
      authorRole: 'Enfermería',
      source: 'gestion_camas',
    });
    expect(items[0].history).toMatchObject([
      { category: 'C2', dependencyScore: null, riskScore: null },
      { category: 'D3', dependencyScore: null, riskScore: null },
    ]);
  });

  it('publishes numeric totals only when all 14 CUDYR variables are present', () => {
    const details = Array.from({ length: 14 }, (_, index) => ({
      fieldFormId: index + 1,
      value: index < 6 ? 2 : 3,
    }));
    const items = cudyr.buildSnapshot({
      beds: [
        {
          bedEncounterMapping: {
            encounterMapping: {
              encounter: {
                id: 903,
                formRegistrationSummaryList: [
                  {
                    id: 30,
                    formId: 1,
                    value: 'B2',
                    creationDate: '2026-07-15T06:54:00.00+00:00',
                    formRegistrationDetailList: details,
                  },
                ],
              },
            },
          },
        },
      ],
      practitioners: [],
      definitions: [],
    });

    expect(items[0].history).toMatchObject([
      { category: 'B2', dependencyScore: 12, riskScore: 24 },
    ]);
  });

  it('does not count null or blank CUDYR answers as zero-valued variables', () => {
    const details = Array.from({ length: 14 }, (_, index) => ({
      fieldFormId: index + 1,
      value: index === 2 ? null : index === 9 ? '   ' : 2,
    }));
    const items = cudyr.buildSnapshot({
      beds: [
        {
          bedEncounterMapping: {
            encounterMapping: {
              encounter: {
                id: 904,
                formRegistrationSummaryList: [
                  {
                    id: 31,
                    formId: 1,
                    value: 'B2',
                    creationDate: '2026-07-15T07:00:00.00+00:00',
                    formRegistrationDetailList: details,
                  },
                ],
              },
            },
          },
        },
      ],
      practitioners: [],
      definitions: [],
    });

    expect(items[0].history).toMatchObject([{ dependencyScore: null, riskScore: null }]);
  });

  it('retains more than 20 daily CUDYR records for historical census reconstruction', () => {
    const history = Array.from({ length: 25 }, (_, index) => ({
      id: 100 + index,
      formId: 1,
      value: 'D3',
      creationDate: new Date(Date.UTC(2026, 5, index + 1)).toISOString(),
      formRegistrationDetailList: [],
    }));
    const items = cudyr.buildSnapshot({
      beds: [
        {
          bedEncounterMapping: {
            encounterMapping: {
              encounter: {
                id: 905,
                formRegistrationSummaryList: history,
              },
            },
          },
        },
      ],
      practitioners: [],
      definitions: [],
    });

    expect(items[0].history).toHaveLength(25);
  });

  it('keeps Gestión de Camas authoritative and fills only missing encounters from Ficha Médico', () => {
    expect(
      cudyr.mergeEncounterSnapshots(
        [
          { encId: '901', crdValue: 'C2', source: 'gestion_camas' },
          { encId: '902', crdValue: 'D3', source: 'gestion_camas' },
        ],
        [
          { encId: '901', crdValue: 'A1', source: 'ficha_medico' },
          { encId: '903', crdValue: 'B2', source: 'ficha_medico' },
        ]
      )
    ).toEqual([
      { encId: '901', crdValue: 'C2', source: 'gestion_camas' },
      { encId: '902', crdValue: 'D3', source: 'gestion_camas' },
      { encId: '903', crdValue: 'B2', source: 'ficha_medico' },
    ]);
  });

  it('ignores S/C, deleted records and beds without an active encounter', () => {
    expect(
      cudyr.buildSnapshot({
        beds: [
          {},
          {
            bedEncounterMapping: {
              encounterMapping: {
                encounter: {
                  id: 902,
                  formRegistrationSummaryList: [
                    { id: 20, formId: 1, value: 'S/C', creationDate: '2026-07-15T06:00:00Z' },
                    {
                      id: 21,
                      formId: 1,
                      value: 'D3',
                      deleted: true,
                      creationDate: '2026-07-15T07:00:00Z',
                    },
                  ],
                },
              },
            },
          },
        ],
        practitioners: [],
        definitions: [],
      })
    ).toEqual([]);
  });
});

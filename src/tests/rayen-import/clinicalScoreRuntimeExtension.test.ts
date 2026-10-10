// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const runtimeSource = readFileSync(path.resolve('extension/clinical-score-runtime.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');

type RuntimeDependencies = Record<string, unknown>;
type RuntimeApi = {
  handleCudyrCategoriesRequest: () => Promise<Record<string, unknown>>;
  handleFormRequest: (request: {
    batchId: string;
    encId: string;
    instrument: string;
  }) => Promise<Record<string, unknown>>;
  readScoresBatch: (batchId: string, encId: string) => Promise<Record<string, unknown>>;
};

const loadFactory = () => {
  const context = vm.createContext({ URL, Date, Set, Map, Promise, encodeURIComponent });
  vm.runInContext(
    readFileSync(path.resolve('extension/cudyr-capture-support.js'), 'utf8'),
    context
  );
  vm.runInContext(runtimeSource, context, { filename: 'clinical-score-runtime.js' });
  return (
    context as unknown as {
      HhrClinicalScoreRuntime: { create: (dependencies: RuntimeDependencies) => RuntimeApi };
    }
  ).HhrClinicalScoreRuntime;
};

const createDependencies = (overrides: RuntimeDependencies = {}) => ({
  chrome: {
    storage: {
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  },
  crypto: { randomUUID: vi.fn(() => '12345678-1234-1234-1234-123456789012') },
  fetchWithTimeout: vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  getFichaFetchInfo: vi.fn(async () => ({ error: 'Ficha Médico no disponible.' })),
  resolveGestionCamasSession: vi.fn(async () => ({ error: 'Gestión de Camas no disponible.' })),
  classifyGestionCamasRejection: vi.fn(async () => ''),
  nursingWorklists: ['noveltyNurseList', 'uneventfulNurseList', 'incomeNurseList'],
  resolveSessionHandoffKind: vi.fn(() => 'nursing'),
  fetchFichaClaims: vi.fn(async () => ({ claims: [] })),
  hasFichaClaim: vi.fn(() => false),
  fetchActiveHospitalizedPatients: vi.fn(async () => ({ patients: [] })),
  mapWithConcurrency: vi.fn(
    async (items: unknown[], _limit: number, worker: (item: unknown) => Promise<unknown>) =>
      Promise.all(items.map(worker))
  ),
  fetchScaleHistoryEvents: vi.fn(async () => ({ events: [] })),
  fetchEvaluationForms: vi.fn(async () => ({ forms: [] })),
  serializeClinicalWriteProtection: vi.fn(async () => ({})),
  verifyEncounterStillHospitalized: vi.fn(async () => ({ encounter: {} })),
  prescriptionPrint: { deriveScaleHistory: vi.fn(() => []) },
  gestionCamasCudyr: {
    buildSnapshot: vi.fn(() => []),
    mergeEncounterSnapshots: vi.fn((official: unknown[]) => official),
  },
  now: vi.fn(() => 1_000_000),
  ...overrides,
});

const gestionCamasRecord = {
  apiBase: 'https://hospbackend.rayensalud.cl/api',
  facId: '1342',
  token: 'fixture',
};

describe('clinical Scores read runtime owner', () => {
  it('loads before background orchestration, fails closed and removes the former inline owner', () => {
    const startup = backgroundSource.slice(0, backgroundSource.indexOf('const REPORT_FILE'));

    expect(startup).toContain("'clinical-score-runtime.js'");
    expect(startup).toContain('No se pudo cargar el runtime de lectura de Scores.');
    expect(backgroundSource).toContain('self.HhrClinicalScoreRuntime.create({');
    expect(backgroundSource).not.toContain('const normalizeScaleDefinition =');
    expect(backgroundSource).not.toContain('const handleScoresOptionsRequest = async');
    expect(backgroundSource).not.toContain('const handleCudyrCategoriesRequest = async');
    expect(runtimeSource).toContain('const handleScoresOptionsRequest = async');
    expect(runtimeSource).toContain('const handleCudyrCategoriesRequest = async');
    expect(runtimeSource).toContain('fetchCudyrCategories,');
    expect(backgroundSource).toContain('fetchCudyrCategories,');
  });

  it('rejects incomplete dependency injection', () => {
    expect(() => loadFactory().create({})).toThrow(
      'No se pudo inicializar el runtime de lectura de Scores.'
    );
  });

  it.each([
    { status: 401, rejection: 'expired', message: 'sesión de Gestión de Camas venció' },
    { status: 403, rejection: 'forbidden', message: 'rechazó la consulta CUDYR por permisos' },
    { status: 503, rejection: '', message: 'HTTP 503' },
  ])('classifies an official beds HTTP $status without a ReferenceError', async entry => {
    const classifyGestionCamasRejection = vi.fn(async () => entry.rejection);
    const fetchWithTimeout = vi.fn(async (url: string) =>
      url.endsWith('/beds')
        ? { ok: false, status: entry.status, json: async () => [] }
        : { ok: true, status: 200, json: async () => [] }
    );
    const runtime = loadFactory().create(
      createDependencies({
        resolveGestionCamasSession: vi.fn(async () => ({ record: gestionCamasRecord })),
        classifyGestionCamasRejection,
        fetchWithTimeout,
      })
    );

    const result = await runtime.handleCudyrCategoriesRequest();

    expect(String(result.error)).toContain(entry.message);
    expect(String(result.error)).not.toContain('handleGestionCamasUnauthorized');
    expect(classifyGestionCamasRejection).toHaveBeenCalledWith(
      expect.objectContaining({ status: entry.status }),
      gestionCamasRecord
    );
  });

  it.each(['network', 'beds', 'authors', 'definitions'])(
    'recovers one transient official %s read without degrading the source',
    async failingSource => {
      const attempts = new Map<string, number>();
      const fetchWithTimeout = vi.fn(async (url: string) => {
        const source = url.endsWith('/beds')
          ? 'beds'
          : url.includes('healthCarePractitioners')
            ? 'authors'
            : 'definitions';
        const attempt = (attempts.get(source) ?? 0) + 1;
        attempts.set(source, attempt);
        if (
          attempt === 1 &&
          (source === failingSource || (failingSource === 'network' && source === 'beds'))
        ) {
          if (failingSource === 'network') throw new TypeError('Failed to fetch');
          return { ok: false, status: 503, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => [] };
      });
      const result = await loadFactory()
        .create(
          createDependencies({
            resolveGestionCamasSession: vi.fn(async () => ({ record: gestionCamasRecord })),
            fetchWithTimeout,
          })
        )
        .handleCudyrCategoriesRequest();
      expect(result).toMatchObject({
        historyAvailable: true,
        metadataStatus: 'complete',
        warning: 'Ficha Médico no disponible.',
      });
      expect([...attempts.values()].sort()).toEqual([1, 1, 2]);
    }
  );

  it.each([401, 403, 404, 422])(
    'does not repeat a rejected official HTTP %s read',
    async status => {
      const fetchWithTimeout = vi.fn(async (url: string) => ({
        ok: !url.endsWith('/beds'),
        status: url.endsWith('/beds') ? status : 200,
        json: async () => [],
      }));
      const result = await loadFactory()
        .create(
          createDependencies({
            resolveGestionCamasSession: vi.fn(async () => ({ record: gestionCamasRecord })),
            fetchWithTimeout,
          })
        )
        .handleCudyrCategoriesRequest();
      expect(result.error).toBeTruthy();
      expect(fetchWithTimeout.mock.calls.filter(([url]) => url.endsWith('/beds'))).toHaveLength(1);
    }
  );

  it('limits a persistent transient failure to two reads and retains the error', async () => {
    const fetchWithTimeout = vi.fn(async (url: string) => ({
      ok: !url.endsWith('/beds'),
      status: url.endsWith('/beds') ? 503 : 200,
      json: async () => [],
    }));
    const result = await loadFactory()
      .create(
        createDependencies({
          resolveGestionCamasSession: vi.fn(async () => ({ record: gestionCamasRecord })),
          fetchWithTimeout,
        })
      )
      .handleCudyrCategoriesRequest();
    expect(String(result.error)).toContain('HTTP 503');
    expect(fetchWithTimeout.mock.calls.filter(([url]) => url.endsWith('/beds'))).toHaveLength(2);
  });

  it('falls back to all three Ficha Médico lists when the official CUDYR source fails', async () => {
    const info = {
      apiOrigin: 'https://fichamedicoback.rayensalud.cl',
      facId: '1342',
      token: 'fixture',
    };
    const fetchWithTimeout = vi.fn(async (url: string) => {
      if (url.includes('/beds')) return { ok: false, status: 503, json: async () => [] };
      if (url.startsWith(info.apiOrigin)) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 901, crdValue: 'C2', crdDateTime: '2026-07-18T08:00:00Z' }],
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    const runtime = loadFactory().create(
      createDependencies({
        getFichaFetchInfo: vi.fn(async () => ({ info })),
        resolveGestionCamasSession: vi.fn(async () => ({ record: gestionCamasRecord })),
        fetchWithTimeout,
      })
    );

    const result = await runtime.handleCudyrCategoriesRequest();

    expect(result).toMatchObject({
      ok: true,
      source: 'ficha_medico',
      historyAvailable: false,
      items: [{ encId: '901', crdValue: 'C2', source: 'ficha_medico' }],
    });
    expect(String(result.warning)).toContain('HTTP 503');
    expect(
      fetchWithTimeout.mock.calls.filter(([url]) => String(url).startsWith(info.apiOrigin))
    ).toHaveLength(3);
  });

  it('reads the three fallback lists concurrently and merges in stable list order', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const fetchWithTimeout = vi.fn(() => new Promise(resolve => pending.push(resolve)));
    const runtime = loadFactory().create(
      createDependencies({
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            facId: '1342',
            token: 'fixture',
          },
        })),
        fetchWithTimeout,
      })
    );
    const result = runtime.handleCudyrCategoriesRequest();
    await vi.waitFor(() => expect(fetchWithTimeout).toHaveBeenCalledTimes(3));
    // Finish out of order: the source precedence must not depend on network speed.
    for (const index of [2, 0, 1])
      pending[index]({
        ok: true,
        json: async () => [{ id: 901, crdValue: `C${index + 1}` }],
      });
    await expect(result).resolves.toMatchObject({
      source: 'ficha_medico',
      historyAvailable: false,
      items: [{ encId: '901', crdValue: 'C3' }],
    });
  });

  it.each(['timeout', 'invalid-json', 'invalid-shape'])(
    'keeps official history when a fallback list has %s',
    async failure => {
      const runtime = loadFactory().create(
        createDependencies({
          getFichaFetchInfo: vi.fn(async () => ({
            info: {
              apiOrigin: 'https://fichamedicoback.rayensalud.cl',
              facId: '1342',
              token: 'fixture',
            },
          })),
          resolveGestionCamasSession: vi.fn(async () => ({ record: gestionCamasRecord })),
          fetchWithTimeout: vi.fn(async (url: string) => {
            if (!url.includes('incomeNurseList')) return { ok: true, json: async () => [] };
            if (failure === 'timeout') throw new Error('timeout');
            return {
              ok: true,
              json: async () => {
                if (failure === 'invalid-json') throw new Error('invalid JSON');
                return { error: 'not a list' };
              },
            };
          }),
          gestionCamasCudyr: {
            buildSnapshot: vi.fn(() => [{ encId: '901', source: 'gestion_camas', crdValue: 'C2' }]),
            mergeEncounterSnapshots: vi.fn((official: unknown[]) => official),
          },
        })
      );
      await expect(runtime.handleCudyrCategoriesRequest()).resolves.toMatchObject({
        historyAvailable: true,
        source: 'gestion_camas',
        items: [{ encId: '901', crdValue: 'C2' }],
        warning: expect.stringContaining('tres listas CUDYR'),
      });
    }
  );

  it('preserves the 30-minute batch TTL and encounter allowlist', async () => {
    const batchId = '12345678-1234-1234-1234-123456789012';
    const key = `hhr-scores-batch-${batchId}`;
    const get = vi.fn(async () => ({
      [key]: {
        createdAt: 1_000_000 - 30 * 60 * 1000,
        patients: [{ encounterId: '901', hospitalDepartmentId: '44' }],
      },
    }));
    const runtime = loadFactory().create(
      createDependencies({
        chrome: { storage: { session: { get, set: vi.fn(async () => undefined) } } },
      })
    );

    await expect(runtime.readScoresBatch(batchId, '901')).resolves.toMatchObject({
      patient: { encounterId: '901' },
      storageKey: key,
    });
    await expect(runtime.readScoresBatch(batchId, '902')).resolves.toEqual({
      error: 'El paciente no pertenece a esta lista activa.',
    });

    const expired = loadFactory().create(
      createDependencies({
        chrome: { storage: { session: { get, set: vi.fn(async () => undefined) } } },
        now: vi.fn(() => 1_000_001),
      })
    );
    await expect(expired.readScoresBatch(batchId, '901')).resolves.toEqual({
      error: 'La sesión de Scores expiró. Actualiza el módulo.',
    });
  });

  it('revalidates role, claims and hospitalization before returning a live scale schema', async () => {
    const batchId = '12345678-1234-1234-1234-123456789012';
    const key = `hhr-scores-batch-${batchId}`;
    const info = {
      identityVerified: true,
      role: 'Enfermera',
      token: 'fixture',
      facId: '1342',
      practitionerRoleId: '22',
    };
    const fetchWithTimeout = vi.fn(async (url: string) => {
      if (url.includes('/api/Form?')) {
        return { ok: true, status: 200, json: async () => [{ id: 7, name: 'Escala Downton' }] };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          metaFormId: 70,
          sections: [
            {
              fields: [
                {
                  metaField: {
                    metaFieldName: 'downton_medicamentos',
                    label: 'Medicamentos',
                    metaDataType: 1,
                    listValues: [{ id: 1, description: 'Sí', active: true }],
                  },
                  listValueScore: [{ listValueId: 1, score: 1 }],
                },
                { metaField: { metaFieldName: 'downton_puntaje', metaDataType: 2 } },
                { metaField: { metaFieldName: 'downton_resultadoscore', metaDataType: 2 } },
              ],
            },
          ],
          results: [
            {
              minScore: 0,
              maxScore: 10,
              listValueResult: { id: 9, description: 'Riesgo' },
            },
          ],
        }),
      };
    });
    const fetchFichaClaims = vi.fn(async () => ({
      claims: [{ claim: 'Ver_Instrumento_Evaluacion', moduleId: 6 }],
    }));
    const verifyEncounterStillHospitalized = vi.fn(async () => ({
      encounter: { id: 901, hospitalDepartmentId: 44 },
    }));
    const runtime = loadFactory().create(
      createDependencies({
        chrome: {
          storage: {
            session: {
              get: vi.fn(async () => ({
                [key]: { createdAt: 1_000_000, patients: [{ encounterId: '901' }] },
              })),
              set: vi.fn(async () => undefined),
            },
          },
        },
        getFichaFetchInfo: vi.fn(async () => ({ info })),
        fetchFichaClaims,
        hasFichaClaim: vi.fn(() => true),
        verifyEncounterStillHospitalized,
        fetchWithTimeout,
      })
    );

    const result = await runtime.handleFormRequest({
      batchId,
      encId: '901',
      instrument: 'DOWNTON',
    });

    expect(result).toMatchObject({
      ok: true,
      definition: {
        instrument: 'DOWNTON',
        formId: '7',
        fields: [{ id: 'downton_medicamentos', required: true }],
        scoreFieldId: 'downton_puntaje',
        resultFieldId: 'downton_resultadoscore',
      },
    });
    expect(fetchFichaClaims).toHaveBeenCalledWith(info);
    expect(verifyEncounterStillHospitalized).toHaveBeenCalledWith('901', info);
  });
});

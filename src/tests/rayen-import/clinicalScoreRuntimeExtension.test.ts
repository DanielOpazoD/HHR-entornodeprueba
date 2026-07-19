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
    const fetchWithTimeout = vi.fn(async (url: string) => url.endsWith('/beds')
      ? { ok: false, status: entry.status, json: async () => [] }
      : { ok: true, status: 200, json: async () => [] });
    const runtime = loadFactory().create(createDependencies({
      resolveGestionCamasSession: vi.fn(async () => ({ record: gestionCamasRecord })),
      classifyGestionCamasRejection,
      fetchWithTimeout,
    }));

    const result = await runtime.handleCudyrCategoriesRequest();

    expect(String(result.error)).toContain(entry.message);
    expect(String(result.error)).not.toContain('handleGestionCamasUnauthorized');
    expect(classifyGestionCamasRejection).toHaveBeenCalledWith(
      expect.objectContaining({ status: entry.status }),
      gestionCamasRecord
    );
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
    const runtime = loadFactory().create(createDependencies({
      getFichaFetchInfo: vi.fn(async () => ({ info })),
      resolveGestionCamasSession: vi.fn(async () => ({ record: gestionCamasRecord })),
      fetchWithTimeout,
    }));

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

  it('preserves the 30-minute batch TTL and encounter allowlist', async () => {
    const batchId = '12345678-1234-1234-1234-123456789012';
    const key = `hhr-scores-batch-${batchId}`;
    const get = vi.fn(async () => ({
      [key]: {
        createdAt: 1_000_000 - 30 * 60 * 1000,
        patients: [{ encounterId: '901', hospitalDepartmentId: '44' }],
      },
    }));
    const runtime = loadFactory().create(createDependencies({
      chrome: { storage: { session: { get, set: vi.fn(async () => undefined) } } },
    }));

    await expect(runtime.readScoresBatch(batchId, '901')).resolves.toMatchObject({
      patient: { encounterId: '901' },
      storageKey: key,
    });
    await expect(runtime.readScoresBatch(batchId, '902')).resolves.toEqual({
      error: 'El paciente no pertenece a esta lista activa.',
    });

    const expired = loadFactory().create(createDependencies({
      chrome: { storage: { session: { get, set: vi.fn(async () => undefined) } } },
      now: vi.fn(() => 1_000_001),
    }));
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
          sections: [{
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
          }],
          results: [{
            minScore: 0,
            maxScore: 10,
            listValueResult: { id: 9, description: 'Riesgo' },
          }],
        }),
      };
    });
    const fetchFichaClaims = vi.fn(async () => ({
      claims: [{ claim: 'Ver_Instrumento_Evaluacion', moduleId: 6 }],
    }));
    const verifyEncounterStillHospitalized = vi.fn(async () => ({
      encounter: { id: 901, hospitalDepartmentId: 44 },
    }));
    const runtime = loadFactory().create(createDependencies({
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
    }));

    const result = await runtime.handleFormRequest({ batchId, encId: '901', instrument: 'DOWNTON' });

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

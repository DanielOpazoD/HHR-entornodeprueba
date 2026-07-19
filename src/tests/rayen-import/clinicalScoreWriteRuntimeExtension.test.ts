// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const runtimeSource = readFileSync(
  path.resolve('extension/clinical-score-write-runtime.js'),
  'utf8'
);
const modelSource = readFileSync(path.resolve('extension/clinical-score-write-model.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');

type RuntimeDependencies = Record<string, unknown>;
type SaveRequest = {
  batchId: string;
  encId: string;
  instrument: string;
  answers: Record<string, string | number>;
};
type RuntimeApi = {
  handleSaveRequest: (request: SaveRequest) => Promise<Record<string, unknown>>;
  readRecoveryReview: (request: {
    encId: string;
    instrument: string;
    info: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
};

const loadOwner = () => {
  const context = vm.createContext({ Date, Map, Set, Promise, URL, encodeURIComponent });
  vm.runInContext(modelSource, context, { filename: 'clinical-score-write-model.js' });
  vm.runInContext(runtimeSource, context, { filename: 'clinical-score-write-runtime.js' });
  return (
    context as unknown as {
      HhrClinicalScoreWriteRuntime: {
        create: (dependencies: RuntimeDependencies) => RuntimeApi;
        buildClinicalAge: (birthDate: string, referenceDate: Date) => string;
      };
    }
  ).HhrClinicalScoreWriteRuntime;
};

const sessionInfo = {
  apiOrigin: 'https://fichamedicoback.rayensalud.cl',
  token: 'test-auth-token',
  facId: '1342',
  identityVerified: true,
  role: 'Enfermera',
  practitionerId: '77',
  practitionerRoleId: '88',
  fullName: 'Profesional Prueba',
};

const patient = {
  birthDate: '2000-01-15',
  administrativeSexId: '1',
  hospitalDepartmentId: '12',
};

const cudyrFields = Array.from({ length: 14 }, (_value, index) => ({
  id: index + 1,
  typeId: 1,
  formId: 1,
  categorizationFormOptionList: [{ value: 1 }],
}));

const cudyrAnswers = Object.fromEntries(cudyrFields.map(field => [String(field.id), 1]));

const response = (status = 200, body = '{}') => ({
  ok: status >= 200 && status < 300,
  status,
  text: vi.fn(async () => body),
});

const createDependencies = (overrides: RuntimeDependencies = {}) => ({
  scoreWriteModel: (() => {
    const context = vm.createContext({ Map });
    vm.runInContext(modelSource, context, { filename: 'clinical-score-write-model.js' });
    return (context as unknown as { HhrClinicalScoreWriteModel: Record<string, unknown> })
      .HhrClinicalScoreWriteModel;
  })(),
  fetchWithTimeout: vi.fn(async () => response()),
  getFichaFetchInfo: vi.fn(async () => ({ info: sessionInfo })),
  fetchFichaClaims: vi.fn(async () => ({ claims: [] })),
  hasFichaClaim: vi.fn(() => true),
  verifyEncounterStillHospitalized: vi.fn(async () => ({
    ok: true,
    encounter: { hospitalDepartmentId: '12' },
  })),
  fetchCudyrDefinitions: vi.fn(async () => ({ rows: cudyrFields })),
  fetchCudyrCategories: vi.fn(async () => ({ items: [] })),
  resolveCudyrFormId: vi.fn(() => '1'),
  getScaleDefinition: vi.fn(async () => ({
    definition: {
      instrument: 'BRADEN',
      metaFormId: '10',
      formId: '20',
      scoreFieldId: 'total',
      resultFieldId: 'classification',
      fields: [
        {
          id: 'risk',
          type: 6,
          required: true,
          options: [{ id: 'yes', score: 2 }],
        },
      ],
      results: [{ minScore: 0, maxScore: 5, valueId: '99', valueName: 'Riesgo bajo' }],
    },
  })),
  readScoresBatch: vi.fn(async () => ({ patient: { ...patient } })),
  fetchScaleHistoryEvents: vi.fn(async () => ({ events: [] })),
  fetchEvaluationForms: vi.fn(async () => ({ forms: [] })),
  withClinicalWriteLock: vi.fn(
    async (
      _key: string,
      worker: (guard: { beginWrite: () => Promise<Record<string, unknown>> }) => Promise<unknown>
    ) => worker({ beginWrite: vi.fn(async () => ({ ok: true })) })
  ),
  clinicalRecordKey: vi.fn((_kind: string, record: Record<string, unknown>) =>
    String(record.id || record.guid || '')
  ),
  collectClinicalTimestampBaseline: vi.fn(() => ({ timestampTexts: new Set(), latestAt: NaN })),
  hasNewClinicalTimestamp: vi.fn(() => true),
  prescriptionPrint: {
    calculateCudyrCategory: vi.fn(() => ({ value: 'C2' })),
    deriveScaleHistory: vi.fn(() => []),
  },
  wait: vi.fn(async () => undefined),
  ...overrides,
});

describe('clinical Scores write runtime owner', () => {
  it('loads fail-closed before background wiring and removes the inline write owner', () => {
    const startup = backgroundSource.slice(0, backgroundSource.indexOf('const REPORT_FILE'));

    expect(startup).toContain("'clinical-score-write-runtime.js'");
    expect(startup).toContain("'clinical-score-write-model.js'");
    expect(startup).toContain('!self.HhrClinicalScoreWriteModel ||');
    expect(startup).toContain('No se pudo cargar el runtime de escritura de Scores.');
    expect(backgroundSource).toContain('self.HhrClinicalScoreWriteRuntime.create({');
    expect(backgroundSource).toContain(
      'return clinicalScoreWriteRuntime.readRecoveryReview({ encId, instrument, info });'
    );
    expect(backgroundSource).not.toContain('const handleCudyrSave = async');
    expect(backgroundSource).not.toContain('const handleEvaluationScaleSave = async');
    expect(backgroundSource).not.toContain('const performScoreSaveRequest = async');
    expect(runtimeSource).toContain('const handleCudyrSave = async');
    expect(runtimeSource).toContain('const handleEvaluationScaleSave = async');
    expect(modelSource).toContain('const prepareEvaluationSubmission =');
    expect(runtimeSource).toContain('const performScoreSaveRequest = async');
  });

  it('rejects incomplete dependency injection', () => {
    expect(() => loadOwner().create({})).toThrow(
      'No se pudo inicializar el runtime de escritura de Scores.'
    );
  });

  it('writes and verifies CUDYR exactly once behind the score lock', async () => {
    const fetchCudyrCategories = vi
      .fn()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ encId: '901', crdValue: 'C2', crdDateTime: '18-07-2026 12:30:00' }],
      });
    const fetchWithTimeout = vi.fn(async () => response(200, '{}'));
    const withClinicalWriteLock = vi.fn(
      async (
        _key: string,
        worker: (guard: { beginWrite: () => Promise<Record<string, unknown>> }) => Promise<unknown>
      ) => worker({ beginWrite: vi.fn(async () => ({ ok: true })) })
    );
    const runtime = loadOwner().create(
      createDependencies({
        fetchCudyrCategories,
        fetchWithTimeout,
        withClinicalWriteLock,
      })
    );

    const result = await runtime.handleSaveRequest({
      batchId: 'batch-1',
      encId: '901',
      instrument: 'CUDYR',
      answers: cudyrAnswers,
    });

    expect(result).toMatchObject({ ok: true, verified: true, record: { total: 'C2' } });
    expect(withClinicalWriteLock).toHaveBeenCalledWith('score:901:CUDYR', expect.any(Function));
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchCudyrCategories).toHaveBeenCalledTimes(2);
    const fetchCalls = fetchWithTimeout.mock.calls as unknown as Array<
      [string, { method?: string; body?: string }]
    >;
    const request = fetchCalls[0][1];
    expect(request.method).toBe('POST');
    expect(JSON.parse(String(request.body))).toMatchObject({
      encounterId: '901',
      value: 'C2',
      healthCarePractitionerId: 77,
      healthCarePractitionerRoleId: 88,
    });
  });

  it('writes and verifies an evaluation scale against both baseline sources', async () => {
    const refreshedForm = {
      id: '55',
      formId: '20',
      createDateTime: '18-07-2026 12:31:00',
      authorHealthCarePractitionerId: '77',
      authorHealthCarePractitionerName: 'Profesional Prueba',
      metaCampList: [
        { id: 'risk', value: 'yes' },
        { id: 'total', value: '2' },
        { id: 'classification', value: '99' },
      ],
    };
    const fetchEvaluationForms = vi
      .fn()
      .mockResolvedValueOnce({ forms: [] })
      .mockResolvedValueOnce({ forms: [refreshedForm] });
    const fetchWithTimeout = vi.fn(async () => response(200, '{"id":55}'));
    const runtime = loadOwner().create(
      createDependencies({
        fetchEvaluationForms,
        fetchWithTimeout,
      })
    );

    const result = await runtime.handleSaveRequest({
      batchId: 'batch-2',
      encId: '902',
      instrument: 'BRADEN',
      answers: { risk: 'yes' },
    });

    expect(result).toMatchObject({
      ok: true,
      verified: true,
      record: { total: 2, severity: 'Riesgo bajo' },
    });
    expect(fetchEvaluationForms).toHaveBeenCalledTimes(2);
    const fetchCalls = fetchWithTimeout.mock.calls as unknown as Array<[string, { body?: string }]>;
    const request = fetchCalls[0][1];
    const body = JSON.parse(String(request.body));
    expect(body.encounterFormEntryTransport).toMatchObject({
      age: expect.stringMatching(/^\d+$/),
      administrativeSexId: 1,
      metaFormId: 10,
      formId: 20,
    });
    expect(body.encounterFormEntryTransport.metaCampList).toEqual([
      { id: 'risk', value: 'yes' },
      { id: 'total', value: '2' },
      { id: 'classification', value: '99' },
    ]);
  });

  it('rejects invalid evaluation answers before baseline reads or write protection', async () => {
    const fetchScaleHistoryEvents = vi.fn(async () => ({ events: [] }));
    const fetchEvaluationForms = vi.fn(async () => ({ forms: [] }));
    const fetchWithTimeout = vi.fn(async () => response());
    const beginWrite = vi.fn(async () => ({ ok: true }));
    const runtime = loadOwner().create(
      createDependencies({
        fetchScaleHistoryEvents,
        fetchEvaluationForms,
        fetchWithTimeout,
        withClinicalWriteLock: vi.fn(
          async (
            _key: string,
            worker: (guard: {
              beginWrite: () => Promise<Record<string, unknown>>;
            }) => Promise<unknown>
          ) => worker({ beginWrite })
        ),
      })
    );

    const result = await runtime.handleSaveRequest({
      batchId: 'batch-invalid-scale',
      encId: '902',
      instrument: 'BRADEN',
      answers: { risk: 'unknown' },
    });

    expect(String(result.error)).toContain('opciones válidas');
    expect(fetchScaleHistoryEvents).not.toHaveBeenCalled();
    expect(fetchEvaluationForms).not.toHaveBeenCalled();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(beginWrite).not.toHaveBeenCalled();
  });

  it('treats an evaluation 4xx as definitely rejected without readback retries', async () => {
    const fetchEvaluationForms = vi.fn(async () => ({ forms: [] }));
    const fetchWithTimeout = vi.fn(async () => response(422, ''));
    const wait = vi.fn(async () => undefined);
    const runtime = loadOwner().create(
      createDependencies({
        fetchEvaluationForms,
        fetchWithTimeout,
        wait,
      })
    );

    const result = await runtime.handleSaveRequest({
      batchId: 'batch-rejected-scale',
      encId: '902',
      instrument: 'BRADEN',
      answers: { risk: 'yes' },
    });

    expect(result).toMatchObject({ definitelyNotApplied: true });
    expect(String(result.error)).toContain('HTTP 422');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchEvaluationForms).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('never verifies an evaluation after an ambiguous POST response', async () => {
    const matchingForm = {
      id: '55',
      formId: '20',
      createDateTime: '18-07-2026 12:31:00',
      authorHealthCarePractitionerId: '77',
      metaCampList: [
        { id: 'risk', value: 'yes' },
        { id: 'total', value: '2' },
        { id: 'classification', value: '99' },
      ],
    };
    const fetchEvaluationForms = vi
      .fn()
      .mockResolvedValueOnce({ forms: [] })
      .mockResolvedValue({ forms: [matchingForm] });
    const fetchWithTimeout = vi.fn(async () => response(503, ''));
    const wait = vi.fn(async () => undefined);
    const runtime = loadOwner().create(
      createDependencies({
        fetchEvaluationForms,
        fetchWithTimeout,
        wait,
      })
    );

    const result = await runtime.handleSaveRequest({
      batchId: 'batch-ambiguous-scale',
      encId: '902',
      instrument: 'BRADEN',
      answers: { risk: 'yes' },
    });

    expect(result).toMatchObject({ writeMayHaveSucceeded: true });
    expect(String(result.error)).toContain('HTTP 503');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchEvaluationForms).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('marks a clinical 4xx as definitely not applied and performs no readback retry', async () => {
    const fetchCudyrCategories = vi.fn(async () => ({ items: [] }));
    const fetchWithTimeout = vi.fn(async () => response(422, ''));
    const wait = vi.fn(async () => undefined);
    const runtime = loadOwner().create(
      createDependencies({
        fetchCudyrCategories,
        fetchWithTimeout,
        wait,
      })
    );

    const result = await runtime.handleSaveRequest({
      batchId: 'batch-3',
      encId: '903',
      instrument: 'CUDYR',
      answers: cudyrAnswers,
    });

    expect(result).toMatchObject({ definitelyNotApplied: true });
    expect(String(result.error)).toContain('HTTP 422');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchCudyrCategories).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('never converts an ambiguous POST into success and never repeats the POST', async () => {
    const fetchCudyrCategories = vi
      .fn()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValue({
        items: [{ encId: '904', crdValue: 'C2', crdDateTime: '18-07-2026 12:32:00' }],
      });
    const fetchWithTimeout = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const wait = vi.fn(async () => undefined);
    const runtime = loadOwner().create(
      createDependencies({
        fetchCudyrCategories,
        fetchWithTimeout,
        wait,
      })
    );

    const result = await runtime.handleSaveRequest({
      batchId: 'batch-4',
      encId: '904',
      instrument: 'CUDYR',
      answers: cudyrAnswers,
    });

    expect(result).toMatchObject({ writeMayHaveSucceeded: true });
    expect(String(result.error)).toContain('Se perdió la confirmación');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchCudyrCategories).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('reads CUDYR recovery through the exported source adapter', async () => {
    const fetchCudyrCategories = vi.fn(async () => ({
      items: [{ encId: '905', crdValue: 'B1', crdDateTime: '18-07-2026 12:33:00' }],
    }));
    const runtime = loadOwner().create(createDependencies({ fetchCudyrCategories }));

    const result = await runtime.readRecoveryReview({
      encId: '905',
      instrument: 'CUDYR',
      info: sessionInfo,
    });

    expect(result).toEqual({
      review: {
        kind: 'score',
        instrument: 'CUDYR',
        present: true,
        value: 'B1',
        classification: '',
        dateTime: '18-07-2026 12:33:00',
        author: '',
      },
    });
    expect(fetchCudyrCategories).toHaveBeenCalledWith(sessionInfo);
  });

  it('reconciles both score sources for a scale recovery review', async () => {
    const latest = {
      total: 12,
      severity: 'Riesgo alto',
      dateTime: '18-07-2026 12:34:00',
      author: 'Profesional Prueba',
    };
    const fetchScaleHistoryEvents = vi.fn(async () => ({ events: [{ id: 'history' }] }));
    const fetchEvaluationForms = vi.fn(async () => ({ forms: [{ id: 'form' }] }));
    const deriveScaleHistory = vi.fn(() => [latest]);
    const runtime = loadOwner().create(
      createDependencies({
        fetchScaleHistoryEvents,
        fetchEvaluationForms,
        prescriptionPrint: {
          calculateCudyrCategory: vi.fn(() => ({ value: 'C2' })),
          deriveScaleHistory,
        },
      })
    );

    const result = await runtime.readRecoveryReview({
      encId: '906',
      instrument: 'DOWNTON',
      info: sessionInfo,
    });

    expect(result).toEqual({
      review: {
        kind: 'score',
        instrument: 'DOWNTON',
        present: true,
        value: '12',
        classification: 'Riesgo alto',
        dateTime: '18-07-2026 12:34:00',
        author: 'Profesional Prueba',
      },
    });
    expect(fetchScaleHistoryEvents).toHaveBeenCalledWith('906', sessionInfo, 120);
    expect(fetchEvaluationForms).toHaveBeenCalledWith('906', sessionInfo);
    expect(deriveScaleHistory).toHaveBeenCalledWith(
      [{ id: 'history' }],
      [{ id: 'form' }],
      'DOWNTON'
    );
  });
});

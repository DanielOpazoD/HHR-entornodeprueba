import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { vi } from 'vitest';

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
  sender?: Record<string, unknown>;
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
  readScoresBatch: vi.fn(async () => ({ patient: { ...patient }, info: sessionInfo })),
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

export {
  runtimeSource,
  modelSource,
  backgroundSource,
  loadOwner,
  createDependencies,
  sessionInfo,
  patient,
  cudyrFields,
  cudyrAnswers,
  response,
};

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { vi } from 'vitest';

const runtimeSource = readFileSync(path.resolve('extension/clinical-score-runtime.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');

type RuntimeDependencies = Record<string, unknown>;
type RuntimeApi = {
  handleOptionsRequest: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  handleCudyrCategoriesRequest: () => Promise<Record<string, unknown>>;
  handleFormRequest: (request: {
    batchId: string;
    encId: string;
    instrument: string;
    sender?: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  readScoresBatch: (
    batchId: string,
    encId: string,
    sender?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
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

const sender = { tab: { id: 5, url: 'https://hhr-entorno-prueba.netlify.app/' } };
const sessionIdentity = (info: Record<string, unknown>) =>
  JSON.stringify(
    [info.apiOrigin, info.facId, info.practitionerId, info.practitionerRoleId].map(value =>
      String(value || '')
    )
  );

export {
  runtimeSource,
  backgroundSource,
  loadFactory,
  createDependencies,
  gestionCamasRecord,
  sender,
  sessionIdentity,
};

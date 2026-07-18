// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const runtimeSource = readFileSync(
  path.resolve('extension/clinical-batch-print-runtime.js'),
  'utf8'
);
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');

type RuntimeDependencies = Record<string, unknown>;
type RuntimeApi = {
  handleHospitalizedPrescriptionOptionsRequest: (request: Record<string, unknown>) => Promise<any>;
  handleHospitalizedPrescriptionPrintRequest: (request: Record<string, unknown>) => Promise<any>;
  handleHospitalizedIndicationsOptionsRequest: (request: Record<string, unknown>) => Promise<any>;
  handleHospitalizedIndicationsPrintRequest: (request: Record<string, unknown>) => Promise<any>;
  handleHospitalizedRegimenOptionsRequest: (request: Record<string, unknown>) => Promise<any>;
  handleHospitalizedRegimenPrintRequest: () => Promise<any>;
  sweepPrescriptionBatches: (now?: number) => Promise<void>;
};

const loadFactory = () => {
  const context = vm.createContext({
    Date,
    Set,
    Map,
    Promise,
    Object,
    Number,
    String,
  });
  vm.runInContext(runtimeSource, context, { filename: 'clinical-batch-print-runtime.js' });
  return (
    context as unknown as {
      HhrClinicalBatchPrintRuntime: {
        create: (dependencies: RuntimeDependencies) => RuntimeApi;
      };
    }
  ).HhrClinicalBatchPrintRuntime;
};

const makeBuffer = (value: number) => new Uint8Array([value]).buffer;

const createDependencies = (overrides: RuntimeDependencies = {}) => ({
  chrome: {
    storage: {
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
  },
  crypto: { randomUUID: vi.fn(() => '12345678-1234-1234-1234-123456789012') },
  getFichaFetchInfo: vi.fn(async () => ({
    info: {
      apiOrigin: 'https://fichamedicoback.rayensalud.cl',
      token: '',
      expiresAt: 3_000_000,
    },
  })),
  fetchActiveHospitalizedPatients: vi.fn(async () => ({ patients: [] })),
  handleSnapshotRequest: vi.fn(async () => ({ snapshot: { encounters: [] } })),
  mapWithConcurrency: vi.fn(
    async (items: unknown[], _limit: number, worker: (item: any) => Promise<unknown>) =>
      Promise.all(items.map(worker))
  ),
  fetchPrescriptionEvents: vi.fn(async () => ({ events: [] })),
  fetchBradenHistoryEvents: vi.fn(async () => ({ events: [] })),
  fetchEvaluationForms: vi.fn(async () => ({ forms: [] })),
  fetchNutritionOrderEntry: vi.fn(async () => ({ entry: null })),
  verifySelectedEncountersStillHospitalized: vi.fn(async () => ({ ok: true })),
  fichaSessionCacheKey: vi.fn(async () => 'session-key'),
  createCompletePrescriptionPdf: vi.fn(async ({ encId }: { encId: string }) => ({
    buffer: makeBuffer(Number(encId)),
  })),
  fetchIndicationsReportBuffer: vi.fn(async ({ encId }: { encId: string }) => ({
    buffer: makeBuffer(Number(encId)),
  })),
  openPdfPrintDialog: vi.fn(async () => ({ ok: true, printTabId: 91 })),
  extensionRuntime: { ensurePdf: vi.fn() },
  pdfPrint: { mergePdfBuffers: vi.fn(async () => makeBuffer(99)) },
  prescriptionPrint: {
    activeHospitalizedEncounters: vi.fn((snapshot: { encounters?: unknown[] }) =>
      snapshot.encounters || []
    ),
    deriveLatestBraden: vi.fn(() => ({ total: 14 })),
    deriveLatestNutritionOrder: vi.fn(() => ({ description: 'Régimen común' })),
    applyProfessionalValidationDates: vi.fn((groups: unknown[]) => groups),
    deriveProfessionalPrescriptionGroups: vi.fn(() => [{ key: 'professional:1' }]),
    buildHospitalizedPrescriptionSummary: vi.fn((patient: any, groups: unknown[]) => ({
      ...patient,
      medicationCount: groups.length,
      unavailableReason: '',
    })),
    isPrescriptionBatchSessionValid: vi.fn(() => true),
    buildBatchPrescriptionFilename: vi.fn(() => 'Recetas_hospitalizados.pdf'),
    buildBatchIndicationsFilename: vi.fn(() => 'Indicaciones_hospitalizados.pdf'),
    buildRegimenFilename: vi.fn(() => 'Regimen_hospitalizados.pdf'),
  },
  prescriptionPdf: { generateIntegratedRegimenPdf: vi.fn(() => makeBuffer(88)) },
  now: vi.fn(() => 2_000_000),
  ...overrides,
});

describe('hospitalized clinical-document batch runtime owner', () => {
  it('loads at worker startup, fails closed and removes inline batch orchestration', () => {
    const startup = backgroundSource.slice(0, backgroundSource.indexOf('const REPORT_FILE'));

    expect(startup).toContain("'clinical-batch-print-runtime.js'");
    expect(startup).toContain('No se pudo cargar el runtime batch de documentos hospitalizados.');
    expect(backgroundSource).toContain('self.HhrClinicalBatchPrintRuntime.create({');
    expect(backgroundSource).not.toContain('const sweepPrescriptionBatches = async');
    expect(backgroundSource).not.toContain('const fetchHospitalizedRegimenSummaries = async');
    expect(backgroundSource).not.toContain(
      'const handleHospitalizedPrescriptionPrintRequest = async'
    );
    expect(runtimeSource).toContain('const handleHospitalizedPrescriptionPrintRequest = async');
    expect(runtimeSource).toContain('const handleHospitalizedIndicationsPrintRequest = async');
    expect(runtimeSource).toContain('const handleHospitalizedRegimenPrintRequest = async');
  });

  it('rejects incomplete dependency injection', () => {
    expect(() => loadFactory().create({})).toThrow(
      'No se pudo inicializar el runtime batch de documentos hospitalizados.'
    );
  });

  it('creates prescription options from the snapshot fallback and binds the allowlist to session expiry', async () => {
    const sessionSet = vi.fn(async () => undefined);
    const patient = { encounterId: '901', firstGivenName: 'Ana' };
    const dependencies = createDependencies({
      chrome: {
        storage: {
          session: {
            get: vi.fn(async () => ({})),
            set: sessionSet,
            remove: vi.fn(async () => undefined),
          },
        },
      },
      fetchActiveHospitalizedPatients: vi.fn(async () => ({ error: 'Lista no disponible.' })),
      handleSnapshotRequest: vi.fn(async () => ({ snapshot: { encounters: [patient] } })),
    });
    const runtime = loadFactory().create(dependencies);

    const result = await runtime.handleHospitalizedPrescriptionOptionsRequest({
      currentEncId: '901',
      sender: { tab: { id: 7 } },
    });

    expect(result).toMatchObject({
      ok: true,
      batchId: '12345678-1234-1234-1234-123456789012',
      unavailableCount: 0,
      patients: [{ encounterId: '901', medicationCount: 1 }],
    });
    expect(sessionSet).toHaveBeenCalledWith({
      'hhr-prescription-batch-12345678-1234-1234-1234-123456789012': {
        allowedEncounterIds: ['901'],
        createdAt: 2_000_000,
        sessionKey: 'session-key',
        expiresAt: 3_000_000,
      },
    });
  });

  it('revalidates the session, allowlist and hospitalization before bounded prescription generation', async () => {
    const batchId = '12345678-1234-1234-1234-123456789012';
    const storageKey = `hhr-prescription-batch-${batchId}`;
    const sessionSet = vi.fn(async () => undefined);
    const verifySelected = vi.fn(async () => ({ ok: true }));
    const mapWithConcurrency = vi.fn(
      async (items: string[], _limit: number, worker: (item: string) => Promise<unknown>) =>
        Promise.all(items.map(worker))
    );
    const createComplete = vi.fn(async ({ encId, allowOfficialFallback }: any) =>
      encId === '902'
        ? { error: 'PDF no disponible.' }
        : { buffer: makeBuffer(1), compactFallbackReason: allowOfficialFallback ? 'fallback' : '' }
    );
    const runtime = loadFactory().create(createDependencies({
      chrome: {
        storage: {
          session: {
            get: vi.fn(async () => ({
              [storageKey]: {
                allowedEncounterIds: ['901', '902'],
                createdAt: 1_500_000,
                sessionKey: 'session-key',
                expiresAt: 3_000_000,
              },
            })),
            set: sessionSet,
            remove: vi.fn(async () => undefined),
          },
        },
      },
      verifySelectedEncountersStillHospitalized: verifySelected,
      mapWithConcurrency,
      createCompletePrescriptionPdf: createComplete,
    }));

    const result = await runtime.handleHospitalizedPrescriptionPrintRequest({
      batchId,
      encIds: ['901', '999', '901', '902'],
      printFormat: 'compact',
      sender: { tab: { id: 7 } },
    });

    expect(verifySelected).toHaveBeenCalledWith(['901', '902'], expect.any(Object));
    expect(mapWithConcurrency).toHaveBeenCalledWith(['901', '902'], 2, expect.any(Function));
    expect(createComplete).toHaveBeenCalledWith(expect.objectContaining({
      encId: '901',
      printFormat: 'compact',
      allowOfficialFallback: true,
    }));
    expect(result).toMatchObject({
      ok: true,
      count: 1,
      skipped: [{ encId: '902', error: 'PDF no disponible.' }],
      compactFallbacks: [{ encId: '901', reason: 'fallback' }],
    });
    expect(sessionSet).toHaveBeenCalledWith({
      [storageKey]: expect.objectContaining({ lastUsedAt: 2_000_000 }),
    });
  });

  it('fails closed when the prescription session changes and removes the stale batch', async () => {
    const batchId = '12345678-1234-1234-1234-123456789012';
    const storageKey = `hhr-prescription-batch-${batchId}`;
    const remove = vi.fn(async (_keys: string | string[]) => undefined);
    const verifySelected = vi.fn();
    const runtime = loadFactory().create(createDependencies({
      chrome: {
        storage: {
          session: {
            get: vi.fn(async () => ({ [storageKey]: { sessionKey: 'old' } })),
            set: vi.fn(async () => undefined),
            remove,
          },
        },
      },
      prescriptionPrint: {
        ...(createDependencies().prescriptionPrint as object),
        isPrescriptionBatchSessionValid: vi.fn(() => false),
      },
      verifySelectedEncountersStillHospitalized: verifySelected,
    }));

    await expect(runtime.handleHospitalizedPrescriptionPrintRequest({
      batchId,
      encIds: ['901'],
      sender: {},
    })).resolves.toEqual({
      error: 'La sesión clínica cambió o venció. Actualiza la lista y vuelve a intentarlo.',
    });
    expect(remove).toHaveBeenCalledWith(storageKey);
    expect(verifySelected).not.toHaveBeenCalled();
  });

  it('preserves the 30-minute indications TTL and consumes a successful batch', async () => {
    const batchId = '12345678-1234-1234-1234-123456789012';
    const storageKey = `hhr-indications-batch-${batchId}`;
    const remove = vi.fn(async () => undefined);
    const session = {
      get: vi.fn(async () => ({
        [storageKey]: { allowedEncounterIds: ['901'], createdAt: 200_000 },
      })),
      set: vi.fn(async () => undefined),
      remove,
    };
    const runtime = loadFactory().create(createDependencies({
      chrome: { storage: { session } },
      now: vi.fn(() => 2_000_000),
    }));

    await expect(runtime.handleHospitalizedIndicationsPrintRequest({
      batchId,
      encIds: ['901'],
    })).resolves.toMatchObject({ ok: true, count: 1, skipped: [] });
    expect(remove).toHaveBeenCalledWith(storageKey);

    const expired = loadFactory().create(createDependencies({
      chrome: { storage: { session } },
      now: vi.fn(() => 2_000_001),
    }));
    await expect(expired.handleHospitalizedIndicationsPrintRequest({
      batchId,
      encIds: ['901'],
    })).resolves.toEqual({
      error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.',
    });
  });

  it('sweeps expired prescription sessions and retains only the 24 freshest valid batches', async () => {
    const stored = Object.fromEntries(Array.from({ length: 27 }, (_, index) => [
      `hhr-prescription-batch-${index}`,
      index === 0
        ? { createdAt: index, sessionKey: '', expiresAt: null }
        : { createdAt: index, lastUsedAt: index, sessionKey: 'session', expiresAt: null },
    ]));
    const remove = vi.fn(async (_keys: string | string[]) => undefined);
    const runtime = loadFactory().create(createDependencies({
      chrome: {
        storage: {
          session: {
            get: vi.fn(async () => stored),
            set: vi.fn(async () => undefined),
            remove,
          },
        },
      },
    }));

    await runtime.sweepPrescriptionBatches(2_000_000);

    expect(remove).toHaveBeenCalledOnce();
    const removed = remove.mock.calls[0][0] as string[];
    expect(new Set(removed)).toEqual(new Set([
      'hhr-prescription-batch-0',
      'hhr-prescription-batch-1',
      'hhr-prescription-batch-2',
    ]));
  });

  it('fails the integrated regimen closed when either BRADEN or nutrition cannot be verified', async () => {
    const patient = { encounterId: '901' };
    const generateIntegrated = vi.fn();
    const runtime = loadFactory().create(createDependencies({
      fetchActiveHospitalizedPatients: vi.fn(async () => ({ patients: [patient] })),
      fetchNutritionOrderEntry: vi.fn(async () => ({ error: 'Régimen no disponible.' })),
      fetchEvaluationForms: vi.fn(async () => ({ error: 'Formularios no disponibles.' })),
      prescriptionPdf: { generateIntegratedRegimenPdf: generateIntegrated },
    }));

    const options = await runtime.handleHospitalizedRegimenOptionsRequest({ currentEncId: '901' });
    expect(options).toMatchObject({
      ok: true,
      regimenErrorCount: 1,
      unavailableCount: 1,
      patients: [{
        encounterId: '901',
        isCurrent: true,
        regimenUnavailableReason: 'Régimen no disponible.',
        bradenUnavailableReason: 'Formularios no disponibles.',
      }],
    });

    await expect(runtime.handleHospitalizedRegimenPrintRequest()).resolves.toMatchObject({
      error: expect.stringContaining('el régimen de 1 paciente ni BRADEN de 1 paciente'),
    });
    expect(generateIntegrated).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import { createClinicalFillReaders } from '@/features/rayen-import/bridge/clinicalFillReaders';
import { readClinicalPatientSources } from '@/features/rayen-import/domain/clinicalPatientReaders';

const api = vi.hoisted(() => ({
  requestScalesReport: vi.fn(),
  requestEgresoLookup: vi.fn(),
  requestPatientClinicalBundle: vi.fn(),
  requestDeviceReport: vi.fn(async () => ({ entries: [], base64: '' })),
  requestHistoryScales: vi.fn(async () => ({ events: [], nursingActivity: [] })),
  requestCudyrCategories: vi.fn(),
  refreshSnapshot: vi.fn(),
}));
vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => api);
vi.mock('@/features/rayen-import/bridge/clinicalAuthorizationSnapshot', () => ({
  requestClinicalAuthorizationSnapshot: api.refreshSnapshot,
}));

type Sender = { origin: string; tab: { id: number; url: string } };
type Runtime = {
  authorizeSnapshotResponse: (sender: Sender, response: Promise<object>) => Promise<object>;
  authorizeVerifiedEncounter: (sender: Sender, id: string) => boolean;
  canRequestClinicalEpisode: (sender: Sender, id: string) => boolean;
};
const sender = { origin: 'http://localhost:3000', tab: { id: 44, url: 'http://localhost:3000/' } };
const candidate = {
  bedId: 'R1',
  clinicalCrib: false,
  patient: {
    patientName: 'Paciente sintético',
    rut: '12.345.678-5',
    clinicalEpisodeId: '142040',
  } as PatientData,
};

const loadRuntime = () => {
  const context = vm.createContext({ Date });
  for (const file of ['tab-encounter-authorization.js', 'fichamedico-patient-flow-runtime.js'])
    vm.runInContext(readFileSync(`extension/${file}`, 'utf8'), context);
  return vm.runInContext(
    'HhrFichaMedicoPatientFlowRuntime.create',
    context
  )({
    clinicalClient: { resolveSession: vi.fn(), readBuffer: vi.fn() },
    bufferToBase64: vi.fn(),
  }) as Runtime;
};

const scalesHandler = (runtime: Runtime) => {
  const source = readFileSync('extension/background.js', 'utf8');
  const start = source.indexOf('const handleScalesReportRequest =');
  const end = source.indexOf('\n};', start) + 3;
  return vm.runInContext(
    source.slice(start, end) + '\nhandleScalesReportRequest;',
    vm.createContext({
      patientFlowRuntime: runtime,
      resolveFichaClinicalSession: async () => ({ info: {} }),
      fetchScalesReportWithInfo: async () => ({ forms: [{ synthetic: true }] }),
    })
  ) as (request: {
    encId: string;
    sender: Sender;
  }) => Promise<{ forms?: unknown[]; error?: string }>;
};

describe('clinical authorization after proposal review', () => {
  let runtime: Runtime;
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    runtime = loadRuntime();
    await runtime.authorizeSnapshotResponse(
      sender,
      Promise.resolve({
        snapshot: { encounters: [{ encounterId: '142040' }] },
      })
    );
    api.requestScalesReport.mockImplementation((encId: string) =>
      scalesHandler(runtime)({ encId, sender })
    );
    api.requestPatientClinicalBundle.mockResolvedValue(null);
    api.refreshSnapshot.mockResolvedValue(null);
    api.requestDeviceReport.mockResolvedValue({ entries: [], base64: '' });
    api.requestHistoryScales.mockResolvedValue({ events: [], nursingActivity: [] });
    api.requestEgresoLookup.mockImplementation(
      async (targets: { run: string; encounterId: string }[]) => {
        // This models the existing exact-episode Gestión de Camas route, not a local grant.
        if (
          targets.length !== 1 ||
          targets[0].run !== '12.345.678-5' ||
          targets[0].encounterId !== '142040'
        )
          return [];
        runtime.authorizeVerifiedEncounter(sender, '142040');
        return [
          {
            run: '123456785',
            encounterId: '142040',
            egreso: { id: '142040', hasAdministrativeDischarge: false },
          },
        ];
      }
    );
  });
  afterEach(() => vi.useRealTimers());

  const read = async () => {
    const controller = new AbortController();
    const readers = createClinicalFillReaders(controller.signal, [candidate]);
    const slot = <T>(operation: () => Promise<T>) => operation();
    return readClinicalPatientSources({
      encId: '142040',
      fecha: '2026-10-15',
      lookbackDays: undefined,
      deps: { ...readers, extractDeviceItems: vi.fn(async () => []) },
      performance: { trackRequest: slot, recordTimeout: vi.fn(), recordRetries: vi.fn() },
      slots: { devices: slot, history: slot, forms: slot, bundle: slot },
    });
  };

  it.each(['expired proposal', 'recycled worker'] as const)(
    'recovers %s through a fresh exact episode lookup',
    async scenario => {
      if (scenario === 'expired proposal') await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
      else runtime = loadRuntime();
      const result = await read();
      expect(result[2]).toEqual({ status: 'fulfilled', value: { forms: [{ synthetic: true }] } });
      expect(api.requestScalesReport).toHaveBeenCalledTimes(2);
      expect(api.requestEgresoLookup).toHaveBeenCalledTimes(1);
    }
  );

  it('does not add lookups to a read whose grant is still valid', async () => {
    expect((await read())[2]).toEqual({
      status: 'fulfilled',
      value: { forms: [{ synthetic: true }] },
    });
    expect(api.requestScalesReport).toHaveBeenCalledTimes(1);
    expect(api.requestEgresoLookup).not.toHaveBeenCalled();
    expect(api.refreshSnapshot).not.toHaveBeenCalled();
  });

  it('renews active episodes through a fresh guarded capture when no egreso is available', async () => {
    runtime = loadRuntime();
    api.requestEgresoLookup.mockResolvedValue([]);
    api.refreshSnapshot.mockImplementation(async () => {
      const snapshot = { encounters: [{ encounterId: '142040', run: '123456785' }] };
      await runtime.authorizeSnapshotResponse(sender, Promise.resolve({ snapshot }));
      return snapshot;
    });
    expect((await read())[2]).toEqual({
      status: 'fulfilled',
      value: { forms: [{ synthetic: true }] },
    });
    expect(api.refreshSnapshot).toHaveBeenCalledTimes(1);
    expect(api.requestEgresoLookup).not.toHaveBeenCalled();
    expect(api.requestScalesReport).toHaveBeenCalledTimes(2);
  });

  it('recovers the bundle failure before its existing individual retry', async () => {
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    api.requestPatientClinicalBundle.mockImplementation(async () => ({
      devices: { entries: [], base64: '' },
      history: { events: [] },
      forms: await scalesHandler(runtime)({ encId: '142040', sender }),
    }));
    expect((await read())[2]).toEqual({
      status: 'fulfilled',
      value: { forms: [{ synthetic: true }] },
    });
    expect(api.requestScalesReport).toHaveBeenCalledTimes(1);
    expect(api.requestEgresoLookup).toHaveBeenCalledTimes(1);
  });

  it('keeps the original denied result when the exact source cannot verify the episode', async () => {
    runtime = loadRuntime();
    api.requestEgresoLookup.mockResolvedValue([]);
    const result = await read();
    expect(result[2]).toMatchObject({
      status: 'fulfilled',
      value: { error: expect.stringContaining('no fueron autorizadas') },
    });
    expect(api.requestEgresoLookup).toHaveBeenCalledTimes(1);
    expect(api.requestScalesReport).toHaveBeenCalledTimes(1);
  });
});

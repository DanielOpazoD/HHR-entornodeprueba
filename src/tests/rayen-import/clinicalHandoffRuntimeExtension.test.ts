// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const runtimeSource = readFileSync(
  path.resolve('extension/clinical-handoff-runtime.js'),
  'utf8'
);
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');
const readmeSource = readFileSync(path.resolve('extension/README.md'), 'utf8');

type RuntimeDependencies = Record<string, any>;
type RuntimeApi = {
  handleOptionsRequest: (request: Record<string, unknown>) => Promise<any>;
  handleSaveRequest: (request: Record<string, unknown>) => Promise<any>;
  handleReportRequest: (request: Record<string, unknown>) => Promise<any>;
  readRecoveryReview: (request: Record<string, unknown>) => Promise<any>;
  readBatch: (batchId: string, encId: string) => Promise<any>;
};

const loadFactory = () => {
  const context = vm.createContext({
    URL,
    Date,
    Set,
    Promise,
    Object,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    RegExp,
    encodeURIComponent,
  });
  vm.runInContext(runtimeSource, context, { filename: 'clinical-handoff-runtime.js' });
  return (
    context as unknown as {
      HhrClinicalHandoffRuntime: {
        create: (dependencies: RuntimeDependencies) => RuntimeApi;
      };
    }
  ).HhrClinicalHandoffRuntime;
};

const TEST_NOW = Date.UTC(2026, 6, 18, 12, 0, 0);
const BATCH_ID = '12345678-1234-1234-1234-123456789012';
const INFO = {
  apiOrigin: 'https://fichamedicoback.rayensalud.cl',
  token: 'test-auth-token',
  facId: '9',
  practitionerId: '41',
  practitionerRoleId: '42',
  identityVerified: true,
  fullName: 'Elena Soto',
  role: 'Enfermera',
};

const response = ({
  ok = true,
  status = 200,
  json = [],
  text = '',
}: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
} = {}) => ({
  ok,
  status,
  json: vi.fn(async () => json),
  text: vi.fn(async () => text),
});

const createDependencies = (overrides: RuntimeDependencies = {}) => {
  const records = new Map<string, unknown>();
  const session = {
    get: vi.fn(async (key: string) => ({ [key]: records.get(key) })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.entries(values).forEach(([key, value]) => records.set(key, value));
    }),
  };
  const fetchWithTimeout = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/nurseStation')) {
      return response({ json: [{ id: 7, shortName: 'Medicina' }] });
    }
    if (url.includes('/shiftChangeObservationEntry/') && !options?.method) {
      return response({ json: [] });
    }
    return response();
  });
  const prescriptionPrint = {
    handoffEncounterEventTypeId: vi.fn((kind: string) => kind === 'medical' ? 1 : 2),
    deriveLatestShiftChange: vi.fn((entries: any[], options: { kind: string }) => {
      const latest = [...entries].reverse().find(entry => !entry.kind || entry.kind === options.kind);
      return latest ? {
        ...latest,
        dateTime: latest.startDateTime || latest.dateTime || '',
        author: latest.author || '',
      } : null;
    }),
    entryMatchesHandoffKind: vi.fn((entry: any, kind: string) =>
      !entry.kind || entry.kind === kind
    ),
  };
  return {
    records,
    chrome: { storage: { session } },
    crypto: { randomUUID: vi.fn(() => BATCH_ID) },
    fetchWithTimeout,
    getFichaFetchInfo: vi.fn(async () => ({ info: { ...INFO } })),
    resolveSessionHandoffKind: vi.fn(() => 'nursing'),
    fetchFichaClaims: vi.fn(async () => ({ claims: [] })),
    hasFichaClaim: vi.fn(() => true),
    fetchActiveHospitalizedPatients: vi.fn(async () => ({
      patients: [{ encounterId: '901', firstGivenName: 'Ana' }],
    })),
    mapWithConcurrency: vi.fn(
      async (items: unknown[], _limit: number, worker: (item: any) => Promise<unknown>) =>
        Promise.all(items.map(worker))
    ),
    serializeClinicalWriteProtection: vi.fn(async () => ({ phase: 'idle' })),
    withClinicalWriteLock: vi.fn(async (_key: string, task: (guard: any) => Promise<any>) =>
      task({ beginWrite: vi.fn(async () => ({ ok: true })) })
    ),
    verifyEncounterStillHospitalized: vi.fn(async () => ({ ok: true })),
    clinicalRecordKey: vi.fn((_kind: string, row: any) => String(row.id || 'baseline')),
    collectClinicalTimestampBaseline: vi.fn(() => ({ maxTimestampMs: 0 })),
    hasNewClinicalTimestamp: vi.fn(() => true),
    fetchOfficialPdf: vi.fn(async () => ({ buffer: new ArrayBuffer(4) })),
    openPdfPrintDialog: vi.fn(async () => ({ ok: true, printTabId: 77 })),
    prescriptionPrint,
    now: vi.fn(() => TEST_NOW),
    wait: vi.fn(async () => undefined),
    ...overrides,
  };
};

const seedBatch = (dependencies: RuntimeDependencies, overrides = {}) => {
  dependencies.records.set(`hhr-handoff-batch-${BATCH_ID}`, {
    allowedEncounterIds: ['901'],
    createdAt: TEST_NOW,
    handoffKind: 'nursing',
    practitionerRoleId: '42',
    ...overrides,
  });
};

describe('clinical handoff runtime owner', () => {
  it('loads before routing, fails closed and removes the inline owner from background', () => {
    const startup = backgroundSource.slice(0, backgroundSource.indexOf('const REPORT_FILE'));

    expect(startup).toContain("'clinical-handoff-runtime.js'");
    expect(startup).toContain('No se pudo cargar el runtime clínico de entrega de turno.');
    expect(backgroundSource).toContain('self.HhrClinicalHandoffRuntime.create({');
    expect(backgroundSource).toContain(
      'return clinicalHandoffRuntime.readRecoveryReview({ encId, info });'
    );
    expect(backgroundSource).not.toContain('const fetchShiftChangeEntries = async');
    expect(backgroundSource).not.toContain('const readHandoffBatch = async');
    expect(backgroundSource).not.toContain('const performHandoffSaveRequest = async');
    expect(runtimeSource).toContain('const performSaveRequest = async');
  });

  it('documents the current UI owners and the extracted runtime without the removed owner', () => {
    expect(readmeSource).toContain('`hhr-handoff-center.js`, `hhr-scores-center.js`');
    expect(readmeSource).toContain('`clinical-handoff-runtime.js`');
    expect(readmeSource).not.toContain('`hhr-handoff-scores-center.js`');
  });

  it('rejects incomplete dependency injection', () => {
    expect(() => loadFactory().create({})).toThrow(
      'No se pudo inicializar el runtime clínico de entrega de turno.'
    );
  });

  it('builds nursing options with both lanes, write protection and a role-bound allowlist', async () => {
    const dependencies = createDependencies();
    const runtime = loadFactory().create(dependencies);

    const result = await runtime.handleOptionsRequest({ currentEncId: '901' });

    expect(result).toMatchObject({
      ok: true,
      batchId: BATCH_ID,
      canWrite: true,
      canPrint: true,
      handoffKind: 'nursing',
      currentProfessional: 'Elena Soto',
      currentProfessionalRole: 'Enfermería',
      nurseStations: [{ id: '7', name: 'Medicina' }],
      patients: [{ encounterId: '901', isCurrent: true, clinicalWriteProtection: { phase: 'idle' } }],
    });
    expect(dependencies.mapWithConcurrency).toHaveBeenCalledWith(
      expect.any(Array),
      4,
      expect.any(Function)
    );
    expect(dependencies.serializeClinicalWriteProtection).toHaveBeenCalledWith('handoff:901');
    expect(dependencies.records.get(`hhr-handoff-batch-${BATCH_ID}`)).toEqual({
      allowedEncounterIds: ['901'],
      createdAt: TEST_NOW,
      handoffKind: 'nursing',
      practitionerRoleId: '42',
    });
  });

  it('rejects expired batches and encounters outside their allowlist', async () => {
    const dependencies = createDependencies();
    const runtime = loadFactory().create(dependencies);
    seedBatch(dependencies, { createdAt: TEST_NOW - 30 * 60 * 1000 - 1 });

    await expect(runtime.readBatch(BATCH_ID, '901')).resolves.toEqual({
      error: 'La sesión de entrega expiró. Actualiza el módulo y vuelve a intentarlo.',
    });
    seedBatch(dependencies, { allowedEncounterIds: ['902'] });
    await expect(runtime.readBatch(BATCH_ID, '901')).resolves.toEqual({
      error: 'El paciente no pertenece a esta lista de hospitalizados.',
    });
  });

  it('writes once, verifies the read-back and confirms the matching FinishRegister event', async () => {
    const beginWrite = vi.fn(async () => ({ ok: true }));
    const withClinicalWriteLock = vi.fn(
      async (_key: string, task: (guard: any) => Promise<any>) => task({ beginWrite })
    );
    let shiftReads = 0;
    const fetchWithTimeout = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/shiftChangeObservationEntry/') && !options?.method) {
        shiftReads += 1;
        return response({
          json: shiftReads === 1 ? [] : [{
            id: 77,
            kind: 'nursing',
            observation: 'Paciente estable',
            startDateTime: '2026-07-18T12:00:01.000Z',
            authorHealthCarePractitionerId: 41,
            author: 'Elena Soto',
          }],
        });
      }
      if (url.endsWith('/shiftChangeObservationEntry') && options?.method === 'POST') {
        return response({ text: '{"id":77}' });
      }
      if (url.includes('/getFinishRegister')) {
        return response({ text: JSON.stringify({
          id: 88,
          encounterId: 901,
          facilityId: 9,
          healthCarePractitionerRoleId: 42,
          healthCarePractitionerLegalId: 41,
        }) });
      }
      if (url.includes('/confirmedEncounterEvent')) return response();
      throw new Error(`Solicitud inesperada: ${url}`);
    });
    const dependencies = createDependencies({ fetchWithTimeout, withClinicalWriteLock });
    seedBatch(dependencies);
    const runtime = loadFactory().create(dependencies);

    const result = await runtime.handleSaveRequest({
      batchId: BATCH_ID,
      encId: '901',
      observation: '  Paciente estable  ',
    });

    expect(result).toMatchObject({
      ok: true,
      verified: true,
      finishConfirmed: true,
      record: { id: 77, observation: 'Paciente estable', isSigned: true },
    });
    expect(withClinicalWriteLock).toHaveBeenCalledWith('handoff:901', expect.any(Function));
    expect(beginWrite).toHaveBeenCalledOnce();
    const post = fetchWithTimeout.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      encounterId: 901,
      observation: 'Paciente estable',
      encounterEventTypeId: 2,
      authorHealthCarePractitionerId: 41,
      authorHealthCarePractitionerRoleId: 42,
    });
    const finish = fetchWithTimeout.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(finish?.[0]).toContain('/encounter/901/encounterEvent/88/confirmedEncounterEvent');
    expect(finish?.[0]).toContain('healthCarePractitionerRoleId=42');
    expect(finish?.[0]).toContain('facilityId=9');
  });

  it('never accepts a read-back after an unacknowledged POST', async () => {
    let shiftReads = 0;
    const fetchWithTimeout = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/shiftChangeObservationEntry/') && !options?.method) {
        shiftReads += 1;
        return response({ json: shiftReads === 1 ? [] : [{
          id: 77,
          kind: 'nursing',
          observation: 'Paciente estable',
          startDateTime: '2026-07-18T12:00:01.000Z',
          authorHealthCarePractitionerId: 41,
        }] });
      }
      if (options?.method === 'POST') return response({ ok: false, status: 503 });
      throw new Error(`No debe confirmar FinishRegister: ${url}`);
    });
    const wait = vi.fn(async () => undefined);
    const dependencies = createDependencies({ fetchWithTimeout, wait });
    seedBatch(dependencies);
    const runtime = loadFactory().create(dependencies);

    const result = await runtime.handleSaveRequest({
      batchId: BATCH_ID,
      encId: '901',
      observation: 'Paciente estable',
    });

    expect(result).toEqual({
      error: 'Eloísa respondió HTTP 503 al guardar la entrega. ' +
        'La entrega pudo haberse guardado, pero Eloísa aún no permitió verificarla. ' +
        'Actualiza antes de reintentar.',
      writeMayHaveSucceeded: true,
    });
    expect(wait).toHaveBeenNthCalledWith(1, 250);
    expect(wait).toHaveBeenNthCalledWith(2, 500);
    expect(fetchWithTimeout).not.toHaveBeenCalledWith(
      expect.stringContaining('/getFinishRegister'),
      expect.anything()
    );
  });

  it('fails closed when FinishRegister belongs to a different role', async () => {
    let shiftReads = 0;
    const fetchWithTimeout = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/shiftChangeObservationEntry/') && !options?.method) {
        shiftReads += 1;
        return response({ json: shiftReads === 1 ? [] : [{
          id: 77,
          kind: 'nursing',
          observation: 'Paciente estable',
          startDateTime: '2026-07-18T12:00:01.000Z',
          authorHealthCarePractitionerId: 41,
        }] });
      }
      if (options?.method === 'POST') return response({ text: '{"id":77}' });
      if (url.includes('/getFinishRegister')) {
        return response({ text: JSON.stringify({
          id: 88,
          encounterId: 901,
          facilityId: 9,
          healthCarePractitionerRoleId: 999,
          healthCarePractitionerLegalId: 41,
        }) });
      }
      throw new Error(`Solicitud inesperada: ${url}`);
    });
    const dependencies = createDependencies({ fetchWithTimeout });
    seedBatch(dependencies);
    const runtime = loadFactory().create(dependencies);

    const result = await runtime.handleSaveRequest({
      batchId: BATCH_ID,
      encId: '901',
      observation: 'Paciente estable',
    });

    expect(result).toMatchObject({
      writeMayHaveSucceeded: true,
      error: expect.stringContaining(
        'El evento pendiente no coincide con este episodio, establecimiento o rol clínico.'
      ),
    });
    expect(fetchWithTimeout.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  });

  it('owns the handoff recovery read and preserves lane attribution', async () => {
    const fetchWithTimeout = vi.fn(async () => response({ json: [{
      id: 77,
      kind: 'nursing',
      observation: 'Paciente estable',
      dateTime: '2026-07-18T12:00:01.000Z',
      author: 'Elena Soto',
    }] }));
    const runtime = loadFactory().create(createDependencies({ fetchWithTimeout }));

    await expect(runtime.readRecoveryReview({ encId: '901', info: INFO })).resolves.toEqual({
      review: {
        kind: 'handoff',
        handoffKind: 'nursing',
        present: true,
        value: 'Paciente estable',
        dateTime: '2026-07-18T12:00:01.000Z',
        author: 'Elena Soto',
      },
    });
  });

  it('limits the official report to an authorized nursing identity and encodes its filters', async () => {
    const fetchOfficialPdf = vi.fn(async () => ({ buffer: new ArrayBuffer(8) }));
    const openPdfPrintDialog = vi.fn(async () => ({ ok: true, printTabId: 91 }));
    const runtime = loadFactory().create(createDependencies({
      fetchOfficialPdf,
      openPdfPrintDialog,
    }));

    await expect(runtime.handleReportRequest({ nurseStationId: '7' })).resolves.toEqual({
      ok: true,
      printTabId: 91,
    });
    expect(fetchOfficialPdf).toHaveBeenCalledWith({
      url: 'https://fichamedicoback.rayensalud.cl/api/report/Reporte_Entrega_Turno_Enfermera.pdf' +
        '?fac_id=9&hcp_id=41&nus_id=7&hcpr_id=42',
      token: 'test-auth-token',
      label: 'la entrega de turno',
    });
    expect(openPdfPrintDialog).toHaveBeenCalledWith({
      buffer: expect.any(ArrayBuffer),
      filename: 'Entrega_turno_enfermeria_2026-07-18.pdf',
    });
  });
});

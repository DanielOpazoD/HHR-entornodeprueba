// @vitest-environment node
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/fichamedico-patient-context.js';

type PatientContext = {
  normalizeHospitalizedEncounter: (
    row: Record<string, unknown>,
    header?: Record<string, unknown> | null
  ) => Record<string, unknown>;
  mapWithConcurrency: <T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>
  ) => Promise<R[]>;
  getClinicalReportContext: (
    encId: string,
    info?: Record<string, unknown> | null,
    referenceDateTime?: Date | null,
    sender?: unknown
  ) => Promise<Record<string, any>>;
  fetchActiveHospitalizedPatients: (info: Record<string, unknown>) => Promise<Record<string, any>>;
  verifyEncounterStillHospitalized: (
    encId: string,
    info: Record<string, unknown>
  ) => Promise<Record<string, any>>;
  verifySelectedEncountersStillHospitalized: (
    encIds: string[],
    info: Record<string, unknown>
  ) => Promise<Record<string, any>>;
  handlePatientHeaderRequest: (request: Record<string, unknown>) => Promise<Record<string, any>>;
  handleCensusListRequest: (request: Record<string, unknown>) => Promise<Record<string, any>>;
  handleVitalsCensusRequest: (request: Record<string, unknown>) => Promise<Record<string, any>>;
};

type PatientContextFactory = {
  create: (dependencies: Record<string, unknown>) => PatientContext;
};

const factory = (
  globalThis as typeof globalThis & { HhrFichaMedicoPatientContext: PatientContextFactory }
).HhrFichaMedicoPatientContext;

const accessKey = ['to', 'ken'].join('');
const accessValue = ['synthetic', 'session', 'value'].join(':');
const session = {
  [accessKey]: accessValue,
  apiOrigin: 'https://fichamedicoback.rayensalud.cl',
  facId: '9',
  practitionerId: '81',
  practitionerRoleId: '2',
  role: 'Médico',
};

const activeRows = [
  {
    id: 901,
    patient: { identifier: '11111111-1', firstGivenName: 'Ana', firstFamilyName: 'Rapa' },
    hospitalDepartmentShortName: 'MED',
    bedShortName: '12-A',
  },
];

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createHarness = (overrides: Record<string, unknown> = {}) => {
  const resolveSession = vi.fn(
    async ({ info }: { info?: Record<string, unknown> } = {}): Promise<{
      info?: Record<string, unknown>;
      error?: string;
    }> => ({ info: info || session })
  );
  const fetchPatientHeader = vi.fn(
    async (): Promise<Record<string, unknown>> => ({
      patID: 71,
      preferredIdentifierCode: '11111111-1',
      firstGivenName: 'Ana',
      nextGivenNames: 'María',
      firstFamilyName: 'Rapa',
      secondFamilyName: 'Haoa',
      birthDate: '1986-01-02',
      gendName: 'Femenino',
      bedShortName: '12-A',
      roomShortName: '12',
      hdeShortName: 'MED',
      principalDiagName: 'Diagnóstico',
    })
  );
  const fetchActiveEncounterRows = vi.fn(async () => ({ rows: activeRows }));
  const fetchScalesReportWithInfo = vi.fn(async () => ({ forms: [{ formCodigo: 'VITAL_SIGNS' }] }));
  const warn = vi.fn();
  let currentTime = Date.parse('2026-07-19T08:00:00Z');
  const dependencies = {
    crypto: webcrypto,
    TextEncoder,
    resolveSession,
    fetchPatientHeader,
    fetchActiveEncounterRows,
    fetchScalesReportWithInfo,
    prescriptionPrint: {
      formatAgeLabel: vi.fn(() => '40 años'),
      formatRun: vi.fn((value: unknown) =>
        String(value || '').replace(/^(\d{1,2})(\d{3})(\d{3})-/, '$1.$2.$3-')
      ),
      activeHospitalizedEncounters: vi.fn(
        (snapshot: { encounters: Array<Record<string, unknown>> }) => snapshot.encounters
      ),
    },
    warn,
    now: vi.fn(() => currentTime),
    ...overrides,
  };
  return {
    context: factory.create(dependencies),
    dependencies,
    resolveSession,
    fetchPatientHeader,
    fetchActiveEncounterRows,
    fetchScalesReportWithInfo,
    warn,
    advanceTime: (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
};

describe('Ficha Médico patient-context owner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads before background orchestration, fails closed when absent and owns the extracted seam', () => {
    const background = readFileSync(
      new URL('../../../extension/background.js', import.meta.url),
      'utf8'
    );
    const source = readFileSync(
      new URL('../../../extension/fichamedico-patient-context.js', import.meta.url),
      'utf8'
    );
    const startup = background.slice(0, background.indexOf('const REPORT_FILE'));

    expect(startup).toContain("'fichamedico-patient-context.js'");
    expect(startup.indexOf("'fichamedico-patient-context.js'")).toBeLessThan(
      startup.indexOf("'clinical-panel-runtime.js'")
    );
    expect(startup).toContain(
      'No se pudo cargar el contexto clínico de pacientes de Ficha Médico.'
    );
    expect(background).toContain('self.HhrFichaMedicoPatientContext.create({');
    expect(background).not.toContain('const normalizeHospitalizedEncounter =');
    expect(background).not.toContain('const getClinicalReportContext = async');
    expect(background).not.toContain('const fetchActiveHospitalizedPatients = async');
    expect(background).not.toContain('const verifyEncounterStillHospitalized = async');
    expect(source).toContain('const normalizeHospitalizedEncounter =');
    expect(source).toContain('const getClinicalReportContext = async');
    expect(source).not.toMatch(/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
    // El paquete clínico por paciente también vive extraído; en background sólo
    // queda su cableado (create + ruta), igual que el contexto de pacientes.
    expect(background).toContain('self.HhrPatientClinicalBundleRuntime.create({');
    expect(background).not.toContain('const section = async read');
    // Presupuesto-trinquete: sube únicamente junto a lógica ya extraída.
    // 1455: +latido de salud (instancia del runtime, capability health-push y
    // tres rutas GC envueltas con pushAfter); la lógica vive en
    // health-heartbeat-runtime.js.
    expect(background.split('\n').length).toBeLessThanOrEqual(1_455);
    expect(source.split('\n').length).toBeLessThanOrEqual(380);
    expect(() => factory.create({})).toThrow('Falta la dependencia resolveSession.');
  });

  it('builds the clinical context and preserves invalid-session, incomplete-data and HTTP failures', async () => {
    const { context, resolveSession, fetchPatientHeader } = createHarness();

    await expect(context.getClinicalReportContext('invalid')).resolves.toEqual({
      error: 'El episodio clínico no es válido.',
    });
    expect(resolveSession).not.toHaveBeenCalled();

    resolveSession.mockResolvedValueOnce({ error: 'Sesión clínica inválida.' });
    await expect(context.getClinicalReportContext('901')).resolves.toEqual({
      error: 'Sesión clínica inválida.',
    });

    await expect(
      context.getClinicalReportContext('901', session, new Date('2026-07-19T00:00:00Z'))
    ).resolves.toMatchObject({
      info: session,
      patientId: '71',
      patient: {
        name: 'Ana María Rapa Haoa',
        run: '11111111-1',
        age: '40 años',
        bed: '12-A',
        service: 'MED',
      },
    });

    fetchPatientHeader.mockResolvedValueOnce({
      patient: {},
      estimatedAge: 4,
      ageUnit: ' años ',
    });
    await expect(context.getClinicalReportContext('902', session)).resolves.toEqual({
      error: 'Eloísa no informó el identificador interno del paciente.',
    });

    fetchPatientHeader.mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), {
        kind: 'http',
        status: 403,
      })
    );
    await expect(context.getClinicalReportContext('903', session)).resolves.toEqual({
      error: 'Eloísa respondió HTTP 403 al identificar al paciente.',
    });
  });

  it('normalizes incomplete census rows through pure header and fallback rules', () => {
    const { context } = createHarness();
    const fromHeader = context.normalizeHospitalizedEncounter(activeRows[0], {
      patID: 71,
      preferredIdentifierCode: '22222222-2',
      firstGivenName: 'Elena',
      firstFamilyName: 'Tuki',
      principalDiagName: 'Neumonía',
    });
    const fromFallback = context.normalizeHospitalizedEncounter({
      encounterId: 902,
      patientIdentifier: '33333333-3',
      patientName: 'Paciente sin cabecera',
      roomName: 'Sala B',
      medicalDischargeDateTime: '2026-07-19T09:00:00Z',
      isDead: true,
    });

    expect(fromHeader).toMatchObject({
      encounterId: '901',
      run: '22222222-2',
      firstGivenName: 'Elena',
      firstFamilyName: 'Tuki',
      patientId: 71,
      diagnosis: 'Neumonía',
      bed: '12-A',
    });
    expect(fromFallback).toMatchObject({
      encounterId: '902',
      run: '33333333-3',
      firstGivenName: 'Paciente sin cabecera',
      room: 'Sala B',
      hasMedicalDischarge: false,
      dischargeDatetime: '2026-07-19T09:00:00Z',
      isDead: true,
    });
  });

  it('bounds concurrent header reads, preserves order and warns when census fallback is used', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      id: 100 + index,
      patient: { identifier: `fallback-${index}`, firstGivenName: `Fallback ${index}` },
    }));
    const headerReads = rows.map(() => createDeferred<Record<string, unknown>>());
    const readStarted = rows.map(() => createDeferred<void>());
    const startedEncounterIds: string[] = [];
    let activeReads = 0;
    let maximumReads = 0;
    const fetchPatientHeader = vi.fn(async (encId: string) => {
      const index = Number(encId) - 100;
      activeReads += 1;
      maximumReads = Math.max(maximumReads, activeReads);
      startedEncounterIds.push(encId);
      readStarted[index].resolve();
      try {
        return await headerReads[index].promise;
      } finally {
        activeReads -= 1;
      }
    });
    const { context, warn } = createHarness({
      fetchPatientHeader,
      fetchActiveEncounterRows: vi.fn(async () => ({ rows })),
    });

    const resultPromise = context.fetchActiveHospitalizedPatients(session);
    await Promise.all(readStarted.slice(0, 6).map(started => started.promise));

    expect(startedEncounterIds).toEqual(['100', '101', '102', '103', '104', '105']);
    expect(fetchPatientHeader).toHaveBeenCalledTimes(6);
    expect(activeReads).toBe(6);
    expect(maximumReads).toBe(6);

    headerReads[4].reject(new Error('cabecera temporalmente indisponible'));
    await readStarted[6].promise;
    expect(startedEncounterIds).toEqual(['100', '101', '102', '103', '104', '105', '106']);
    expect(activeReads).toBe(6);

    headerReads[2].resolve({
      patID: '102',
      preferredIdentifierCode: 'run-102',
      firstGivenName: '102',
    });
    await readStarted[7].promise;
    headerReads[0].resolve({
      patID: '100',
      preferredIdentifierCode: 'run-100',
      firstGivenName: '100',
    });
    await readStarted[8].promise;

    for (const index of [8, 6, 7, 5, 3, 1]) {
      headerReads[index].resolve({
        patID: String(100 + index),
        preferredIdentifierCode: `run-${100 + index}`,
        firstGivenName: String(100 + index),
      });
    }
    const result = await resultPromise;

    expect(maximumReads).toBe(6);
    expect(activeReads).toBe(0);
    expect(result.patients.map((patient: Record<string, unknown>) => patient.encounterId)).toEqual(
      rows.map(row => String(row.id))
    );
    expect(result.patients.map((patient: Record<string, unknown>) => patient.run)).toEqual([
      'run-100',
      'run-101',
      'run-102',
      'run-103',
      'fallback-4',
      'run-105',
      'run-106',
      'run-107',
      'run-108',
    ]);
    expect(result.patients[4]).toMatchObject({
      run: 'fallback-4',
      firstGivenName: 'Fallback 4',
    });
    expect(warn).toHaveBeenCalledWith(
      'No se pudo leer una cabecera de paciente hospitalizado; se usará el censo activo.',
      'cabecera temporalmente indisponible'
    );
  });

  it('isolates and expires the patient-header cache by session and sender tab', async () => {
    const { context, fetchPatientHeader, advanceTime } = createHarness();
    const request = { encId: '901', sender: { tab: { id: 17 } } };

    const first = await context.handlePatientHeaderRequest(request);
    const cached = await context.handlePatientHeaderRequest(request);
    expect(cached).toEqual(first);
    expect(fetchPatientHeader).toHaveBeenCalledTimes(1);

    await context.handlePatientHeaderRequest({ ...request, sender: { tab: { id: 18 } } });
    expect(fetchPatientHeader).toHaveBeenCalledTimes(2);

    advanceTime(60_001);
    await context.handlePatientHeaderRequest(request);
    expect(fetchPatientHeader).toHaveBeenCalledTimes(3);
    expect(first.patient.formattedRun).toBe('11.111.111-1');
  });

  it('rejects discharged or deceased encounters and reports changed batch selections', async () => {
    const rows = [
      { id: 901 },
      { id: 902, hasMedicalDischarge: true },
      { id: 903, medicalDischargeDateTime: '2026-07-19T09:00:00Z' },
      { id: 904, isDead: true },
    ];
    const { context } = createHarness({
      fetchActiveEncounterRows: vi.fn(async () => ({ rows })),
    });

    await expect(context.verifyEncounterStillHospitalized('901', session)).resolves.toEqual({
      ok: true,
      encounter: rows[0],
    });
    for (const encId of ['902', '903', '904']) {
      await expect(context.verifyEncounterStillHospitalized(encId, session)).resolves.toEqual({
        error: 'El paciente ya no figura hospitalizado. Actualiza el módulo antes de registrar.',
      });
    }
    await expect(
      context.verifySelectedEncountersStillHospitalized(['901', '902', '904'], session)
    ).resolves.toEqual({
      error:
        'La hospitalización cambió para 2 pacientes seleccionados. Actualiza el módulo antes de imprimir.',
    });
  });

  it('returns a structured error when batch hospitalization verification cannot read encounters', async () => {
    const { context } = createHarness({
      fetchActiveEncounterRows: vi.fn(async () => {
        throw new Error('network offline');
      }),
    });

    await expect(
      context.verifySelectedEncountersStillHospitalized(['901'], session)
    ).resolves.toEqual({
      error: 'No se pudo confirmar la hospitalización: network offline',
    });
  });

  it('keeps census and vitals response formats while marking individual read failures', async () => {
    const rows = [
      { id: 901, bedShortName: '12-A', hospitalDepartmentShortName: 'MED' },
      { id: 902, roomShortName: 'B' },
    ];
    const headers: Record<string, Record<string, unknown>> = {
      '901': {
        patID: 71,
        preferredIdentifierCode: '11111111-1',
        firstGivenName: 'Ana',
        firstFamilyName: 'Rapa',
      },
      '902': {
        patID: 72,
        preferredIdentifierCode: '22222222-2',
        firstGivenName: 'Ema',
        firstFamilyName: 'Tuki',
        birthDate: '1990-02-03',
      },
    };
    const fetchScalesReportWithInfo = vi
      .fn()
      .mockResolvedValueOnce({ forms: [{ formCodigo: 'VITAL_SIGNS' }] })
      .mockResolvedValueOnce({ error: 'Lectura no disponible.' });
    const { context } = createHarness({
      fetchActiveEncounterRows: vi.fn(async () => ({ rows })),
      fetchPatientHeader: vi.fn(async (encId: string) => headers[encId]),
      fetchScalesReportWithInfo,
    });

    await expect(
      context.handleCensusListRequest({ currentEncId: '902', sender: { tab: { id: 17 } } })
    ).resolves.toMatchObject({
      ok: true,
      patients: [
        { encounterId: '901', bed: '12-A', isCurrent: false },
        { encounterId: '902', bed: 'B', isCurrent: true },
      ],
    });
    await expect(
      context.handleVitalsCensusRequest({ currentEncId: '901', sender: { tab: { id: 17 } } })
    ).resolves.toMatchObject({
      ok: true,
      patients: [
        { encounterId: '901', forms: [{ formCodigo: 'VITAL_SIGNS' }], unavailableReason: '' },
        { encounterId: '902', forms: [], unavailableReason: 'Lectura no disponible.' },
      ],
    });
  });
});

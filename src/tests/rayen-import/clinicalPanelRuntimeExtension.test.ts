// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import '../../../extension/clinical-panel-fetch.js';
import '../../../extension/clinical-panel-runtime.js';

type FetchInput = {
  url: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  [key: string]: unknown;
};

type ClinicalPanelDependencies = {
  fetchImpl: typeof fetch;
  fetchJsonWithTimeout: (input: FetchInput) => Promise<unknown>;
  fetchMedicationPages: (input: {
    fetchPage: (page: number, limit: number) => Promise<unknown>;
    pageSize?: number;
    maxPages?: number;
  }) => Promise<unknown[]>;
  unwrapRequiredSources: (
    sources: Array<{ label: string; result: PromiseSettledResult<unknown> }>
  ) => unknown[];
  resolveSession: () => Promise<unknown>;
  fetchCurrentValidation: (encId: string, info: unknown) => Promise<unknown>;
  timeoutMs: number;
};

type ClinicalPanelRuntime = {
  handleRequest: (input: { encId: string }) => Promise<Record<string, unknown>>;
};

const globals = globalThis as typeof globalThis & {
  HhrClinicalPanelFetch: Pick<
    ClinicalPanelDependencies,
    'fetchMedicationPages' | 'unwrapRequiredSources'
  >;
  HhrClinicalPanelRuntime: {
    create: (dependencies: ClinicalPanelDependencies) => ClinicalPanelRuntime;
  };
};

const apiOrigin = 'https://fichamedicoback.rayensalud.cl';
const sessionValue = 'fixture-session-value';
const sessionKey = ['to', 'ken'].join('');
const info = { apiOrigin, [sessionKey]: sessionValue, practitionerId: '81' };
const fetchImpl = vi.fn() as unknown as typeof fetch;

const createHarness = (overrides: Partial<ClinicalPanelDependencies> = {}) => {
  const fetchJsonWithTimeout = vi.fn(async ({ url }: FetchInput) => {
    if (url.includes('getPatientEncounterHistoryReportServer')) return [];
    if (url.includes('carePlanAssignedCare')) return { carePlanHeader: [] };
    if (url.includes('carePlanMedication')) return { Medication: [] };
    throw new Error(`URL inesperada: ${url}`);
  });
  const dependencies: ClinicalPanelDependencies = {
    fetchImpl,
    fetchJsonWithTimeout,
    fetchMedicationPages: globals.HhrClinicalPanelFetch.fetchMedicationPages,
    unwrapRequiredSources: globals.HhrClinicalPanelFetch.unwrapRequiredSources,
    resolveSession: vi.fn().mockResolvedValue({ info }),
    fetchCurrentValidation: vi.fn().mockResolvedValue({ validation: null }),
    timeoutMs: 15_000,
    ...overrides,
  };
  return {
    runtime: globals.HhrClinicalPanelRuntime.create(dependencies),
    dependencies,
  };
};

describe('clinical panel read runtime', () => {
  it('fails closed when any explicit runtime dependency is missing', () => {
    expect(() =>
      globals.HhrClinicalPanelRuntime.create({ timeoutMs: 15_000 } as ClinicalPanelDependencies)
    ).toThrow('No se pudo inicializar el runtime de lectura del panel clínico.');
  });

  it('preserves endpoints, pagination lanes, timeout and current-validation context', async () => {
    const { runtime, dependencies } = createHarness();

    await expect(runtime.handleRequest({ encId: '141 336' })).resolves.toMatchObject({
      ok: true,
      events: [],
      carePlan: { carePlanHeaders: [], medicationStates: [] },
    });

    expect(dependencies.fetchJsonWithTimeout).toHaveBeenCalledTimes(4);
    const inputs = vi.mocked(dependencies.fetchJsonWithTimeout).mock.calls.map(call => call[0]);
    expect(inputs.map(input => input.url)).toEqual([
      `${apiOrigin}/api/encounter/141%20336/getPatientEncounterHistoryReportServer/false/0/0/-14`,
      `${apiOrigin}/api/carePlanAssignedCare/141%20336?page=0&limit=100&showAll=false`,
      `${apiOrigin}/api/carePlanMedication/141%20336?page=0&limit=100&isSuspended=false`,
      `${apiOrigin}/api/carePlanMedication/141%20336?page=0&limit=100&isSuspended=true`,
    ]);
    inputs.forEach(input => {
      expect(input).toMatchObject({
        [sessionKey]: sessionValue,
        fetchImpl,
        timeoutMs: 15_000,
      });
    });
    expect(dependencies.fetchCurrentValidation).toHaveBeenCalledWith('141 336', info);
  });

  it('normalizes only approved history, care-plan and medication fields', async () => {
    const fetchJsonWithTimeout = vi.fn(async ({ url }: FetchInput) => {
      if (url.includes('getPatientEncounterHistoryReportServer')) {
        return [
          {
            publishDatetime: '2026-07-18T09:00:00',
            healthCarePractitionerValidator: { creationDatetime: '2026-07-18T09:10:00' },
            evolutionResume: [{ OBE_NOTES: 'Estable', HCPR_NAME: 'Médico', privateNote: 'hidden' }],
            procedureIndicationResume: [{ PROCEDURE: 'hidden' }],
            diagnosisResume: [{ DIAGNOSIS: 'hidden' }],
            privatePatientField: 'hidden',
          },
          { publishDatetime: '2026-07-17T09:00:00', privatePatientField: 'hidden' },
        ];
      }
      if (url.includes('carePlanAssignedCare')) {
        return {
          carePlanHeader: [{
            label: 'Hoy',
            labelDate: '2026-07-18',
            scheduledDate: '2026-07-18T12:00:00',
            isSuspended: false,
            privateHeaderField: 'hidden',
            carePlanBody: [{
              entryGuid: 'care-1',
              title: 'Control de signos vitales',
              isPerformed: true,
              privateCareField: 'hidden',
            }],
          }],
        };
      }
      if (url.includes('isSuspended=false')) {
        return { Medication: [{ id: 1, suspended: false, descriptor: 'hidden' }] };
      }
      if (url.includes('isSuspended=true')) {
        return { Medication: [{ id: 2, suspended: true, dosage: 'hidden' }] };
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    const { runtime } = createHarness({
      fetchJsonWithTimeout,
      fetchCurrentValidation: vi.fn().mockResolvedValue({
        validation: { creationDatetime: '2026-07-18T10:00:00', privateValidator: 'hidden' },
      }),
    });

    const result = await runtime.handleRequest({ encId: '141336' });
    const events = result.events as Array<Record<string, unknown>>;
    const carePlan = result.carePlan as {
      carePlanHeaders: Array<Record<string, unknown>>;
      medicationStates: Array<Record<string, unknown>>;
    };

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      publishDatetime: '2026-07-18T09:00:00',
      validationDatetime: '2026-07-18T09:10:00',
      evolutionResume: [{ OBE_NOTES: 'Estable', HCPR_NAME: 'Médico' }],
    });
    expect(events[0]).not.toHaveProperty('privatePatientField');
    expect(events[0]).not.toHaveProperty('procedureIndicationResume');
    expect(events[0]).not.toHaveProperty('diagnosisResume');
    expect((events[0].evolutionResume as Record<string, unknown>[])[0]).not.toHaveProperty(
      'privateNote'
    );
    expect(events[1]).toMatchObject({
      publishDatetime: '2026-07-18T10:00:00',
      validationDatetime: '2026-07-18T10:00:00',
    });
    expect(carePlan.carePlanHeaders[0]).not.toHaveProperty('privateHeaderField');
    expect(
      (carePlan.carePlanHeaders[0].carePlanBody as Record<string, unknown>[])[0]
    ).not.toHaveProperty('privateCareField');
    expect(carePlan.medicationStates).toMatchObject([
      { id: 1, suspended: false },
      { id: 2, suspended: true },
    ]);
    expect(carePlan.medicationStates[0]).not.toHaveProperty('descriptor');
    expect(carePlan.medicationStates[1]).not.toHaveProperty('dosage');
  });

  it('does not duplicate a current validation already represented by history', async () => {
    const validationDatetime = '2026-07-18T10:00:00';
    const fetchJsonWithTimeout = vi.fn(async ({ url }: FetchInput) => {
      if (url.includes('getPatientEncounterHistoryReportServer')) {
        return [{ publishDatetime: validationDatetime, healthCarePractitionerValidator: 'Dra.' }];
      }
      if (url.includes('carePlanAssignedCare')) return null;
      return { Medication: [] };
    });
    const { runtime } = createHarness({
      fetchJsonWithTimeout,
      fetchCurrentValidation: vi.fn().mockResolvedValue({
        validation: { stringTimestamp: validationDatetime },
      }),
    });

    const result = await runtime.handleRequest({ encId: '141336' });

    expect(result.events).toHaveLength(1);
    expect(result.carePlan).toEqual({ carePlanHeaders: [], medicationStates: [] });
  });

  it('fails closed with the same source label for rejected or error-valued dependencies', async () => {
    const rejected = createHarness({
      fetchJsonWithTimeout: vi.fn(async ({ url }: FetchInput) => {
        if (url.includes('carePlanAssignedCare')) throw new Error('HTTP 503');
        if (url.includes('getPatientEncounterHistoryReportServer')) return [];
        return { Medication: [] };
      }),
    }).runtime;
    await expect(rejected.handleRequest({ encId: '141336' })).resolves.toEqual({
      error: 'Falló la descarga del panel clínico: plan de cuidados: HTTP 503',
    });

    const invalidValidation = createHarness({
      fetchCurrentValidation: vi.fn().mockResolvedValue({ error: 'sesión vencida' }),
    }).runtime;
    await expect(invalidValidation.handleRequest({ encId: '141336' })).resolves.toEqual({
      error:
        'Falló la descarga del panel clínico: validación diaria del tratamiento: sesión vencida',
    });
  });

  it('preserves missing-encounter and unavailable-session failures', async () => {
    const resolveSession = vi.fn().mockResolvedValue({ error: 'No hay una pestaña abierta.' });
    const { runtime } = createHarness({ resolveSession });

    await expect(runtime.handleRequest({ encId: '' })).resolves.toEqual({
      error: 'Falta enc_id para el panel clínico.',
    });
    expect(resolveSession).not.toHaveBeenCalled();
    await expect(runtime.handleRequest({ encId: '141336' })).resolves.toEqual({
      error: 'No hay una pestaña abierta.',
    });
  });

  it('keeps the owner loaded at MV3 startup and background limited to wiring', () => {
    const background = readFileSync(
      new URL('../../../extension/background.js', import.meta.url),
      'utf8'
    );
    const runtime = readFileSync(
      new URL('../../../extension/clinical-panel-runtime.js', import.meta.url),
      'utf8'
    );

    expect(background.slice(0, background.indexOf('const FICHAMEDICO_MATCH'))).toContain(
      "'clinical-panel-runtime.js'"
    );
    expect(background).toContain('const clinicalPanelRuntime = self.HhrClinicalPanelRuntime.create({');
    expect(background).toContain('timeoutMs: CLINICAL_PANEL_REQUEST_TIMEOUT_MS');
    expect(background).toContain('const handleClinicalPanelRequest = clinicalPanelRuntime.handleRequest');
    expect(background).not.toContain('const CLINICAL_PANEL_RESUMES');
    expect(background).not.toContain('/api/carePlanAssignedCare/');
    expect(runtime).toContain('/api/carePlanAssignedCare/');
    expect(runtime).not.toMatch(/clinicalWrite|partialUpdate|POST|PUT|PATCH|DELETE/);
    expect(background.split('\n').length).toBeLessThanOrEqual(4_000);
    expect(runtime.split('\n').length).toBeLessThanOrEqual(260);
  });
});

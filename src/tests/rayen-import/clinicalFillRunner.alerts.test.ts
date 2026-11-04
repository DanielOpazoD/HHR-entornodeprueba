import { runClinicalFill, type ClinicalFillDeps } from './support/batchClinicalFill';
import { describe, expect, it, vi } from 'vitest';
import type {
  RayenClinicalAlertsResult,
  RayenPatientClinicalBundle,
} from '@/features/rayen-import/contracts/patientClinicalBundle';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientClinicalAlert } from '@/types/domain/clinicalAlerts';

const STORED: PatientClinicalAlert = {
  id: 'alert-stored',
  text: 'Nota sintética guardada',
  recordedAt: '2026-07-09T10:00',
};

const record = (): DailyRecord =>
  ({
    date: '2026-07-10',
    beds: {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente 1',
        clinicalEpisodeId: 'E1',
        devices: [],
        clinicalAlerts: [STORED],
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;

const eloisaAlert = {
  guid: 'alert-new',
  observation: 'Nota sintética nueva',
  startDateTime: '2026-07-10T09:30:00.0-06:00',
  endDateTime: null,
  archived: false,
  deleted: false,
  deletedDateTime: null,
  isSigned: true,
  authorHealthCarePractitionerName: 'Profesional Sintético',
  authorHealthCarePractitionerRoleName: 'Enfermera(o)',
};

const deps = (alerts?: RayenClinicalAlertsResult): ClinicalFillDeps => {
  const bundle: RayenPatientClinicalBundle = {
    devices: { entries: [], base64: '' },
    history: { events: [], nursingActivity: [] },
    forms: { forms: [] },
    ...(alerts ? { alerts } : {}),
  };
  return {
    fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn().mockResolvedValue({ events: [], nursingActivity: [] }),
    fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
    fetchCudyrCategories: vi.fn().mockResolvedValue({
      items: [],
      source: 'gestion_camas',
      historyAvailable: true,
    }),
    fetchPatientClinicalBundle: vi.fn().mockResolvedValue(bundle),
    applyPatch: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-07-10T16:00:00.000Z'),
    createId: () => 'device-id',
  };
};

const alertPatches = (dependencies: ClinicalFillDeps) =>
  vi
    .mocked(dependencies.applyPatch)
    .mock.calls.map(([patch]) => patch['beds.R1.clinicalAlerts'])
    .filter(Boolean);

describe('runClinicalFill · alertas de la ficha de Eloísa', () => {
  it('replaces the stored alerts with the active ones Eloísa lists today', async () => {
    const dependencies = deps({
      alerts: [eloisaAlert, { ...eloisaAlert, guid: 'x', archived: true }],
    });

    const summary = await runClinicalFill(record(), '2026-07-10', dependencies);

    expect(summary.errors).toEqual([]);
    expect(alertPatches(dependencies)).toEqual([
      [
        {
          id: 'alert-new',
          text: 'Nota sintética nueva',
          recordedAt: '2026-07-10T09:30',
          author: 'Profesional Sintético',
          role: 'Enfermera(o)',
        },
      ],
    ]);
  });

  it('writes an empty list when Eloísa confirms there are no active alerts', async () => {
    const dependencies = deps({ alerts: [] });
    await runClinicalFill(record(), '2026-07-10', dependencies);
    expect(alertPatches(dependencies)).toEqual([[]]);
  });

  it.each<[string, RayenClinicalAlertsResult | undefined, number]>([
    ['a failed read', { alerts: [], error: 'HTTP 500', errorCode: 'source_unavailable' }, 0],
    [
      'a timed-out read',
      {
        alerts: [],
        error: 'Tiempo de espera agotado consultando Ficha Médico.',
        errorCode: 'source_timeout',
      },
      1,
    ],
    ['a read skipped for another day', { alerts: [], skipped: true }, 0],
    ['an extension without alerts', undefined, 0],
  ])('keeps the stored alerts after %s, silently', async (_case, alerts, timeouts) => {
    const dependencies = deps(alerts);
    const summary = await runClinicalFill(record(), '2026-07-10', dependencies);
    // No warning for a source the next sync reads again; a timeout still shows in the run metrics.
    expect(summary.errors).toEqual([]);
    expect(summary.performance?.counters.timeouts).toBe(timeouts);
    expect(alertPatches(dependencies)).toEqual([]);
  });
});

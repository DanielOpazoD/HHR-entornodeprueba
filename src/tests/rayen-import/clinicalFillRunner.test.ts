import { describe, expect, it, vi } from 'vitest';
import {
  runClinicalFill,
  type ClinicalFillDeps,
  type ClinicalFillError,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const BRADEN_HISTORY_EVENT = {
  publishDatetime: '2026-07-10T08:00:00',
  evaluationInstrumentsResume: [
    { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '17', ARCHIVED: false },
    {
      FORM_NAME: 'Escala de riesgo UPP (Braden)',
      LABEL: 'Nivel de Severidad',
      VALUE: 'Riesgo bajo',
      ARCHIVED: false,
    },
  ],
};

const BRADEN_SUMMARY_FORM = {
  formCodigo: 'INSTRUMENTO',
  nameForm: 'Escala de riesgo UPP (Braden)',
  encounterEventId: 8652718,
  startDateTime: '10-07-2026 08:00:00',
  metaCampList: [
    {
      id: 'BRAD_Puntaje',
      label: 'Puntaje',
      value: '21',
      valueName: null,
      sectionId: 1,
      createDatetime: '10-07-2026 08:00:00 -06:00',
    },
    {
      id: 'BRAD_ResultadoScore',
      label: 'Nivel de Severidad',
      value: '8041',
      valueName: 'Riesgo bajo',
      sectionId: 1,
      createDatetime: '10-07-2026 08:00:00 -06:00',
    },
  ],
};

const record = (beds: Record<string, { encId?: string; name?: string }>): DailyRecord =>
  ({
    date: '2026-07-10',
    beds: Object.fromEntries(
      Object.entries(beds).map(([bedId, { encId, name }]) => [
        bedId,
        { bedId, patientName: name ?? 'Paciente X', clinicalEpisodeId: encId, devices: [] },
      ])
    ),
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;

const okDeps = (over: Partial<ClinicalFillDeps> = {}): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({ events: [BRADEN_HISTORY_EVENT] }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchCudyrCategories: vi.fn().mockResolvedValue({
    items: [{ encId: 'E1', crdValue: 'D3', crdDateTime: '2026-07-10T18:00:00+00:00' }],
    source: 'gestion_camas',
    historyAvailable: true,
  }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now: () => new globalThis.Date(Date.UTC(2026, 6, 10, 12, 0, 0)),
  createId: () => 'id-1',
  ...over,
});

const expectCheckpointOnlyPatch = (
  applyPatch: NonNullable<ClinicalFillDeps['applyPatch']>,
  bedId: string
): void => {
  expect(applyPatch).toHaveBeenCalledTimes(1);
  expect(Object.keys((applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toEqual([
    `beds.${bedId}.clinicalSyncCheckpoint`,
  ]);
  expect((applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({
    captureHistorySnapshot: false,
  });
};

const patientError = (
  source: ClinicalFillError['source'],
  message: string,
  bedId = 'H1C2',
  clinicalEpisodeId = 'E1'
): ClinicalFillError => ({ bedId, clinicalEpisodeId, source, message });

describe('runClinicalFill', () => {
  it('applies one granular patch per patient (scales + CUDYR), never a full-record save', async () => {
    const deps = okDeps();
    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary).toMatchObject({ total: 1, patched: 1, errors: [] });
    expect(deps.applyPatch).toHaveBeenCalledTimes(1);
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const target = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(Object.keys(patch)).toEqual([
      'beds.H1C2.evaluationScores',
      'beds.H1C2.clinicalSyncCheckpoint',
    ]);
    expect(patch['beds.H1C2.evaluationScores']).toMatchObject({
      braden: { total: 17 },
      cudyr: { category: 'D3', source: 'Eloísa · Gestión de Camas' },
    });
    expect(target).toEqual({
      censusDate: '2026-07-10',
      bedId: 'H1C2',
      clinicalEpisodeId: 'E1',
      captureHistorySnapshot: true,
    });
  });

  it('routes the 16-jul early-morning CUDYR to the 15-jul census when syncing on 16-jul', async () => {
    const applyHistoricalCudyr = vi.fn().mockResolvedValue({ persisted: true, changed: true });
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'C2',
            crdDateTime: '2026-07-16T07:00:00+00:00',
            author: 'Constanza Guajardo',
            source: 'gestion_camas',
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
      applyHistoricalCudyr,
    });

    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-16', deps);

    expect(summary).toMatchObject({ total: 1, patched: 1, errors: [] });
    expect(applyHistoricalCudyr).toHaveBeenCalledWith(
      'E1',
      '2026-07-15',
      expect.objectContaining({
        category: 'C2',
        recordedDate: '2026-07-15',
        author: 'Constanza Guajardo',
      })
    );
    expectCheckpointOnlyPatch(deps.applyPatch, 'H1C2');
  });

  it('does not fail coverage when a prior-shift CUDYR belongs to an episode absent from that census', async () => {
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [
          {
            encId: 'E1',
            crdValue: 'C1',
            crdDateTime: '2026-07-16T14:26:00+00:00',
            source: 'gestion_camas',
          },
        ],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
      applyHistoricalCudyr: vi.fn().mockResolvedValue({
        persisted: false,
        changed: false,
        applicable: false,
      }),
    });

    const summary = await runClinicalFill(
      record({ R1: { encId: 'E1', name: 'Paciente ingresado el 16' } }),
      '2026-07-16',
      deps
    );

    expect(summary).toMatchObject({ total: 1, patched: 0, errors: [] });
    expect(summary.staffingProposal?.day.names).toEqual([]);
    expect(summary.staffingProposal?.night.names).toEqual([]);
    expectCheckpointOnlyPatch(deps.applyPatch, 'R1');
  });

  it('syncs the latest vitals from the same forms fetch (VITAL_SIGNS)', async () => {
    const VITALS_FORM = {
      formCodigo: 'VITAL_SIGNS',
      nameForm: 'Examen Fisico SAPU',
      encounterEventId: 8670131,
      createDateTime: '10-07-2026 08:00:00 -06:00',
      metaCampList: [
        { id: 'global_PASSent', value: '130' },
        { id: 'global_PADSent', value: '82' },
        { id: 'global_Pulso', value: '84' },
        { id: 'exa_Fisic_G_SaturacionO2', value: '98' },
      ],
    };
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [VITALS_FORM] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
    });
    const summary = await runClinicalFill(record({ H3C1: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary.patched).toBe(1);
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H3C1.vitalSigns']).toMatchObject({ systolic: 130, heartRate: 84, spo2: 98 });
    expect(patch['beds.H3C1.vitalSignsHistory']).toHaveLength(1);
  });

  it('syncs vital signs into an attached clinical crib using its own episode', async () => {
    const VITALS_FORM = {
      formCodigo: 'VITAL_SIGNS',
      nameForm: 'Signos vitales RN',
      encounterEventId: 8670142,
      createDateTime: '10-07-2026 09:10:00 -06:00',
      metaCampList: [
        { id: 'global_PASSent', value: '72' },
        { id: 'global_PADSent', value: '44' },
        { id: 'global_Pulso', value: '138' },
        { id: 'exa_Fisic_G_SaturacionO2', value: '97' },
      ],
    };
    const rec = record({ H5C1: { encId: 'MOTHER-1', name: 'Madre' } });
    rec.beds.H5C1.clinicalCrib = {
      ...rec.beds.H5C1,
      bedId: 'H5C1',
      patientName: 'RN de prueba',
      clinicalEpisodeId: '141814',
    };
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn(async (encId: string) => ({
        forms: encId === '141814' ? [VITALS_FORM] : [],
      })),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
    });

    const summary = await runClinicalFill(rec, '2026-07-10', deps);

    expect(summary).toMatchObject({ total: 2, patched: 1, errors: [] });
    expect(deps.applyPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        'beds.H5C1.clinicalCrib.vitalSigns': expect.objectContaining({
          systolic: 72,
          heartRate: 138,
          spo2: 97,
        }),
        'beds.H5C1.clinicalCrib.vitalSignsHistory': expect.any(Array),
      }),
      expect.objectContaining({
        censusDate: '2026-07-10',
        bedId: 'H5C1',
        clinicalEpisodeId: '141814',
        clinicalCrib: true,
      })
    );
  });

  it('unions both scale sources — a Braden only in the summary form still syncs (Rodrigo case)', async () => {
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [BRADEN_SUMMARY_FORM] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
    });
    const summary = await runClinicalFill(record({ H3C1: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary.patched).toBe(1);
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H3C1.evaluationScores'].braden).toMatchObject({ total: 21 });
  });

  it('a failing source never blocks the others (devices error → scales still patch)', async () => {
    const deps = okDeps({
      fetchDeviceReport: vi.fn().mockRejectedValue(new Error('tab cerrada')),
    });
    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary.patched).toBe(1);
    expect(summary.errors).toEqual([patientError('devices', 'tab cerrada')]);
  });

  it('rejects a declared device error before parsing its non-authoritative payload', async () => {
    const extractDeviceItems = vi.fn().mockResolvedValue([]);
    const deps = okDeps({
      fetchDeviceReport: vi.fn().mockResolvedValue({
        base64: 'payload-parcial',
        error: 'Reporte de dispositivos incompleto',
      }),
      extractDeviceItems,
    });

    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary.patched).toBe(1);
    expect(summary.errors).toEqual([patientError('devices', 'Reporte de dispositivos incompleto')]);
    expect(extractDeviceItems).not.toHaveBeenCalled();
  });

  it('reports a history error for scales and staffing without trusting its partial events', async () => {
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({
        events: [BRADEN_HISTORY_EVENT],
        nursingActivity: [
          {
            author: 'Enfermera Parcial',
            role: 'Enfermera(o)',
            recordedAt: '2026-07-10T08:00:00',
            source: 'evaluation-scale',
          },
        ],
        error: 'Historial clínico no disponible',
      }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
    });

    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary.patched).toBe(0);
    expect(summary.errors).toEqual([
      patientError('scales', 'Historial clínico no disponible'),
      patientError('staffing', 'Historial clínico no disponible'),
    ]);
    expect(summary.staffingProposal).toMatchObject({
      day: { names: [] },
      night: { names: [] },
    });
    expectCheckpointOnlyPatch(deps.applyPatch, 'H1C2');
  });

  it('reports a fulfilled forms error and does not treat its scales or vitals as successful', async () => {
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({
        forms: [BRADEN_SUMMARY_FORM],
        error: 'Ficha clínica no disponible',
      }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
    });

    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary.errors).toEqual([
      patientError('scales', 'Ficha clínica no disponible'),
      patientError('vitals', 'Ficha clínica no disponible'),
    ]);
    expect(summary.patched).toBe(0);
    expectCheckpointOnlyPatch(deps.applyPatch, 'H1C2');
  });

  it('a failing patient never blocks another (patch error on one bed only)', async () => {
    const applyPatch = vi.fn().mockImplementation(async (patch: Record<string, unknown>) => {
      if (Object.keys(patch)[0]?.includes('H1C1')) throw new Error('patch rechazado');
    });
    const deps = okDeps({ applyPatch });
    const summary = await runClinicalFill(
      record({ H1C1: { encId: 'E9' }, H1C2: { encId: 'E1' } }),
      '2026-07-10',
      deps
    );

    expect(summary.total).toBe(2);
    expect(summary.patched).toBe(1);
    expect(summary.errors).toEqual([patientError('patch', 'patch rechazado', 'H1C1', 'E9')]);
  });

  it('fetches patients concurrently but serializes census writes to avoid self-conflicts', async () => {
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const applyPatch = vi.fn().mockImplementation(async () => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      // Yield exactly one microtask: concurrent writes would overlap here,
      // while the production serializer keeps maxActiveWrites at one.
      await Promise.resolve();
      activeWrites -= 1;
    });
    const deps = okDeps({
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [],
        source: 'gestion_camas',
        historyAvailable: true,
      }),
      applyPatch,
    });

    const summary = await runClinicalFill(
      record({
        R1: { encId: 'E1' },
        R2: { encId: 'E2' },
        R3: { encId: 'E3' },
        R4: { encId: 'E4' },
      }),
      '2026-07-10',
      deps
    );

    expect(summary).toMatchObject({ total: 4, patched: 4, errors: [] });
    expect(applyPatch).toHaveBeenCalledTimes(4);
    expect(maxActiveWrites).toBe(1);
    expect(applyPatch.mock.calls.map(([, target]) => target.captureHistorySnapshot)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(summary.incremental).toMatchObject({ patientWrites: 4, historySnapshots: 1 });
  });

  it('reports progress per patient and skips beds without episode/name', async () => {
    const onProgress = vi.fn();
    const deps = okDeps();
    const summary = await runClinicalFill(
      record({ H1C2: { encId: 'E1' }, H2C1: {}, H3C1: { encId: 'E3', name: '' } }),
      '2026-07-10',
      deps,
      onProgress
    );

    expect(summary.total).toBe(1);
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 1 });
  });
});

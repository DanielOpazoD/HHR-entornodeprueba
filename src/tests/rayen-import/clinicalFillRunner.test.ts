import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

/** Real-shaped Braden 17 (07-10) as a slimmed clinical-history event from the panel de historial. */
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

/** Real-shaped Braden 21 as an encounterFormEntry form (the "Instrumentos de evaluación" summary). */
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
  }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now: () => new Date(2026, 6, 10, 12, 0, 0),
  createId: () => 'id-1',
  ...over,
});

describe('runClinicalFill', () => {
  it('applies one granular patch per patient (scales + CUDYR), never a full-record save', async () => {
    const deps = okDeps();
    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary).toMatchObject({ total: 1, patched: 1, errors: [] });
    expect(deps.applyPatch).toHaveBeenCalledTimes(1);
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Only the evaluationScores path is patched (no devices came back).
    expect(Object.keys(patch)).toEqual(['beds.H1C2.evaluationScores']);
    expect(patch['beds.H1C2.evaluationScores']).toMatchObject({
      braden: { total: 17 },
      cudyr: { category: 'D3', source: 'Eloísa · Ficha Médico' },
    });
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
      fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
    });
    const summary = await runClinicalFill(record({ H3C1: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary.patched).toBe(1);
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H3C1.vitalSigns']).toMatchObject({ systolic: 130, heartRate: 84, spo2: 98 });
    expect(patch['beds.H3C1.vitalSignsHistory']).toHaveLength(1);
  });

  it('unions both scale sources — a Braden only in the summary form still syncs (Rodrigo case)', async () => {
    // History report has no scales for this patient; the Braden lives only in encounterFormEntry.
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [BRADEN_SUMMARY_FORM] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
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
    expect(summary.errors).toEqual([{ bedId: 'H1C2', source: 'devices', message: 'tab cerrada' }]);
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
    expect(summary.patched).toBe(1); // H1C2 still made it
    expect(summary.errors).toEqual([
      { bedId: 'H1C1', source: 'patch', message: 'patch rechazado' },
    ]);
  });

  it('a CUDYR bulk failure costs only that source and is reported once', async () => {
    const deps = okDeps({
      fetchCudyrCategories: vi.fn().mockRejectedValue(new Error('sin relay CUDYR')),
    });
    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary.patched).toBe(1); // scales still patched
    expect(summary.errors).toEqual([{ bedId: '*', source: 'cudyr', message: 'sin relay CUDYR' }]);
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H1C2.evaluationScores'].cudyr).toBeUndefined();
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

    expect(summary.total).toBe(1); // only H1C2 eligible
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 1 });
  });

  it('removes a stale CUDYR carried over from another day when the read is authoritative', async () => {
    const rec = record({ H1C2: { encId: 'E1' } });
    (rec.beds.H1C2 as { evaluationScores?: unknown }).evaluationScores = {
      cudyr: { category: 'D3', recordedDate: '2026-07-10', source: 'Eloísa (Rayen)' },
    };
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      // Authoritative read: Carina's categorization is from the 10th, census day is the 11th.
      fetchCudyrCategories: vi.fn().mockResolvedValue({
        items: [{ encId: 'E1', crdValue: 'D3', crdDateTime: '2026-07-10T23:12:04.74+00:00' }],
      }),
    });
    const summary = await runClinicalFill(rec, '2026-07-11', deps);

    expect(summary.patched).toBe(1);
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H1C2.evaluationScores'].cudyr).toBeUndefined();
  });

  it('keeps a stale CUDYR when the read failed (not authoritative)', async () => {
    const rec = record({ H1C2: { encId: 'E1' } });
    (rec.beds.H1C2 as { evaluationScores?: unknown }).evaluationScores = {
      cudyr: { category: 'D3', recordedDate: '2026-07-10', source: 'Eloísa (Rayen)' },
    };
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchCudyrCategories: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    const summary = await runClinicalFill(rec, '2026-07-11', deps);

    expect(summary.patched).toBe(0); // nothing changed — the stale value is preserved, not wiped
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });

  it('patients with nothing new produce no patch at all', async () => {
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
    });
    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary).toMatchObject({ total: 1, patched: 0, errors: [] });
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });
});

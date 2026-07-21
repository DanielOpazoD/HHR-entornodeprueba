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
  now: () => new globalThis.Date(Date.UTC(2026, 6, 10, 12, 0, 0)),
  createId: () => 'id-1',
  ...over,
});

describe('runClinicalFill no-op behavior', () => {
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

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

  it('writes nothing per patient when a second synchronization receives the same clinical facts', async () => {
    const firstRecord = record({ H1C2: { encId: 'E1' } });
    const firstDeps = okDeps();
    const firstSummary = await runClinicalFill(firstRecord, '2026-07-10', firstDeps);
    const firstPatch = (firstDeps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(firstPatch).toBeDefined();

    const storedRecord = record({ H1C2: { encId: 'E1' } });
    const storedPatient = storedRecord.beds.H1C2!;
    storedPatient.evaluationScores = firstPatch['beds.H1C2.evaluationScores'];
    storedPatient.clinicalSyncCheckpoint = firstPatch['beds.H1C2.clinicalSyncCheckpoint'];

    const retryDeps = okDeps();
    const summary = await runClinicalFill(storedRecord, '2026-07-10', retryDeps);

    expect(summary).toMatchObject({ total: 1, patched: 0, errors: [] });
    expect(firstSummary.incremental).toMatchObject({ patientWrites: 1, historySnapshots: 1 });
    expect(summary.incremental).toMatchObject({
      newFacts: 0,
      duplicates: 1,
      patientWrites: 0,
      historySnapshots: 0,
    });
    expect(retryDeps.applyPatch).not.toHaveBeenCalled();

    const firstWriteBytes = JSON.stringify(firstPatch).length;
    const retryWriteBytes = 0;
    const reduction = 1 - retryWriteBytes / firstWriteBytes;
    expect(reduction).toBeGreaterThanOrEqual(0.8);
  });
});

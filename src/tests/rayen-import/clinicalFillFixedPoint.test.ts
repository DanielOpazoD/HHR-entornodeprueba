import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { applyPatches } from '@/utils/patchUtils';

const BED_IDS = ['R1', 'R2', 'R3', 'R4', 'H1C1', 'H1C2', 'H2C1', 'H2C2', 'H3C1', 'H4C1'];
const HISTORY_EVENT = {
  publishDatetime: '2026-07-10T08:00:00',
  evaluationInstrumentsResume: [
    { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '17' },
    {
      FORM_NAME: 'Escala de riesgo UPP (Braden)',
      LABEL: 'Nivel de Severidad',
      VALUE: 'Riesgo bajo',
    },
  ],
};

const record = (): DailyRecord =>
  ({
    date: '2026-07-10',
    beds: Object.fromEntries(
      BED_IDS.map((bedId, index) => [
        bedId,
        {
          bedId,
          patientName: `Paciente ${index + 1}`,
          clinicalEpisodeId: `E${index + 1}`,
          devices: [],
        },
      ])
    ),
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-07-10T12:00:00.000Z',
  }) as unknown as DailyRecord;

const deps = (applyPatch: ClinicalFillDeps['applyPatch']): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({
    events: [HISTORY_EVENT],
    nursingActivity: [],
    effectiveLookbackDays: 14,
    coverageWindowStartIsoDay: '2026-06-28',
    coverageWindowEndIsoDay: '2026-07-09',
  }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchCudyrCategories: vi.fn().mockResolvedValue({
    items: [],
    source: 'gestion_camas',
    historyAvailable: true,
  }),
  applyPatch,
  now: () => new Date('2026-07-10T12:00:00.000Z'),
  createId: () => 'unused-id',
});

describe('clinical fill fixed point', () => {
  it('budgets an identical retry at zero patches, writes and snapshots after hydration', async () => {
    const initialRecord = record();
    let aggregatePatch: DailyRecordPatch = {};
    const firstApply = vi.fn(async (patch: DailyRecordPatch) => {
      aggregatePatch = { ...aggregatePatch, ...patch };
    });
    const first = await runClinicalFill(initialRecord, '2026-07-10', deps(firstApply));
    const persisted = prepareDailyRecordForPersistence(
      applyPatches(initialRecord, aggregatePatch),
      '2026-07-10'
    );
    const hydrated = JSON.parse(JSON.stringify(persisted)) as DailyRecord;

    const retryApply = vi.fn().mockResolvedValue(undefined);
    const retry = await runClinicalFill(hydrated, '2026-07-10', deps(retryApply));

    expect(first.incremental).toMatchObject({ patientWrites: 10, historySnapshots: 1 });
    expect(retry).toMatchObject({ total: 10, patched: 0, errors: [] });
    expect(retry.incremental).toMatchObject({ patientWrites: 0, historySnapshots: 0 });
    expect(retry.performance?.counters.patches).toBe(0);
    expect(retryApply).not.toHaveBeenCalled();
  });
});

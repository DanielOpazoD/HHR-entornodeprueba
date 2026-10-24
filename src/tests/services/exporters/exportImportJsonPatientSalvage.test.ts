import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const storage = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: storage.read,
  saveRecordsStrict: storage.save,
}));

import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import { storedDayWithPlantedReviews } from '@/tests/fixtures/identityReviewDayFixture';

const DATE = '2026-10-24';
const passport = () => ({
  bedId: 'R1',
  patientName: 'PACIENTE SINTETICO P5',
  firstName: 'PACIENTE',
  lastName: 'SINTETICO',
  secondLastName: 'P5',
  rut: 'FAKE-PASSPORT-P5',
  documentType: 'Pasaporte',
  clinicalEpisodeId: 'ep_synthetic_p5',
  admissionDate: '2026-10-23',
  medicalHandoffNote: 'NOTA SINTETICA CONSERVAR',
  pathology: 'DIAGNOSTICO SINTETICO',
});
const file = (patient: unknown) =>
  new File([JSON.stringify({ [DATE]: { date: DATE, beds: { R1: patient } } })], 'synthetic.json', {
    type: 'application/json',
  });

beforeEach(() => {
  vi.clearAllMocks();
  storage.read.mockResolvedValue(null);
  storage.save.mockResolvedValue({
    ok: true,
    operation: 'save_many',
    store: 'indexeddb',
    dates: [],
  });
});

describe('JSON patient salvage', () => {
  it('imports a repaired passport without losing its identity or clinical note', async () => {
    const original = passport();
    const result = await importDataJSONDetailed(
      file({ ...original, insurance: 'UNKNOWN_LEGACY_INSURANCE' })
    );

    expect(result).toMatchObject({
      success: true,
      outcome: 'repaired',
      importedCount: 1,
      repairedCount: 1,
      skippedEntries: [],
    });
    const saved: DailyRecord[] = storage.save.mock.calls[0][0];
    expect(saved[0].beds.R1).toMatchObject(original);
    expect(saved[0].beds.R1.insurance).toBeUndefined();
  });

  it.each([
    ['documentType', 'UNKNOWN_DOCUMENT'],
    ['rut', 123],
    ['clinicalEpisodeId', 123],
    ['identityStatus', 'tentative'],
    ['patientName', 42],
    ['firstName', { given: 'PACIENTE' }],
    ['lastName', ['SINTETICO']],
    ['secondLastName', 5],
    ['admissionDate', { seconds: 1, nanoseconds: 0 }],
    ['admissionTime', 930],
  ])(
    'reports an invalid %s as blocked instead of importing a fabricated identity',
    async (field, value) => {
      const result = await importDataJSONDetailed(file({ ...passport(), [field]: value }));

      expect(result).toEqual({
        success: false,
        outcome: 'blocked',
        importedCount: 0,
        repairedCount: 0,
        skippedEntries: [DATE],
      });
      expect(storage.save).not.toHaveBeenCalled();
    }
  );

  it('imports a file that carries identity reviews without any of them', async () => {
    const day = storedDayWithPlantedReviews();
    const result = await importDataJSONDetailed(
      new File([JSON.stringify({ [DATE]: day })], 'synthetic.json', { type: 'application/json' })
    );

    expect(result).toMatchObject({ success: true, importedCount: 1, skippedEntries: [] });
    const saved: DailyRecord[] = storage.save.mock.calls[0][0];
    expect(JSON.stringify(saved)).not.toContain('identityReview');
    expect(saved[0].discharges[0].originalData?.clinicalCrib?.patientName).toBe('RN SINTETICO');
  });
});

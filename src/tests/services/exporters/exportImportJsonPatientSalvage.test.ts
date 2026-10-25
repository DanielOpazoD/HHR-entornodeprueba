import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const storage = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: storage.read,
  saveRecordsStrict: storage.save,
}));

import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { storedDay, storedDayWithPlantedReviews } from '@/tests/fixtures/identityReviewDayFixture';

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
  it('imports valid clinical events and devices from partially invalid lists', async () => {
    const event = {
      id: 'synthetic',
      name: 'EVENTO SINTETICO',
      date: DATE,
      createdAt: `${DATE}T10:00:00Z`,
    };
    const result = await importDataJSONDetailed(
      file({
        ...passport(),
        devices: ['CVC', 7, 'VMI'],
        clinicalEvents: [event, { ...event, name: 7 }],
      })
    );
    expect(result).toMatchObject({
      success: true,
      outcome: 'repaired',
      importedCount: 1,
      repairedCount: 1,
    });
    const saved: DailyRecord[] = storage.save.mock.calls[0][0];
    expect(saved[0].beds.R1).toMatchObject({
      ...passport(),
      devices: ['CVC', 'VMI'],
      clinicalEvents: [event],
    });
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
    'imports a day whose %s cannot be read with the bed under review and its stored value',
    async (field, value) => {
      const result = await importDataJSONDetailed(file({ ...passport(), [field]: value }));

      expect(result).toMatchObject({ success: true, importedCount: 1, skippedEntries: [] });
      const saved: DailyRecord[] = storage.save.mock.calls[0][0];
      expect(saved[0].beds.R1.identityReview).toEqual({
        bedId: 'R1',
        slot: 'bed',
        fields: [field],
        stored: { [field]: value },
      });
      expect(saved[0].beds.R1.documentType).not.toBe('RUT');
    }
  );

  it('gives back the stored RUT of a file made from a day read under review', async () => {
    const read = docToRecord(storedDay({ documentType: 'RUT', rut: 12345678 }), DATE);
    const exported = new File([JSON.stringify({ [DATE]: read })], 'synthetic.json', {
      type: 'application/json',
    });

    const result = await importDataJSONDetailed(exported);

    expect(result).toMatchObject({ success: true, importedCount: 1 });
    const saved: DailyRecord[] = storage.save.mock.calls[0][0];
    expect(saved[0].beds.R1.identityReview).toMatchObject({
      fields: ['rut'],
      stored: { rut: 12345678 },
    });
  });

  it('refuses a file whose identity reviews do not hold what storage held', async () => {
    const day = storedDayWithPlantedReviews();
    const result = await importDataJSONDetailed(
      new File([JSON.stringify({ [DATE]: day })], 'synthetic.json', { type: 'application/json' })
    );

    expect(result).toMatchObject({ success: false, importedCount: 0, skippedEntries: [DATE] });
    expect(storage.save).not.toHaveBeenCalled();
  });
});

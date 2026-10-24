// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildAdminHarness,
  createListUploadReadonlyRecordsHandler,
  seedPin,
} from './prescriptionAccessFunctions.testSupport';

const buildPrescriptionRecord = (id: string, createdAt: string) => ({
  id,
  prescriptionType: 'comun',
  createdAt,
  image: {
    storagePath: `prescriptions/hhr/${id}/full.jpg`,
    thumbnailStoragePath: `prescriptions/hhr/${id}/thumb.jpg`,
  },
});

describe.each([
  [
    'summer',
    '2026-10-25T02:00:00.000Z',
    '2026-10-24',
    '2026-10-23',
    '2026-10-25T01:30:00.000Z',
    '2026-10-24T01:30:00.000Z',
  ],
  [
    'late evening at 23:30',
    '2026-10-25T04:30:00.000Z',
    '2026-10-24',
    '2026-10-23',
    '2026-10-25T04:00:00.000Z',
    '2026-10-24T04:00:00.000Z',
  ],
  [
    'winter',
    '2026-07-02T03:00:00.000Z',
    '2026-07-01',
    '2026-06-30',
    '2026-07-02T02:30:00.000Z',
    '2026-07-01T02:30:00.000Z',
  ],
  [
    'year boundary',
    '2027-01-01T02:00:00.000Z',
    '2026-12-31',
    '2026-12-30',
    '2027-01-01T01:30:00.000Z',
    '2026-12-31T01:30:00.000Z',
  ],
])('hospital evening in %s', (_season, now, today, yesterday, tonightAt, lastNightAt) => {
  const createEveningHandler = async () => {
    vi.setSystemTime(new Date(now));
    const { admin, accessConfig } = buildAdminHarness({
      prescriptionRecords: {
        tonight: buildPrescriptionRecord('tonight', tonightAt),
        lastNight: buildPrescriptionRecord('lastNight', lastNightAt),
        invalid: buildPrescriptionRecord('invalid', 'invalid-timestamp'),
      },
    });
    await seedPin(accessConfig, '7351');
    return createListUploadReadonlyRecordsHandler({
      firestore: admin.firestore(),
      storage: admin.storage(),
      resolveRoleForEmail: vi.fn(),
    });
  };

  it('returns tonight for Hoy during the hospital evening', async () => {
    const handler = await createEveningHandler();
    const result = await handler({ pin: '7351', date: today }, undefined);
    expect(result.date).toBe(today);
    expect(result.records.map((record: { id: string }) => record.id)).toEqual(['tonight']);
  });

  it('allows Ayer and returns the previous hospital evening', async () => {
    const handler = await createEveningHandler();
    const result = await handler({ pin: '7351', date: yesterday }, undefined);
    expect(result.date).toBe(yesterday);
    expect(result.records.map((record: { id: string }) => record.id)).toEqual(['lastNight']);
  });

  it('defaults to the hospital day when the viewer omits the date', async () => {
    const handler = await createEveningHandler();
    const result = await handler({ pin: '7351' }, undefined);
    expect(result.date).toBe(today);
    expect(result.records.map((record: { id: string }) => record.id)).toEqual(['tonight']);
  });

  it('rejects tomorrow even though it is already the UTC day', async () => {
    const handler = await createEveningHandler();
    await expect(handler({ pin: '7351', date: now.slice(0, 10) }, undefined)).rejects.toMatchObject(
      {
        code: 'permission-denied',
      }
    );
  });
});

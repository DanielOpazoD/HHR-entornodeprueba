import { describe, expect, it } from 'vitest';
import { parseVitalSigns } from '@/features/rayen-import/mapping/parseVitalSigns';
import { mergeReportVitals } from '@/features/rayen-import';
import type { PatientData } from '@/types/domain/patient';
import '../../../extension/hhr-vitals.js';

const extension = (
  globalThis as unknown as {
    HhrVitals: { parseVitalSigns: typeof parseVitalSigns };
  }
).HhrVitals;

// Synthetic records: reproduce the temporal contradiction without patient data.
const form = (stamp: string, created = '06-09-2026 00:23:20 -05:00', id = 900) => ({
  formCodigo: 'VITAL_SIGNS',
  encounterEventId: id,
  createDateTime: created,
  metaCampList: [
    { id: 'SIGNS_FechaHora', value: stamp },
    { id: 'global_Pulso', value: '80' },
  ],
});

describe.each([
  ['HHR', parseVitalSigns],
  ['extension', extension.parseVitalSigns],
] as const)('%s · original vital timestamp', (_, parse) => {
  it.each([
    ['07-09-2026 04:05', '06-09-2026 00:23:20 -05:00', '06-09-2026 00:23'],
    ['06-09-2026 23:05:00 -05:00', '06-09-2026 00:23:20 -05:00', '06-09-2026 00:23'],
    ['06-09-2026 05:23', '06-09-2026 00:23:20 -05:00', '06-09-2026 00:23'],
    ['05-09-2026 04:00', '05-09-2026 01:31:38 -06:00', '04-09-2026 22:00'],
    ['06-09-2026 12:17', '06-09-2026 08:18:12 -05:00', '06-09-2026 07:17'],
    ['', '06-09-2026 00:23:20 -05:00', '06-09-2026 00:23'],
  ])('resolves %s against %s to %s', (stamp, created, expected) => {
    const [record] = parse([form(stamp, created)]);
    expect(record.recordedAt).toBe(expected);
    const [day, month, year] = expected.slice(0, 10).split('-');
    expect(record.recordedDate).toBe(`${year}-${month}-${day}`);
  });

  it('uses field revision metadata so a later valid measurement is not rejected', () => {
    const revised = form('06-09-2026 12:17');
    revised.metaCampList = revised.metaCampList.map(campo => ({
      ...campo,
      createDatetime: '06-09-2026 08:18:12 -05:00',
    }));
    expect(parse([revised])[0].recordedAt).toBe('06-09-2026 07:17');
  });

  it('does not guess a correction without an offset-aware record timestamp', () => {
    expect(parse([form('06-09-2026 12:17', '06-09-2026 08:18:12')])[0].recordedAt).toBe(
      '06-09-2026 07:17'
    );
  });

  it('orders by resolved measurement time, not event id or the erroneous future stamp', () => {
    const records = parse([
      form('07-09-2026 04:05'),
      form('06-09-2026 12:17', '06-09-2026 08:18:12 -05:00', 100),
    ]);
    expect(records.map(record => record.recordedAt)).toEqual([
      '06-09-2026 07:17',
      '06-09-2026 00:23',
    ]);
  });
});

it('re-sync corrects the same stored event without duplicating it and is idempotent', () => {
  const incoming = parseVitalSigns([form('07-09-2026 04:05')]);
  const old = { ...incoming[0], recordedAt: '06-09-2026 23:05' };
  const patient = { bedId: 'R1', vitalSigns: old, vitalSignsHistory: [old] } as PatientData;
  const corrected = mergeReportVitals(patient, incoming, '2026-09-06');
  expect(corrected.vitalSignsHistory).toEqual(incoming);
  expect(corrected.vitalSigns?.recordedAt).toBe('06-09-2026 00:23');
  expect(mergeReportVitals(corrected, incoming, '2026-09-06')).toBe(corrected);
});

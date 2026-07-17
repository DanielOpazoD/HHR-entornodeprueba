import { describe, expect, it } from 'vitest';
import { mergeReportVitals } from '@/features/rayen-import';
import type { PatientData } from '@/types/domain/patient';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const patient = { bedId: 'R1', patientName: 'X' } as unknown as PatientData;

const rec = (recordedDate: string, heartRate: number): PatientVitalSigns => ({
  recordedDate,
  recordedAt: `${recordedDate} 08:00`,
  systolic: null,
  diastolic: null,
  heartRate,
  spo2: null,
  temperature: null,
  respiratoryRate: null,
  painEva: null,
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
  observations: null,
  author: '',
  authorRole: '',
});

describe('mergeReportVitals', () => {
  it('stores the latest reading available on the census day and excludes future data', () => {
    // Most-recent-first, as parseVitalSigns returns them.
    const records = [rec('2026-07-12', 90), rec('2026-07-11', 80), rec('2026-07-10', 70)];
    const result = mergeReportVitals(patient, records, '2026-07-11');

    expect(result.vitalSigns?.heartRate).toBe(80);
    expect(result.vitalSignsHistory?.map(r => r.heartRate)).toEqual([80, 70]);
  });

  it('the census glance skips an HGT-only newest reading and shows the last core vital (PA/FC/Sat/T°)', () => {
    const hgtOnly: PatientVitalSigns = { ...rec('2026-07-12', 0), heartRate: null, hgt: 142 };
    const records = [hgtOnly, rec('2026-07-11', 80)];
    const result = mergeReportVitals(patient, records, '2026-07-12');

    // Cell glance = last reading with a core vital (never left blank by the HGT-only measurement)…
    expect(result.vitalSigns?.heartRate).toBe(80);
    // …while the full history (HGT row included) still feeds the detail modal, newest first.
    expect(result.vitalSignsHistory?.map(r => r.hgt)).toEqual([142, null]);
  });

  it('caps the stored history length', () => {
    const many = Array.from({ length: 60 }, (_, i) => rec('2026-07-10', 60 + i));
    const result = mergeReportVitals(patient, many, '2026-07-10');
    expect(result.vitalSignsHistory?.length).toBe(48);
  });

  it('is a no-op when every measurement is later than the census day', () => {
    const result = mergeReportVitals(patient, [rec('2026-07-12', 90)], '2026-07-11');
    expect(result.vitalSigns).toBeUndefined();
    expect(result.vitalSignsHistory).toBeUndefined();
  });

  it('removes previously stored future readings while retaining valid historical ones', () => {
    const before = {
      ...patient,
      vitalSigns: rec('2026-07-12', 90),
      vitalSignsHistory: [rec('2026-07-12', 90), rec('2026-07-10', 70)],
    };
    const result = mergeReportVitals(before, [rec('2026-07-12', 90)], '2026-07-11');

    expect(result.vitalSigns?.heartRate).toBe(70);
    expect(result.vitalSignsHistory?.map(record => record.heartRate)).toEqual([70]);
  });

  it('is a no-op when there are no measurements at all', () => {
    const result = mergeReportVitals(patient, [], '2026-07-11');
    expect(result.vitalSigns).toBeUndefined();
    expect(result.vitalSignsHistory).toBeUndefined();
  });

  it('clears a stored future reading when a successful authoritative fetch returns no vitals', () => {
    const before = {
      ...patient,
      vitalSigns: rec('2026-07-12', 90),
      vitalSignsHistory: [rec('2026-07-12', 90)],
    };
    const result = mergeReportVitals(before, [], '2026-07-11');

    expect(result.vitalSigns).toBeUndefined();
    expect(result.vitalSignsHistory).toEqual([]);
  });
});

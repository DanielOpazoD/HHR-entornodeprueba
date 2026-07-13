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
  it('stores the latest reading overall + the full history (past AND future data)', () => {
    // Most-recent-first, as parseVitalSigns returns them.
    const records = [rec('2026-07-12', 90), rec('2026-07-11', 80), rec('2026-07-10', 70)];
    // Syncing the 07-11 census still keeps the 07-12 (future) reading — all data is synced.
    const result = mergeReportVitals(patient, records);

    expect(result.vitalSigns?.heartRate).toBe(90); // newest overall, even past the census day
    expect(result.vitalSignsHistory?.map(r => r.heartRate)).toEqual([90, 80, 70]);
  });

  it('caps the stored history length', () => {
    const many = Array.from({ length: 60 }, (_, i) => rec('2026-07-10', 60 + i));
    const result = mergeReportVitals(patient, many);
    expect(result.vitalSignsHistory?.length).toBe(48);
  });

  it('keeps a measurement recorded after the census day (no cut-off at the census day)', () => {
    const result = mergeReportVitals(patient, [rec('2026-07-12', 90)]);
    expect(result.vitalSigns?.heartRate).toBe(90);
    expect(result.vitalSignsHistory?.map(r => r.heartRate)).toEqual([90]);
  });

  it('is a no-op when there are no measurements at all', () => {
    const result = mergeReportVitals(patient, []);
    expect(result.vitalSigns).toBeUndefined();
    expect(result.vitalSignsHistory).toBeUndefined();
  });
});

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
  observations: null,
  author: '',
  authorRole: '',
});

describe('mergeReportVitals', () => {
  it('stores the latest reading + the history on or before the census day', () => {
    // Most-recent-first, as parseVitalSigns returns them.
    const records = [rec('2026-07-12', 90), rec('2026-07-11', 80), rec('2026-07-10', 70)];
    const result = mergeReportVitals(patient, records, { censusIsoDay: '2026-07-11' });

    expect(result.vitalSigns?.heartRate).toBe(80); // latest ≤ 07-11 (the 07-12 future one is excluded)
    expect(result.vitalSignsHistory?.map(r => r.heartRate)).toEqual([80, 70]);
  });

  it('caps the stored history length', () => {
    const many = Array.from({ length: 60 }, (_, i) => rec('2026-07-10', 60 + i));
    const result = mergeReportVitals(patient, many, { censusIsoDay: '2026-07-10' });
    expect(result.vitalSignsHistory?.length).toBe(48);
  });

  it('is a no-op when nothing was recorded on or before the census day', () => {
    const result = mergeReportVitals(patient, [rec('2026-07-12', 90)], {
      censusIsoDay: '2026-07-11',
    });
    expect(result.vitalSigns).toBeUndefined();
    expect(result.vitalSignsHistory).toBeUndefined();
  });
});

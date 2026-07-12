import { describe, expect, it } from 'vitest';
import {
  buildVitalSignsView,
  buildVitalsHistory,
} from '@/features/census/controllers/vitalSignsView';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const vitals = (over: Partial<PatientVitalSigns> = {}): PatientVitalSigns => ({
  recordedDate: '2026-07-11',
  recordedAt: '11-07-2026 20:57',
  systolic: 120,
  diastolic: 80,
  heartRate: 80,
  spo2: 98,
  temperature: 36.5,
  respiratoryRate: 16,
  painEva: 2,
  observations: null,
  author: '',
  authorRole: '',
  ...over,
});

describe('buildVitalSignsView', () => {
  it('returns null when there are no vitals', () => {
    expect(buildVitalSignsView(undefined)).toBeNull();
  });

  it('builds ordered readings and marks a healthy set as normal', () => {
    const view = buildVitalSignsView(vitals());
    expect(view?.worst).toBe('normal');
    expect(view?.readings.map(r => r.key)).toEqual(['pa', 'fc', 'spo2', 'temp', 'fr', 'eva']);
    expect(view?.readings.find(r => r.key === 'pa')?.value).toBe('120/80');
    expect(view?.chip).toBe('98% · 36.5°');
  });

  it('flags a low SatO₂ as alert and lifts the worst status', () => {
    const view = buildVitalSignsView(vitals({ spo2: 88 }));
    expect(view?.readings.find(r => r.key === 'spo2')?.status).toBe('alert');
    expect(view?.worst).toBe('alert');
  });

  it('flags fever as a warning/alert by temperature band', () => {
    expect(
      buildVitalSignsView(vitals({ temperature: 38 }))?.readings.find(r => r.key === 'temp')?.status
    ).toBe('warn');
    expect(buildVitalSignsView(vitals({ temperature: 39.2 }))?.worst).toBe('alert');
  });

  it('omits absent readings and still builds a chip from what exists', () => {
    const view = buildVitalSignsView(
      vitals({
        systolic: null,
        diastolic: null,
        spo2: null,
        temperature: null,
        respiratoryRate: null,
        painEva: null,
      })
    );
    expect(view?.readings.map(r => r.key)).toEqual(['fc']);
    expect(view?.chip).toBe('80'); // falls back to the only reading
  });

  it('returns null when every reading is absent', () => {
    expect(
      buildVitalSignsView(
        vitals({
          systolic: null,
          diastolic: null,
          heartRate: null,
          spo2: null,
          temperature: null,
          respiratoryRate: null,
          painEva: null,
        })
      )
    ).toBeNull();
  });
});

describe('buildVitalsHistory', () => {
  it('builds one row per measurement with day + time and colored cells', () => {
    const rows = buildVitalsHistory([
      vitals({ recordedDate: '2026-07-11', recordedAt: '11-07-2026 20:57', spo2: 88 }),
      vitals({ recordedDate: '2026-07-10', recordedAt: '10-07-2026 08:00', heartRate: 70 }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].when).toBe('11-07 20:57');
    expect(rows[0].recordedDate).toBe('2026-07-11');
    expect(rows[0].cells.pa?.value).toBe('120/80');
    expect(rows[0].cells.spo2?.status).toBe('alert'); // 88% flagged
    expect(rows[1].cells.fc?.value).toBe('70');
  });
});

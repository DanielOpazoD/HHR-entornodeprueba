import { describe, expect, it } from 'vitest';
import {
  buildVitalSignsView,
  buildVitalsHistory,
} from '@/features/census/controllers/vitalSignsView';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import {
  classifyVitalSign,
  VITAL_STATUS_MEANINGS,
  VITAL_SIGNS_PROFILE_DEFINITIONS,
} from '@/constants/vitalSignsThresholds';
import { resolveVitalSignsProfile } from '@/utils/vitalSignsProfileResolver';

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
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
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

  it('adds HGT with a glucose band and lifts the worst status when hypo/hyper', () => {
    const normal = buildVitalSignsView(vitals({ hgt: 110 }));
    expect(normal?.readings.find(r => r.key === 'hgt')).toMatchObject({
      value: '110',
      unit: 'mg/dL',
      status: 'normal',
    });
    expect(buildVitalSignsView(vitals({ hgt: 45 }))?.worst).toBe('alert'); // severe hypo
    expect(
      buildVitalSignsView(vitals({ hgt: 210 }))?.readings.find(r => r.key === 'hgt')?.status
    ).toBe('warn');
  });

  it('adds Ins/Cuad as a neutral text reading (units · quadrant) and keeps it out of the chip', () => {
    const view = buildVitalSignsView(vitals({ insulinUnits: 6, insulinQuadrant: 'CSI' }));
    expect(view?.readings.find(r => r.key === 'ins')).toMatchObject({
      label: 'Ins/Cuad',
      value: '6 · CSI',
      status: 'normal',
    });
    expect(view?.chip).toBe('98% · 36.5°'); // insulin never enters the compact chip
  });

  it('flags fever as a warning/alert by temperature band', () => {
    expect(
      buildVitalSignsView(vitals({ temperature: 38 }))?.readings.find(r => r.key === 'temp')?.status
    ).toBe('warn');
    expect(buildVitalSignsView(vitals({ temperature: 39.2 }))?.worst).toBe('alert');
  });

  it('uses newborn HR/RR/temperature ranges without applying adult BP thresholds', () => {
    const newborn = buildVitalSignsView(
      vitals({ systolic: 70, diastolic: 40, heartRate: 126, respiratoryRate: 44, hgt: 110 }),
      'newborn'
    );
    expect(newborn?.profile).toBe('newborn');
    expect(newborn?.readings.find(r => r.key === 'pa')?.status).toBe('neutral');
    expect(newborn?.readings.find(r => r.key === 'fc')?.status).toBe('normal');
    expect(newborn?.readings.find(r => r.key === 'fr')?.status).toBe('normal');
    expect(newborn?.readings.find(r => r.key === 'hgt')?.status).toBe('neutral');
    expect(newborn?.worst).toBe('normal');

    const adult = buildVitalSignsView(
      vitals({ systolic: 70, diastolic: 40, heartRate: 126, respiratoryRate: 44 })
    );
    expect(adult?.readings.find(r => r.key === 'pa')?.status).toBe('alert');
    expect(adult?.readings.find(r => r.key === 'fr')?.status).toBe('alert');
  });

  it.each([
    [35.5, 'alert'],
    [36.5, 'normal'],
    [37.5, 'normal'],
    [38, 'alert'],
  ] as const)('classifies newborn temperature %s °C as %s', (temperature, expected) => {
    const view = buildVitalSignsView(vitals({ temperature }), 'newborn');
    expect(view?.readings.find(r => r.key === 'temp')?.status).toBe(expected);
  });

  it('flags neonatal bradycardia/tachypnea using RN screening bands', () => {
    const view = buildVitalSignsView(vitals({ heartRate: 78, respiratoryRate: 72 }), 'newborn');
    expect(view?.readings.find(r => r.key === 'fc')?.status).toBe('alert');
    expect(view?.readings.find(r => r.key === 'fr')?.status).toBe('alert');
    expect(view?.worst).toBe('alert');
  });

  it('keeps newborn blood pressure neutral when no age-specific context is available', () => {
    const newborn = buildVitalSignsView(
      vitals({
        systolic: 300,
        diastolic: 200,
        heartRate: null,
        spo2: null,
        temperature: null,
        respiratoryRate: null,
        painEva: null,
      }),
      'newborn'
    );

    expect(newborn?.readings).toEqual([
      expect.objectContaining({ key: 'pa', value: '300/200', status: 'neutral' }),
    ]);
    expect(newborn?.worst).toBe('neutral');
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

describe('vital signs threshold configuration', () => {
  it('keeps every visual state and population definition documented in configuration', () => {
    expect(Object.keys(VITAL_STATUS_MEANINGS)).toEqual(['neutral', 'normal', 'warn', 'alert']);
    expect(VITAL_SIGNS_PROFILE_DEFINITIONS.newborn).toContain('0 a 27 días');
    expect(VITAL_SIGNS_PROFILE_DEFINITIONS.newborn).toContain('La cama o ubicación no define');
    expect(Object.keys(VITAL_SIGNS_PROFILE_DEFINITIONS)).toEqual([
      'unknown',
      'newborn',
      'infant',
      'child_1_4',
      'child_5_11',
      'adolescent_12_17',
      'adult',
    ]);
  });

  it.each([
    ['adult', 'pa', 90, 'alert'],
    ['adult', 'pa', 91, 'warn'],
    ['adult', 'pa', 100, 'normal'],
    ['adult', 'pa', 160, 'normal'],
    ['adult', 'pa', 161, 'warn'],
    ['adult', 'pa', 181, 'alert'],
    ['newborn', 'fc', 79, 'alert'],
    ['newborn', 'fc', 80, 'warn'],
    ['newborn', 'fc', 100, 'normal'],
    ['newborn', 'fc', 160, 'normal'],
    ['newborn', 'fc', 180, 'warn'],
    ['newborn', 'fc', 181, 'alert'],
    ['infant', 'fc', 80, 'alert'],
    ['infant', 'fc', 81, 'warn'],
    ['infant', 'fc', 100, 'normal'],
    ['infant', 'fc', 159, 'normal'],
    ['infant', 'fc', 160, 'warn'],
    ['infant', 'fc', 190, 'alert'],
    ['child_1_4', 'fr', 10, 'alert'],
    ['child_1_4', 'fr', 11, 'warn'],
    ['child_1_4', 'fr', 16, 'normal'],
    ['child_1_4', 'fr', 35, 'normal'],
    ['child_1_4', 'fr', 36, 'warn'],
    ['child_1_4', 'fr', 50, 'alert'],
    ['child_5_11', 'pa', 64, 'alert'],
    ['child_5_11', 'pa', 65, 'warn'],
    ['child_5_11', 'pa', 85, 'normal'],
    ['child_5_11', 'pa', 129, 'normal'],
    ['child_5_11', 'pa', 130, 'warn'],
    ['adolescent_12_17', 'fc', 40, 'alert'],
    ['adolescent_12_17', 'fc', 41, 'warn'],
    ['adolescent_12_17', 'fc', 60, 'normal'],
    ['adolescent_12_17', 'fc', 119, 'normal'],
    ['adolescent_12_17', 'fc', 120, 'warn'],
    ['adolescent_12_17', 'fc', 150, 'alert'],
  ] as const)('classifies %s %s=%s as %s', (profile, metric, value, expected) => {
    expect(classifyVitalSign(profile, metric, value)).toBe(expected);
  });

  it('uses the shared Queensland paediatric temperature and oxygen bands', () => {
    expect(classifyVitalSign('child_1_4', 'temp', 35.5)).toBe('normal');
    expect(classifyVitalSign('child_1_4', 'temp', 37.9)).toBe('normal');
    expect(classifyVitalSign('child_1_4', 'temp', 38)).toBe('warn');
    expect(classifyVitalSign('child_5_11', 'spo2', 94)).toBe('normal');
    expect(classifyVitalSign('child_5_11', 'spo2', 90)).toBe('warn');
    expect(classifyVitalSign('child_5_11', 'spo2', 89)).toBe('alert');
  });

  it('keeps every metric neutral when age is unknown', () => {
    expect(classifyVitalSign('unknown', 'pa', 45)).toBe('neutral');
    expect(classifyVitalSign('unknown', 'fc', 210)).toBe('neutral');
    expect(classifyVitalSign('unknown', 'spo2', 70)).toBe('neutral');
  });
});

describe('resolveVitalSignsProfile', () => {
  it('uses completed age on the measurement day, including historical measurements', () => {
    expect(
      resolveVitalSignsProfile({
        birthDate: '2026-08-01',
        referenceDate: '2026-08-28',
      })
    ).toBe('newborn');
    expect(
      resolveVitalSignsProfile({
        birthDate: '2026-08-01',
        referenceDate: '2026-08-29',
      })
    ).toBe('infant');
  });

  it('uses Queensland paediatric age bands on the historical measurement date', () => {
    expect(resolveVitalSignsProfile({ birthDate: '2025-08-23', referenceDate: '2026-08-22' })).toBe(
      'infant'
    );
    expect(resolveVitalSignsProfile({ birthDate: '2025-08-23', referenceDate: '2026-08-23' })).toBe(
      'child_1_4'
    );
    expect(resolveVitalSignsProfile({ birthDate: '2021-08-23', referenceDate: '2026-08-23' })).toBe(
      'child_5_11'
    );
    expect(resolveVitalSignsProfile({ birthDate: '2014-08-23', referenceDate: '2026-08-23' })).toBe(
      'adolescent_12_17'
    );
    expect(resolveVitalSignsProfile({ birthDate: '2008-08-23', referenceDate: '2026-08-23' })).toBe(
      'adult'
    );
  });

  it('accepts explicit day, month or year ages only when dates are unavailable', () => {
    expect(resolveVitalSignsProfile({ age: '10d' })).toBe('newborn');
    expect(resolveVitalSignsProfile({ age: '27 días' })).toBe('newborn');
    expect(resolveVitalSignsProfile({ age: '28d' })).toBe('infant');
    expect(resolveVitalSignsProfile({ age: '11 meses' })).toBe('infant');
    expect(resolveVitalSignsProfile({ age: '400 días' })).toBe('child_1_4');
    expect(resolveVitalSignsProfile({ age: '18 meses' })).toBe('child_1_4');
    expect(resolveVitalSignsProfile({ age: '72 meses' })).toBe('child_5_11');
    expect(resolveVitalSignsProfile({ age: '150 meses' })).toBe('adolescent_12_17');
    expect(resolveVitalSignsProfile({ age: '240 meses' })).toBe('adult');
    expect(resolveVitalSignsProfile({ age: '1a' })).toBe('child_1_4');
    expect(resolveVitalSignsProfile({ age: '5 años' })).toBe('child_5_11');
    expect(resolveVitalSignsProfile({ age: '12a' })).toBe('adolescent_12_17');
    expect(resolveVitalSignsProfile({ age: '18 años' })).toBe('adult');
  });

  it('uses an unknown neutral profile when age cannot be established safely', () => {
    expect(resolveVitalSignsProfile({})).toBe('unknown');
    expect(resolveVitalSignsProfile({ age: 'sin dato' })).toBe('unknown');
    expect(resolveVitalSignsProfile({ age: '0 meses' })).toBe('unknown');
    expect(resolveVitalSignsProfile({ age: '0 años' })).toBe('unknown');
    expect(resolveVitalSignsProfile({ birthDate: '2026-08-24', referenceDate: '2026-08-23' })).toBe(
      'unknown'
    );
  });

  it('does not let the age label override valid dates', () => {
    expect(
      resolveVitalSignsProfile({
        birthDate: '1986-01-01',
        referenceDate: '2026-08-23',
        age: '1d',
      })
    ).toBe('adult');
  });
});

describe('historical profile resolution', () => {
  it('classifies each measurement using age on that measurement date', () => {
    const records = [
      vitals({ recordedDate: '2026-08-29', recordedAt: '29-08-2026 08:00', heartRate: 80 }),
      vitals({ recordedDate: '2026-08-28', recordedAt: '28-08-2026 08:00', heartRate: 80 }),
    ];
    const rows = buildVitalsHistory(records, record =>
      resolveVitalSignsProfile({ birthDate: '2026-08-01', referenceDate: record.recordedDate })
    );

    expect(rows[0].cells.fc?.status).toBe('alert'); // 28 days: infant CEWT
    expect(rows[1].cells.fc?.status).toBe('warn'); // 27 days: neonatal profile
  });

  it('keeps historical values neutral when no birth date can reconstruct age at each reading', () => {
    const records = [
      vitals({ recordedDate: '2026-08-23', recordedAt: '23-08-2026 08:00', heartRate: 45 }),
      vitals({ recordedDate: '2025-08-23', recordedAt: '23-08-2025 08:00', heartRate: 45 }),
    ];
    const rows = buildVitalsHistory(records, record =>
      resolveVitalSignsProfile({ referenceDate: record.recordedDate })
    );

    expect(rows[0].cells.fc?.status).toBe('neutral');
    expect(rows[1].cells.fc?.status).toBe('neutral');
  });
});
